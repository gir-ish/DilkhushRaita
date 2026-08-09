import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { buildQuote } from "@/lib/quote";
import { genOrderNumber, normalizePhone } from "@/lib/utils";

const Body = z.object({
  branchId: z.string(),
  items: z
    .array(
      z.object({
        menuItemId: z.string(),
        variantId: z.string().nullish(),
        addOnIds: z.array(z.string()).max(10).optional(),
        qty: z.number().int().min(1).max(50),
        instructions: z.string().max(300).nullish(),
      })
    )
    .min(1)
    .max(60),
  // Either an existing customer, or a name+phone to create/reuse one.
  userId: z.string().nullish(),
  name: z.string().max(60).nullish(),
  phone: z.string().max(15).nullish(),
  // PARCEL is billed and settled immediately. DINE_IN opens a running tab the
  // customer keeps adding to, settled when they leave.
  orderType: z.enum(["PARCEL", "DINE_IN"]).default("PARCEL"),
  tableNo: z.string().max(20).nullish(),
  paymentMethod: z.enum(["CASH", "ONLINE"]).default("CASH"),
  paid: z.boolean().default(true),
  instructions: z.string().max(500).nullish(),
});

/**
 * Walk-in / counter order taken by staff on the customer's behalf.
 *
 * Differs from the customer checkout in three ways:
 *  - Quoting is non-strict. The customer is physically at the counter, so
 *    "branch is closed" or "pickup disabled" must not block a sale; those
 *    become warnings the staff member already knows about.
 *  - It starts at ACCEPTED, not PLACED — the restaurant demonstrably has the
 *    order, so it should not sit waiting to be confirmed.
 *  - Payment is usually settled immediately at the till.
 *
 * Prices are still recomputed server-side from the menu; the browser only ever
 * sends item ids and quantities.
 */
export const POST = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
  const body = Body.parse(await req.json());

  // Without this a branch manager could raise an order against a branch they
  // don't run — and then never see it again, because the order queue scopes
  // them to their own branches.
  const scope = await allowedBranchIds(s);
  if (scope && !scope.includes(body.branchId))
    throw new HttpError(403, "You cannot take orders for that branch");

  // ---- resolve the customer -------------------------------------------
  let userId = body.userId ?? null;
  if (userId) {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u || u.role !== "CUSTOMER") throw new HttpError(400, "That customer no longer exists");
    if (u.blocked) throw new HttpError(403, "That customer account is blocked");
  } else {
    const phone = normalizePhone(body.phone ?? "");
    if (!phone) throw new HttpError(400, "Enter a valid 10-digit mobile number");
    // The number is the identity; a name is a nicety. At a counter with a queue
    // behind them, asking the cashier to type one before the bill can be raised
    // just gets "." typed into the box. The bill falls back to "Walk-in".
    const name = body.name?.trim() || null;

    const existing = await db.user.findUnique({ where: { phone } });
    if (existing) {
      // Never silently take over a staff or delivery-agent number.
      if (existing.role !== "CUSTOMER")
        throw new HttpError(409, "That number belongs to a staff account. Use a different number.");
      if (existing.blocked) throw new HttpError(403, "That customer account is blocked");
      userId = existing.id;
      // Fill in a name only if we never had one — don't overwrite what the
      // customer chose for themselves.
      if (!existing.name && name) await db.user.update({ where: { id: existing.id }, data: { name } });
    } else {
      const created = await db.user.create({
        data: {
          phone,
          name,
          role: "CUSTOMER",
          profile: {
            create: { referralCode: "DK" + Math.random().toString(36).slice(2, 8).toUpperCase() },
          },
          metrics: { create: {} },
        },
      });
      userId = created.id;
    }
  }

  // ---- price it --------------------------------------------------------
  const dineIn = body.orderType === "DINE_IN";
  // A parcel is a takeaway (PICKUP). DINE_IN skips both the delivery and pickup
  // capability checks — the customer is eating here, so neither is relevant.
  // Neither carries a delivery fee.
  const quote = await buildQuote(
    { branchId: body.branchId, orderType: dineIn ? "DINE_IN" : "PICKUP", items: body.items },
    userId,
    false // non-strict: staff is standing with the customer
  );

  // A dine-in tab is settled when the customer leaves, so it must not be
  // marked paid up front however the client asks.
  const paid = dineIn ? false : body.paid;

  const orderNumber = genOrderNumber();
  const order = await db.$transaction(async (tx) => {
    for (const line of quote.lines) {
      const updated = await tx.branchMenuItem.updateMany({
        where: {
          branchId: quote.branch.id,
          menuItemId: line.menuItemId,
          stockQty: { gte: line.qty },
        },
        data: { stockQty: { decrement: line.qty } },
      });
      if (updated.count === 0) {
        const bi = await tx.branchMenuItem.findUnique({
          where: { branchId_menuItemId: { branchId: quote.branch.id, menuItemId: line.menuItemId } },
        });
        // stockQty -1 means "not tracked", so only a real shortfall blocks.
        if (bi && bi.stockQty !== -1)
          throw new HttpError(409, `${line.name} is out of stock — remove it to continue`);
      }
    }

    return tx.order.create({
      data: {
        orderNumber,
        userId: userId!,
        branchId: quote.branch.id,
        type: dineIn ? "DINE_IN" : "PICKUP",
        tableNo: dineIn ? (body.tableNo?.trim() || null) : null,
        status: "ACCEPTED",
        acceptedAt: new Date(),
        instructions: body.instructions ?? null,
        cutlery: true,
        subtotal: quote.totals.subtotal,
        discount: quote.totals.discount,
        deliveryFee: 0,
        packagingFee: quote.totals.packagingFee,
        tax: quote.totals.tax,
        loyaltyCredit: 0,
        total: quote.totals.total,
        paymentMethod: body.paymentMethod === "CASH" ? "COD" : "ONLINE",
        paymentStatus: paid ? "PAID" : "PENDING",
        etaMins: quote.etaMins,
        staffNotes: `Counter order taken by ${s.name ?? "staff"}`,
        items: {
          create: quote.lines.map((l) => ({
            menuItemId: l.menuItemId,
            nameSnapshot: l.name,
            variantName: l.variantName,
            addOnsJson: JSON.stringify(l.addOns.map((a) => ({ name: a.name, price: a.price }))),
            unitPrice: l.unitPrice,
            qty: l.qty,
            lineTotal: l.lineTotal,
            instructions: l.instructions,
          })),
        },
        payment: {
          create: {
            provider: "cod",
            method: body.paymentMethod === "CASH" ? "CASH" : "ONLINE",
            status: paid ? "PAID" : "PENDING",
            amount: quote.totals.total,
          },
        },
      },
    });
  });

  await audit({ uid: s.uid, name: s.name }, "COUNTER_ORDER_CREATED", "Order", order.id, {
    orderNumber,
    total: quote.totals.total,
    paid,
    orderType: body.orderType,
  });

  return NextResponse.json({
    ok: true,
    orderId: order.id,
    orderNumber: order.orderNumber,
    total: quote.totals.total,
    warnings: quote.warnings,
  });
});
