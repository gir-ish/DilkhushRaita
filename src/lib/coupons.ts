import { parseJson, round2, withinTimeWindow } from "./utils";
import { ORDER_TYPE_LABELS } from "./constants";

/** Structural type matching the Prisma Coupon model (pure — no DB import). */
export interface CouponLike {
  id: string;
  code: string;
  name: string;
  description: string;
  rewardType: string; // PERCENT | FLAT | FREE_DELIVERY | FREE_ITEM
  value: number;
  maxDiscount?: number | null;
  freeItemId?: string | null;
  minCartValue?: number | null;
  maxCartValue?: number | null;
  branchId?: string | null;
  orderTypesJson: string;
  daysOfWeekJson: string;
  startTime?: string | null;
  endTime?: string | null;
  startAt?: Date | null;
  endAt?: Date | null;
  firstOrderOnly: boolean;
  minCompletedOrders?: number | null;
  minLifetimeSpend?: number | null;
  loyaltyTierId?: string | null;
  inactiveDays?: number | null;
  paymentMethod?: string | null;
  totalLimit?: number | null;
  perCustomerLimit: number;
  autoApply: boolean;
  stackable: boolean;
  priority: number;
  active: boolean;
}

export interface CouponContext {
  subtotal: number;
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
  paymentMethod: string;
  branchId: string;
  now: Date;
  nowHHmm: string; // IST "HH:mm"
  dayOfWeek: number; // IST 0–6
  deliveryFee: number; // fee before coupon, to value FREE_DELIVERY
  itemIdsInCart: string[];
  itemPriceById: Record<string, number>;
  customer: {
    completedOrders: number;
    lifetimeSpend: number;
    loyaltyTierId?: string | null;
    lastOrderAt?: Date | null;
  };
  totalRedemptions: number; // campaign-wide
  customerRedemptions: number; // by this customer
}

export interface CouponEvaluation {
  coupon: CouponLike;
  eligible: boolean;
  reason?: string; // why NOT eligible (human readable)
  discount: number; // ₹ off the item subtotal
  freeDelivery: boolean;
  savings: number; // discount + delivery fee saved (for ranking)
}

export function evaluateCoupon(coupon: CouponLike, ctx: CouponContext): CouponEvaluation {
  const no = (reason: string): CouponEvaluation => ({
    coupon, eligible: false, reason, discount: 0, freeDelivery: false, savings: 0,
  });

  if (!coupon.active) return no("This offer is currently inactive");
  if (coupon.startAt && ctx.now < coupon.startAt) return no("Offer has not started yet");
  if (coupon.endAt && ctx.now > coupon.endAt) return no("Offer has expired");
  if (!withinTimeWindow(ctx.nowHHmm, coupon.startTime, coupon.endTime))
    return no(`Valid only ${coupon.startTime}–${coupon.endTime}`);

  const days = parseJson<number[]>(coupon.daysOfWeekJson, []);
  if (days.length > 0 && !days.includes(ctx.dayOfWeek)) return no("Not valid today");

  if (coupon.branchId && coupon.branchId !== ctx.branchId)
    return no("Not valid at this branch");

  const types = parseJson<string[]>(coupon.orderTypesJson, ["DELIVERY", "PICKUP"]);
  if (!types.includes(ctx.orderType)) {
    // Naming the allowed types beats guessing: with three order types the old
    // "must be the other one" phrasing was wrong for dine-in.
    const label = (t: string) => ORDER_TYPE_LABELS[t] ?? t;
    return no(
      types.length > 0
        ? `Valid on ${types.map(label).join(" / ").toLowerCase()} orders only`
        : "Not valid for this order type"
    );
  }

  if (coupon.paymentMethod && coupon.paymentMethod !== ctx.paymentMethod)
    return no(`Valid only with ${coupon.paymentMethod === "COD" ? "Cash on Delivery" : "online payment"}`);

  if (coupon.minCartValue != null && ctx.subtotal < coupon.minCartValue)
    return no(`Add items worth ₹${round2(coupon.minCartValue - ctx.subtotal)} more to use this`);
  if (coupon.maxCartValue != null && ctx.subtotal > coupon.maxCartValue)
    return no(`Valid on orders up to ₹${coupon.maxCartValue}`);

  const c = ctx.customer;
  if (coupon.firstOrderOnly && c.completedOrders > 0) return no("Valid on your first order only");
  if (coupon.minCompletedOrders != null && c.completedOrders < coupon.minCompletedOrders)
    return no(`Unlocks after ${coupon.minCompletedOrders} completed orders`);
  if (coupon.minLifetimeSpend != null && c.lifetimeSpend < coupon.minLifetimeSpend)
    return no("Not eligible for your account yet");
  if (coupon.loyaltyTierId && c.loyaltyTierId !== coupon.loyaltyTierId)
    return no("Exclusive to a different loyalty tier");
  if (coupon.inactiveDays != null) {
    if (c.lastOrderAt) {
      const gapDays = (ctx.now.getTime() - c.lastOrderAt.getTime()) / 86400000;
      if (gapDays < coupon.inactiveDays) return no("This welcome-back offer isn't applicable right now");
    } else if (c.completedOrders === 0) {
      return no("This welcome-back offer isn't applicable right now");
    }
  }

  if (coupon.totalLimit != null && ctx.totalRedemptions >= coupon.totalLimit)
    return no("This offer is fully redeemed");
  if (ctx.customerRedemptions >= coupon.perCustomerLimit)
    return no("You have already used this offer");

  // ---- reward computation
  let discount = 0;
  let freeDelivery = false;
  switch (coupon.rewardType) {
    case "PERCENT":
      discount = (ctx.subtotal * coupon.value) / 100;
      if (coupon.maxDiscount != null) discount = Math.min(discount, coupon.maxDiscount);
      break;
    case "FLAT":
      discount = Math.min(coupon.value, ctx.subtotal);
      break;
    case "FREE_DELIVERY":
      if (ctx.orderType !== "DELIVERY") return no("Free delivery applies to delivery orders");
      freeDelivery = true;
      break;
    case "FREE_ITEM": {
      if (!coupon.freeItemId || !ctx.itemIdsInCart.includes(coupon.freeItemId))
        return no("Add the qualifying free item to your cart first");
      discount = ctx.itemPriceById[coupon.freeItemId] ?? 0;
      break;
    }
    default:
      return no("Unsupported offer type");
  }
  discount = round2(Math.min(discount, ctx.subtotal));
  const savings = round2(discount + (freeDelivery ? ctx.deliveryFee : 0));
  if (savings <= 0) return no("This offer would not save anything on this cart");

  return { coupon, eligible: true, discount, freeDelivery, savings };
}

/** Evaluate all coupons; returns evaluations sorted best-first and the best pick. */
export function rankCoupons(coupons: CouponLike[], ctx: CouponContext) {
  const evals = coupons.map((c) => evaluateCoupon(c, ctx));
  const eligible = evals
    .filter((e) => e.eligible)
    .sort((a, b) => b.savings - a.savings || b.coupon.priority - a.coupon.priority);
  return { all: evals, eligible, best: eligible[0] ?? null };
}
