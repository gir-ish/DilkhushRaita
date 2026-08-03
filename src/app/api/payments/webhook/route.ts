import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler } from "@/lib/guard";
import { markOrderPaid, verifyWebhookSignature } from "@/lib/payments";

/**
 * Razorpay server-to-server webhook. This is the authoritative confirmation:
 * /api/payments/verify only runs if the customer's browser survives long enough
 * to call it, whereas this arrives even if they close the tab or lose signal
 * mid-payment. Without it, real money can be taken for an order that never gets
 * cooked.
 *
 * Configure in Razorpay Dashboard → Settings → Webhooks:
 *   URL     https://dilkhushraita.com/api/payments/webhook
 *   Secret  must equal RAZORPAY_WEBHOOK_SECRET
 *   Events  payment.captured, payment.failed
 *
 * Deliberately unauthenticated — Razorpay cannot hold a session. The HMAC
 * signature over the raw body is what proves authenticity, so the raw text must
 * be read before any JSON parsing (re-serialising would change the bytes).
 */

interface WebhookPayment {
  id?: string;
  order_id?: string;
  amount?: number;
  status?: string;
  method?: string;
}

export const POST = handler(async (req: Request) => {
  const raw = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";

  if (!verifyWebhookSignature(raw, signature)) {
    console.error("[pay][webhook] rejected: bad or missing signature");
    // 400, not 200 — an unsigned caller should never be told "thanks".
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  let event: { event?: string; payload?: { payment?: { entity?: WebhookPayment } } };
  try {
    event = JSON.parse(raw);
  } catch {
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  const entity = event.payload?.payment?.entity;
  if (!entity?.order_id || !entity.id)
    return NextResponse.json({ ok: true, ignored: "no payment entity" });

  const payment = await db.payment.findFirst({
    where: { providerOrderId: entity.order_id },
    select: { orderId: true },
  });
  if (!payment) {
    // Unknown order — acknowledge so Razorpay stops retrying a payment we
    // genuinely have no record of, but leave a trail for reconciliation.
    console.error(`[pay][webhook] no local order for gateway order ${entity.order_id}`);
    return NextResponse.json({ ok: true, ignored: "unknown order" });
  }

  if (event.event === "payment.captured" && typeof entity.amount === "number") {
    const result = await markOrderPaid({
      orderId: payment.orderId,
      gatewayPaymentId: entity.id,
      capturedPaise: entity.amount,
      method: entity.method,
      viaWebhook: true,
    });
    if (result === "amount-mismatch") {
      // Do NOT mark paid. Returning 200 stops pointless retries; the console
      // error is the signal to reconcile this one by hand.
      console.error(`[pay][webhook] amount mismatch on order ${payment.orderId}`);
      return NextResponse.json({ ok: true, flagged: "amount-mismatch" });
    }
    return NextResponse.json({ ok: true, result });
  }

  if (event.event === "payment.failed") {
    await db.payment.updateMany({
      where: { orderId: payment.orderId, status: "PENDING" },
      data: { status: "FAILED", providerRef: entity.id, webhookVerified: true },
    });
    return NextResponse.json({ ok: true, result: "failed" });
  }

  return NextResponse.json({ ok: true, ignored: event.event ?? "unknown event" });
});
