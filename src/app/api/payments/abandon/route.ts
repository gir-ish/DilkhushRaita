import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { onOrderCancelled } from "@/lib/order-effects";
import { gatewayOrderIsPaid } from "@/lib/payments";

const Body = z.object({ orderId: z.string() });

/**
 * The customer closed Razorpay Checkout without paying.
 *
 * An online order is written to the database *before* the payment window opens
 * (the gateway order has to exist first), so walking away used to leave a
 * PLACED order sitting in the kitchen queue looking exactly like a paid one —
 * food gets cooked for money that never arrived. This closes it out.
 *
 * Never trusts the browser's word that the payment failed: Razorpay is asked
 * whether the gateway order was paid, and anything other than a confident "no"
 * leaves the order alone for the webhook to settle. Cancelling a paid order
 * would be far worse than leaving a stale pending one.
 */
export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const { orderId } = Body.parse(await req.json());

  const order = await db.order.findFirst({
    where: { id: orderId, userId: session.uid },
    include: { payment: true },
  });
  if (!order) throw new HttpError(404, "Order not found");

  if (order.paymentStatus === "PAID")
    return NextResponse.json({ ok: true, kept: "already-paid" });
  // Staff have already picked it up — theirs to resolve, not ours to void.
  if (order.status !== "PLACED")
    return NextResponse.json({ ok: true, kept: "in-progress" });
  if (order.paymentMethod !== "ONLINE")
    return NextResponse.json({ ok: true, kept: "not-online" });

  if (order.payment?.providerOrderId) {
    const paid = await gatewayOrderIsPaid(order.payment.providerOrderId);
    // `null` means we could not reach Razorpay. Leave it pending rather than
    // risk voiding an order that was in fact paid.
    if (paid !== false) return NextResponse.json({ ok: true, kept: "unconfirmed" });
  }

  await db.$transaction([
    db.order.update({
      where: { id: order.id },
      data: {
        status: "CANCELLED",
        cancelReason: "Payment not completed",
        cancelledAt: new Date(),
      },
    }),
    db.payment.updateMany({
      where: { orderId: order.id, status: "PENDING" },
      data: { status: "FAILED" },
    }),
  ]);
  // Returns redeemed points and puts stock back.
  await onOrderCancelled(order.id, false);

  return NextResponse.json({ ok: true, cancelled: true });
});
