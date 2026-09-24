import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { onOrderDelivered } from "@/lib/order-effects";
import { KHATA_METHODS, ON_KHATA, chargeToKhata } from "@/lib/khata";
import { buildQuote } from "@/lib/quote";
import { computeTotals } from "@/lib/pricing";
import { COUNTER_LIMITS } from "@/lib/order-limits";
import { round2 } from "@/lib/utils";

/**
 * A parcel at the counter: take its payment, hand it over, or both at once.
 *
 * The customer ordered and waited, and pays when they collect it — by cash,
 * UPI or card, or onto their khata. Payment can also come first while the
 * food is still cooking; handing over is then a separate tap.
 *
 * Handing over is allowed from any stage the kitchen has reached, not only
 * READY: the cashier is looking at the bag going out, and a kitchen that did
 * not tap "ready" must not leave a parcel stuck on the counter screen.
 */
const Body = z.object({
  // Needed only while the parcel is unpaid.
  paymentMethod: z.enum(["CASH", "ONLINE", "KHATA"]).optional(),
  paidNow: z.number().min(0).max(10_000_000).optional(),
  paidNowMethod: z.enum(KHATA_METHODS).optional(),
  handOver: z.boolean().default(true),
});

const AddBody = z.object({
  items: z
    .array(
      z.object({
        menuItemId: z.string(),
        variantId: z.string().nullish(),
        addOnIds: z.array(z.string()).max(10).optional(),
        qty: z.number().int().min(1).max(999),
        instructions: z.string().max(300).nullish(),
      })
    )
    .min(1)
    .max(200),
  /** How the extra is paid, when the parcel was already settled. */
  extraPayment: z.enum(["CASH", "ONLINE"]).optional(),
});

/**
 * More items onto a parcel that has not been handed over yet.
 *
 * The customer is at the counter collecting and asks for one more roti. The
 * parcel is still here, so the roti goes onto the same bill rather than
 * becoming a second order with its own number.
 *
 * What they already paid is never charged again: an unpaid parcel simply grows
 * and is collected in full at handover, while a parcel already settled is
 * charged for the difference and nothing else. Existing lines keep their
 * snapshot prices; only the new ones are quoted at today's.
 */
export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
    const body = AddBody.parse(await req.json());

    const order = await db.order.findUnique({ where: { id }, include: { items: true, branch: true } });
    if (!order || order.type !== "PICKUP") throw new HttpError(404, "Parcel not found");
    const scope = await allowedBranchIds(s);
    if (scope && !scope.includes(order.branchId))
      throw new HttpError(403, "That parcel belongs to a different branch");
    if (!["ACCEPTED", "PREPARING", "READY"].includes(order.status))
      throw new HttpError(409, `That parcel is already ${order.status.toLowerCase().replace(/_/g, " ")}`);

    const settled = order.paymentStatus === "PAID";
    const onKhata = order.paymentStatus === ON_KHATA;
    if (settled && !body.extraPayment)
      throw new HttpError(400, "This parcel is paid for — choose how the extra is being paid");

    const quote = await buildQuote(
      { branchId: order.branchId, orderType: "PICKUP", items: body.items, autoOffers: false },
      order.userId,
      false,
      COUNTER_LIMITS
    );

    const nextRound = Math.max(...order.items.map((i) => i.round), 0) + 1;
    const before = order.total;

    const updated = await db.$transaction(async (tx) => {
      for (const line of quote.lines) {
        const res = await tx.branchMenuItem.updateMany({
          where: { branchId: order.branchId, menuItemId: line.menuItemId, stockQty: { gte: line.qty } },
          data: { stockQty: { decrement: line.qty } },
        });
        if (res.count === 0) {
          const bi = await tx.branchMenuItem.findUnique({
            where: { branchId_menuItemId: { branchId: order.branchId, menuItemId: line.menuItemId } },
          });
          if (bi && bi.stockQty !== -1) throw new HttpError(409, `${line.name} is out of stock`);
        }
      }

      await tx.orderItem.createMany({
        data: quote.lines.map((l) => ({
          orderId: order.id,
          menuItemId: l.menuItemId,
          nameSnapshot: l.name,
          variantName: l.variantName,
          addOnsJson: JSON.stringify(l.addOns.map((a) => ({ name: a.name, price: a.price }))),
          unitPrice: l.unitPrice,
          qty: l.qty,
          lineTotal: l.lineTotal,
          instructions: l.instructions,
          round: nextRound,
        })),
      });

      const allItems = await tx.orderItem.findMany({ where: { orderId: order.id } });
      const totals = computeTotals({
        lines: allItems.map((i) => ({ unitPrice: i.unitPrice, qty: i.qty })),
        cfg: order.branch,
        orderType: "PICKUP",
        distanceKm: null,
        discount: order.discount,
      });

      const saved = await tx.order.update({
        where: { id: order.id },
        data: {
          subtotal: totals.subtotal,
          packagingFee: totals.packagingFee,
          tax: totals.tax,
          total: totals.total,
          // There is food to cook again, whatever the kitchen had marked.
          ...(order.status === "READY" ? { status: "ACCEPTED", readyAt: null } : {}),
        },
      });

      const extra = round2(saved.total - before);
      // The bill is the whole parcel either way; only who owes what changes.
      await tx.payment.updateMany({
        where: { orderId: order.id },
        data: {
          amount: saved.total,
          ...(settled
            ? { method: body.extraPayment === "CASH" ? "CASH" : "ONLINE" }
            : {}),
        },
      });
      // Already on khata: the extra joins the same account, so the ledger and
      // the bill still agree.
      if (onKhata && extra > 0)
        await chargeToKhata(tx, {
          userId: order.userId,
          orderId: order.id,
          branchId: order.branchId,
          amount: extra,
          staff: { uid: s.uid, name: s.name },
        });
      return { saved, extra };
    });

    await audit({ uid: s.uid, name: s.name }, "PARCEL_ITEMS_ADDED", "Order", order.id, {
      orderNumber: order.orderNumber,
      round: nextRound,
      extra: updated.extra,
      newTotal: updated.saved.total,
      ...(settled ? { extraPaidBy: body.extraPayment } : {}),
    });

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      orderNumber: order.orderNumber,
      total: updated.saved.total,
      /** What the new items came to — all that is owed, if the rest was paid. */
      extra: updated.extra,
      settled,
    });
  }
);

export const PATCH = handler(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
  const { id } = await params;
  const body = Body.parse(await req.json());

  const order = await db.order.findUnique({ where: { id } });
  if (!order || order.type !== "PICKUP") throw new HttpError(404, "Parcel not found");
  const scope = await allowedBranchIds(s);
  if (scope && !scope.includes(order.branchId)) throw new HttpError(403, "That parcel belongs to a different branch");
  if (!["ACCEPTED", "PREPARING", "READY"].includes(order.status))
    throw new HttpError(409, `That parcel is already ${order.status.toLowerCase().replace(/_/g, " ")}`);

  // Still to be paid at the counter: cash-on-pickup, nothing taken yet.
  const unpaid = order.paymentStatus === "PENDING" && order.paymentMethod === "COD";
  if (unpaid && !body.paymentMethod) throw new HttpError(400, "Choose how they are paying");
  if (!unpaid && body.paymentMethod) throw new HttpError(409, "That parcel is already paid for");
  if (!unpaid && !body.handOver) throw new HttpError(400, "Nothing to do");

  const khata = body.paymentMethod === "KHATA";
  await db.$transaction(async (tx) => {
    if (unpaid) {
      const status = khata ? ON_KHATA : "PAID";
      await tx.order.update({
        where: { id },
        data: { paymentMethod: khata ? "KHATA" : body.paymentMethod === "CASH" ? "COD" : "ONLINE", paymentStatus: status },
      });
      await tx.payment.updateMany({
        where: { orderId: id },
        data: { status, method: khata ? "KHATA" : body.paymentMethod === "CASH" ? "CASH" : "ONLINE", amount: order.total },
      });
      if (khata)
        await chargeToKhata(tx, {
          userId: order.userId,
          orderId: id,
          branchId: order.branchId,
          amount: order.total,
          paidNow: body.paidNow,
          paidNowMethod: body.paidNowMethod,
          staff: { uid: s.uid, name: s.name },
        });
    }
    if (body.handOver)
      await tx.order.update({
        where: { id },
        data: { status: "DELIVERED", deliveredAt: new Date(), readyAt: order.readyAt ?? new Date() },
      });
  });

  // Loyalty points and the customer's totals, as for any completed order.
  if (body.handOver) await onOrderDelivered(id);

  await audit({ uid: s.uid, name: s.name }, "PARCEL_COLLECTED", "Order", id, {
    orderNumber: order.orderNumber,
    total: order.total,
    ...(unpaid ? { paymentMethod: body.paymentMethod, ...(khata ? { paidNow: body.paidNow ?? 0 } : {}) } : {}),
    handedOver: body.handOver,
  });
  return NextResponse.json({ ok: true, orderNumber: order.orderNumber, total: order.total });
});
