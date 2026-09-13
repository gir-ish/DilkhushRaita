import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { onOrderDelivered } from "@/lib/order-effects";
import { KHATA_METHODS, ON_KHATA, chargeToKhata } from "@/lib/khata";

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
