import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  fetchPayment,
  markOrderPaid,
  onlinePaymentsEnabled,
  verifyCheckoutSignature,
} from "@/lib/payments";

const Body = z.object({
  orderId: z.string(),
  razorpayOrderId: z.string(),
  razorpayPaymentId: z.string(),
  signature: z.string(),
});

/**
 * Called by the browser immediately after Razorpay Checkout reports success.
 *
 * Nothing the browser sends is trusted on its own: the signature is verified
 * with our key secret, the payment is then re-fetched from Razorpay server-side,
 * and the captured amount is compared against the stored order total. The
 * webhook is the backstop for when the customer closes the tab before this runs.
 */
export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  if (!rateLimit(`pay:verify:${clientIp(req)}`, 30, 10 * 60 * 1000))
    throw new HttpError(429, "Too many attempts. Please wait a moment.");

  if (!onlinePaymentsEnabled()) throw new HttpError(400, "Online payment is not enabled");

  const body = Body.parse(await req.json());

  const order = await db.order.findUnique({
    where: { id: body.orderId },
    include: { payment: true },
  });
  if (!order) throw new HttpError(404, "Order not found");
  // Prevents one signed-in customer settling (or probing) another's order.
  if (order.userId !== session.uid) throw new HttpError(403, "Not your order");
  if (!order.payment?.providerOrderId) throw new HttpError(400, "This order has no online payment");
  if (order.payment.providerOrderId !== body.razorpayOrderId)
    throw new HttpError(400, "Payment does not belong to this order");

  if (order.paymentStatus === "PAID")
    return NextResponse.json({ ok: true, alreadyPaid: true, orderId: order.id });

  if (
    !verifyCheckoutSignature({
      razorpayOrderId: body.razorpayOrderId,
      razorpayPaymentId: body.razorpayPaymentId,
      signature: body.signature,
    })
  ) {
    await db.payment.update({
      where: { orderId: order.id },
      data: { status: "FAILED" },
    });
    console.error(`[pay] BAD SIGNATURE on order ${order.orderNumber} from user ${session.uid}`);
    throw new HttpError(400, "Payment could not be verified. If money was debited it will be refunded automatically.");
  }

  // Signature proves the message came from Razorpay; this proves what was
  // actually captured, which the signature alone does not cover.
  const gwPayment = await fetchPayment(body.razorpayPaymentId);
  if (!gwPayment) throw new HttpError(502, "Could not confirm the payment. Please check your orders in a minute.");
  if (gwPayment.order_id !== body.razorpayOrderId)
    throw new HttpError(400, "Payment does not match this order");

  if (gwPayment.status !== "captured") {
    // "authorized" means funds are held but not yet settled — the webhook will
    // finalise it. Anything else is a genuine failure.
    return NextResponse.json({
      ok: true,
      pending: true,
      orderId: order.id,
      message:
        gwPayment.status === "authorized"
          ? "Payment is being confirmed — your order will update shortly."
          : "Payment has not completed yet.",
    });
  }

  const result = await markOrderPaid({
    orderId: order.id,
    gatewayPaymentId: gwPayment.id,
    capturedPaise: gwPayment.amount,
    method: gwPayment.method,
    viaWebhook: false,
  });

  if (result === "amount-mismatch")
    throw new HttpError(400, "Paid amount did not match the order total. Please contact support.");

  return NextResponse.json({ ok: true, orderId: order.id });
});
