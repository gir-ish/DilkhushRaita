import { db } from "./db";
import { HttpError } from "./guard";
import { computeTotals, deliveryFeeFor, subtotalOf } from "./pricing";
import { evaluateCoupon, type CouponEvaluation } from "./coupons";
import { tierFor } from "./loyalty";
import { pointsValue, redeemablePoints } from "./loyalty";
import { loyaltyRates } from "./loyalty-settings";
import { checkServiceable, etaMins, isBranchOpen, roadKm } from "./geo";
import { hhmm, parseJson, round2, withinTimeWindow } from "./utils";
import { ACTIVE_STATUSES } from "./constants";

export interface QuoteItemInput {
  menuItemId: string;
  variantId?: string | null;
  addOnIds?: string[];
  qty: number;
  instructions?: string | null;
}

export interface QuoteRequest {
  branchId: string;
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
  items: QuoteItemInput[];
  addressId?: string | null;
  couponCode?: string | null;
  redeemPoints?: boolean;
  paymentMethod?: "COD" | "ONLINE";
  scheduledFor?: string | null;
}

export interface QuotedLine {
  menuItemId: string;
  name: string;
  variantId?: string | null;
  variantName?: string | null;
  addOns: { id: string; name: string; price: number }[];
  unitPrice: number;
  qty: number;
  lineTotal: number;
  instructions?: string | null;
}

export interface QuoteResult {
  branch: { id: string; name: string; slug: string };
  open: boolean;
  openReason?: string;
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
  lines: QuotedLine[];
  warnings: string[]; // non-fatal in quote mode; fatal at order time
  distanceKm: number | null;
  etaMins: number | null;
  serviceable: boolean;
  serviceReason?: string;
  minOrderValue: number;
  meetsMinOrder: boolean;
  coupon: {
    applied: { code: string; name: string; savings: number } | null;
    rejectedReason: string | null; // when an explicit code was refused
    autoSuggestion: { code: string; name: string; savings: number } | null;
  };
  couponId: string | null;
  freeDelivery: boolean;
  tierName: string | null;
  pointsBalance: number;
  pointsRedeemed: number;
  /** Live scheme rates, so the browser never has to hardcode what a point is worth. */
  pointValueRupees: number;
  minPointsToRedeem: number;
  totals: ReturnType<typeof computeTotals>;
  paymentMethod: "COD" | "ONLINE";
  scheduledFor: Date | null;
  address: {
    id: string;
    text: string;
    pincode: string;
    lat: number | null;
    lng: number | null;
    contactName: string | null;
    contactPhone: string | null;
  } | null;
}

/**
 * Server-side single source of truth for cart pricing and order validation.
 * `strict` (order placement) throws HttpError on any problem; quote mode
 * collects warnings instead so the UI can display them.
 */
export async function buildQuote(
  req: QuoteRequest,
  userId: string | null,
  strict: boolean
): Promise<QuoteResult> {
  const warnings: string[] = [];
  const fail = (msg: string) => {
    if (strict) throw new HttpError(400, msg);
    warnings.push(msg);
  };

  // Cached, so this is not a database round trip on every keystroke at checkout.
  const rates = await loyaltyRates();

  if (!req.items?.length) throw new HttpError(400, "Your cart is empty");
  if (req.items.length > 50) throw new HttpError(400, "Too many items in cart");

  const branch = await db.branch.findUnique({
    where: { id: req.branchId },
    include: { hours: true, zones: true },
  });
  if (!branch) throw new HttpError(404, "Branch not found");

  const now = new Date();
  const nowHHmm = hhmm(now);
  const openState = isBranchOpen(branch, branch.hours, now);
  if (!openState.open) fail(`${branch.name} is closed right now${openState.reason ? ` (${openState.reason})` : ""}`);

  const orderType = req.orderType;
  if (orderType === "DELIVERY" && !branch.deliveryEnabled) fail("Delivery is unavailable at this branch");
  if (orderType === "PICKUP" && !branch.pickupEnabled) fail("Pickup is unavailable at this branch");
  if (branch.busyMode && branch.busyPauseDelivery && orderType === "DELIVERY")
    fail("The kitchen is very busy — only pickup orders are being accepted right now");

  let scheduledFor: Date | null = null;
  if (req.scheduledFor) {
    scheduledFor = new Date(req.scheduledFor);
    if (isNaN(scheduledFor.getTime()) || scheduledFor.getTime() < Date.now() + 20 * 60000)
      fail("Scheduled time must be at least 20 minutes from now");
    if (scheduledFor.getTime() > Date.now() + 3 * 86400000)
      fail("Orders can be scheduled up to 3 days ahead");
    if (branch.busyMode && branch.busyPauseScheduled)
      fail("Scheduled orders are paused while the kitchen is busy");
  }

  if (strict) {
    const activeCount = await db.order.count({
      where: { branchId: branch.id, status: { in: ACTIVE_STATUSES } },
    });
    if (activeCount >= branch.maxActiveOrders)
      throw new HttpError(409, "The kitchen is at full capacity — please try again in a few minutes");
  }

  // ---------------- items & server-side prices
  const ids = [...new Set(req.items.map((i) => i.menuItemId))];
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: ids } },
    include: {
      variants: true,
      addOns: true,
      branchItems: { where: { branchId: branch.id } },
    },
  });
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  const lines: QuotedLine[] = [];
  for (const input of req.items) {
    const qty = Math.floor(input.qty);
    if (qty < 1 || qty > 20) {
      fail("Invalid quantity");
      continue;
    }
    const item = byId.get(input.menuItemId);
    if (!item || !item.active) {
      fail("An item in your cart is no longer on the menu");
      continue;
    }
    const bi = item.branchItems[0];
    if (bi && !bi.available) {
      fail(`${item.name} is unavailable at ${branch.name}`);
      continue;
    }
    if (bi && bi.stockQty !== -1 && bi.stockQty < qty) {
      fail(`Only ${Math.max(bi.stockQty, 0)} of ${item.name} left at ${branch.name}`);
      continue;
    }
    if (bi && !withinTimeWindow(nowHHmm, bi.availableFrom, bi.availableTo)) {
      fail(`${item.name} is available ${bi.availableFrom}–${bi.availableTo} only`);
      continue;
    }
    let price = bi?.priceOverride ?? item.basePrice;
    let variantName: string | null = null;
    if (input.variantId) {
      const v = item.variants.find((v) => v.id === input.variantId && v.active);
      if (!v) {
        fail(`The selected portion of ${item.name} is unavailable`);
        continue;
      }
      price += v.priceDelta;
      variantName = v.name;
    } else {
      const def = item.variants.find((v) => v.isDefault && v.active);
      if (def) {
        price += def.priceDelta;
        variantName = def.name;
      }
    }
    const addOns: QuotedLine["addOns"] = [];
    for (const aid of input.addOnIds ?? []) {
      const a = item.addOns.find((a) => a.id === aid && a.active);
      if (!a) {
        fail(`An add-on for ${item.name} is unavailable`);
        continue;
      }
      addOns.push({ id: a.id, name: a.name, price: a.price });
      price += a.price;
    }
    price = round2(price);
    lines.push({
      menuItemId: item.id,
      name: item.name,
      variantId: input.variantId ?? null,
      variantName,
      addOns,
      unitPrice: price,
      qty,
      lineTotal: round2(price * qty),
      instructions: input.instructions?.slice(0, 300) ?? null,
    });
  }
  if (strict && lines.length !== req.items.length)
    throw new HttpError(400, warnings[0] ?? "Cart validation failed");
  if (lines.length === 0) throw new HttpError(400, warnings[0] ?? "Your cart is empty");

  const subtotal = subtotalOf(lines);

  // ---------------- delivery address & serviceability
  let address: QuoteResult["address"] = null;
  let distanceKm: number | null = null;
  let serviceable = true;
  let serviceReason: string | undefined;

  if (orderType === "DELIVERY") {
    if (req.addressId) {
      if (!userId) throw new HttpError(401, "Sign in to use saved addresses");
      const a = await db.address.findFirst({ where: { id: req.addressId, userId } });
      if (!a) throw new HttpError(404, "Address not found");
      address = {
        id: a.id,
        text: [a.line1, a.line2, a.landmark, a.pincode].filter(Boolean).join(", "),
        pincode: a.pincode,
        lat: a.lat,
        lng: a.lng,
        contactName: a.contactName,
        contactPhone: a.contactPhone,
      };
      const svc = checkServiceable(branch, { lat: a.lat, lng: a.lng, pincode: a.pincode });
      serviceable = svc.serviceable;
      serviceReason = svc.reason;
      distanceKm = svc.distanceKm ?? (a.lat != null && a.lng != null ? roadKm(branch.lat, branch.lng, a.lat, a.lng) : null);
      if (!serviceable) fail(svc.reason ?? "This address is outside the delivery area");
    } else if (strict) {
      throw new HttpError(400, "Select a delivery address");
    }
  }

  // ---------------- customer context (loyalty, coupons)
  let customerCtx = {
    completedOrders: 0,
    lifetimeSpend: 0,
    loyaltyTierId: null as string | null,
    lastOrderAt: null as Date | null,
  };
  let pointsBalance = 0;
  let tierFreeDelivery = false;
  let tierDiscountPercent = 0;
  let tierName: string | null = null;

  if (userId) {
    const [metrics, profile, tiers] = await Promise.all([
      db.customerMetrics.findUnique({ where: { userId } }),
      db.customerProfile.findUnique({ where: { userId } }),
      db.loyaltyTier.findMany(),
    ]);
    customerCtx = {
      completedOrders: metrics?.completedOrders ?? 0,
      lifetimeSpend: metrics?.lifetimeSpend ?? 0,
      loyaltyTierId: profile?.loyaltyTierId ?? null,
      lastOrderAt: metrics?.lastOrderAt ?? null,
    };
    pointsBalance = profile?.loyaltyPoints ?? 0;
    const tier = tierFor(tiers, {
      completedOrders: customerCtx.completedOrders,
      lifetimeSpend: customerCtx.lifetimeSpend,
    });
    if (tier) {
      tierName = tier.name;
      tierFreeDelivery = tier.freeDelivery;
      tierDiscountPercent = tier.discountPercent;
      customerCtx.loyaltyTierId = tier.id;
    }
  }

  // ---------------- coupons
  const paymentMethod = req.paymentMethod ?? "COD";
  const dayOfWeek = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getDay();
  const feeBeforeCoupon = deliveryFeeFor(branch, distanceKm, subtotal, tierFreeDelivery);
  const itemPriceById: Record<string, number> = {};
  for (const l of lines) itemPriceById[l.menuItemId] = l.unitPrice;

  const activeCoupons = await db.coupon.findMany({ where: { active: true } });
  const redemptionCounts = userId
    ? await db.couponRedemption.groupBy({
        by: ["couponId"],
        where: { userId },
        _count: { _all: true },
      })
    : [];
  const totalCounts = await db.couponRedemption.groupBy({
    by: ["couponId"],
    _count: { _all: true },
  });
  const mineBy = new Map(redemptionCounts.map((r) => [r.couponId, r._count._all]));
  const totalBy = new Map(totalCounts.map((r) => [r.couponId, r._count._all]));

  const ctxFor = (couponId: string) => ({
    subtotal,
    orderType,
    paymentMethod,
    branchId: branch.id,
    now,
    nowHHmm,
    dayOfWeek,
    deliveryFee: orderType === "DELIVERY" ? feeBeforeCoupon : 0,
    itemIdsInCart: lines.map((l) => l.menuItemId),
    itemPriceById,
    customer: customerCtx,
    totalRedemptions: totalBy.get(couponId) ?? 0,
    customerRedemptions: mineBy.get(couponId) ?? 0,
  });

  let applied: CouponEvaluation | null = null;
  let rejectedReason: string | null = null;
  let autoSuggestion: QuoteResult["coupon"]["autoSuggestion"] = null;

  if (req.couponCode) {
    const code = req.couponCode.trim().toUpperCase();
    const c = activeCoupons.find((c) => c.code === code);
    if (!c) {
      rejectedReason = "Invalid coupon code";
      if (strict) throw new HttpError(400, rejectedReason);
    } else {
      const ev = evaluateCoupon(c, ctxFor(c.id));
      if (ev.eligible) applied = ev;
      else {
        rejectedReason = ev.reason ?? "Coupon not applicable";
        if (strict) throw new HttpError(400, rejectedReason);
      }
    }
  }
  if (!applied) {
    const autoEvals = activeCoupons
      .filter((c) => c.autoApply)
      .map((c) => evaluateCoupon(c, ctxFor(c.id)))
      .filter((e) => e.eligible)
      .sort((a, b) => b.savings - a.savings || b.coupon.priority - a.coupon.priority);
    if (autoEvals[0]) applied = autoEvals[0];
    // Suggest the overall best coupon (incl. code-required ones) to the user.
    const bestAny = activeCoupons
      .map((c) => evaluateCoupon(c, ctxFor(c.id)))
      .filter((e) => e.eligible)
      .sort((a, b) => b.savings - a.savings)[0];
    if (bestAny && (!applied || bestAny.savings > applied.savings))
      autoSuggestion = {
        code: bestAny.coupon.code,
        name: bestAny.coupon.name,
        savings: bestAny.savings,
      };
  }

  let discount = applied?.discount ?? 0;
  const freeDelivery = tierFreeDelivery || (applied?.freeDelivery ?? false);
  if (tierDiscountPercent > 0) discount = round2(discount + (subtotal * tierDiscountPercent) / 100);

  // ---------------- loyalty redemption
  let pointsRedeemed = 0;
  let loyaltyCredit = 0;
  if (req.redeemPoints && userId) {
    const provisional = computeTotals({
      lines,
      cfg: branch,
      orderType,
      distanceKm,
      discount,
      freeDelivery,
    });
    pointsRedeemed = redeemablePoints(pointsBalance, provisional.total, rates);
    loyaltyCredit = pointsValue(pointsRedeemed, rates);
  }

  const totals = computeTotals({
    lines,
    cfg: branch,
    orderType,
    distanceKm,
    discount,
    freeDelivery,
    loyaltyCredit,
  });

  const minOrderValue = branch.minOrderValue;
  const meetsMinOrder = subtotal >= minOrderValue;
  if (!meetsMinOrder)
    fail(`Minimum order value is ₹${minOrderValue} (add ₹${round2(minOrderValue - subtotal)} more)`);

  const prep = branch.prepTimeMins + (branch.busyMode ? branch.busyExtraMins : 0);
  const eta =
    orderType === "DELIVERY" && distanceKm != null ? etaMins(distanceKm, prep) : prep;

  return {
    branch: { id: branch.id, name: branch.name, slug: branch.slug },
    open: openState.open,
    openReason: openState.reason,
    orderType,
    lines,
    warnings,
    distanceKm,
    etaMins: eta,
    serviceable,
    serviceReason,
    minOrderValue,
    meetsMinOrder,
    coupon: {
      applied: applied
        ? { code: applied.coupon.code, name: applied.coupon.name, savings: applied.savings }
        : null,
      rejectedReason,
      autoSuggestion,
    },
    couponId: applied?.coupon.id ?? null,
    freeDelivery,
    tierName,
    pointsBalance,
    pointsRedeemed,
    pointValueRupees: rates.pointValueRupees,
    minPointsToRedeem: rates.minPointsToRedeem,
    totals,
    paymentMethod,
    scheduledFor,
    address,
  };
}
