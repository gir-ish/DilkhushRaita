import { createHmac, timingSafeEqual } from "crypto";
import { db } from "@/lib/db";
import { notifyUser } from "@/lib/notify";

/**
 * Modular payment provider. Select with the PAYMENT_PROVIDER env variable:
 *
 *   cod      — Cash on delivery only. No gateway involved; "ONLINE" is refused
 *              by the order route.
 *
 *   razorpay — Razorpay Checkout (razorpay.com). Supports UPI (incl. GPay /
 *              PhonePe / Paytm intent), cards, netbanking and wallets.
 *              Env: RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 *
 * Razorpay's REST API is called directly with fetch rather than via their npm
 * SDK — same approach as src/lib/otp.ts, and it keeps the dependency list (and
 * therefore the cPanel `npm install`) small.
 *
 * SECURITY: the browser is never trusted to report that a payment succeeded.
 * A payment is only marked PAID after either
 *   (a) the Checkout signature verifies (verifyCheckoutSignature), or
 *   (b) an authentic webhook arrives (verifyWebhookSignature),
 * AND the captured amount matches the order total.
 */

const RAZORPAY_API = "https://api.razorpay.com/v1";

export function paymentProvider(): string {
  return process.env.PAYMENT_PROVIDER ?? "cod";
}

export function onlinePaymentsEnabled(): boolean {
  return paymentProvider() === "razorpay";
}

/** Rupees (float) → paise (integer), which is the only unit Razorpay accepts. */
export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

function authHeader(): string {
  const id = process.env.RAZORPAY_KEY_ID ?? "";
  const secret = process.env.RAZORPAY_KEY_SECRET ?? "";
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

/** Constant-time string compare that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface RazorpayOrder {
  id: string;
  amount: number; // paise
  currency: string;
  status: string;
}

/** Razorpay refuses anything below ₹1, with an opaque BAD_REQUEST_ERROR. */
export const MIN_ORDER_PAISE = 100;

/**
 * Why a gateway order could not be opened. The caller needs these apart because
 * they are not the same kind of problem: "auth" means *our* keys are wrong and
 * every online order will fail until someone fixes the env, whereas "gateway"
 * and "network" are usually transient and worth retrying.
 */
export type GatewayOrderFailure = "amount-too-small" | "auth" | "gateway" | "network";

export type GatewayOrderResult =
  | { ok: true; order: RazorpayOrder }
  | { ok: false; reason: GatewayOrderFailure };

/**
 * Creates the gateway-side order the Checkout modal is opened against.
 * `receipt` should be our own order number so payments can be reconciled.
 */
export async function createGatewayOrder(opts: {
  amountRupees: number;
  receipt: string;
  notes?: Record<string, string>;
}): Promise<GatewayOrderResult> {
  const amount = toPaise(opts.amountRupees);

  // Checked here rather than at the call site so every path into the gateway is
  // covered. A 100%-off coupon plus loyalty credit really can drive a total to
  // ₹0, and without this the customer would just see "could not start payment".
  if (amount < MIN_ORDER_PAISE) {
    console.error(
      `[pay][razorpay] refusing to open an order for ${amount}p (minimum ${MIN_ORDER_PAISE}p) on receipt ${opts.receipt}`
    );
    return { ok: false, reason: "amount-too-small" };
  }

  try {
    const res = await fetch(`${RAZORPAY_API}/orders`, {
      method: "POST",
      headers: { authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        amount,
        currency: "INR",
        receipt: opts.receipt,
        notes: opts.notes ?? {},
      }),
    });
    const data = (await res.json().catch(() => ({}))) as Partial<RazorpayOrder> & {
      error?: unknown;
    };
    if (!res.ok || !data.id) {
      if (res.status === 401) {
        // Loud on purpose: this is a deployment fault, not a customer fault.
        // Nothing will be payable until RAZORPAY_KEY_ID/SECRET are corrected.
        console.error(
          "[pay][razorpay] AUTH FAILED (401) — check RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET:",
          data
        );
        return { ok: false, reason: "auth" };
      }
      console.error("[pay][razorpay] create order failed:", res.status, data);
      return { ok: false, reason: "gateway" };
    }
    return { ok: true, order: data as RazorpayOrder };
  } catch (e) {
    console.error("[pay][razorpay] network error creating order:", e);
    return { ok: false, reason: "network" };
  }
}

/**
 * Verifies the signature Checkout hands back in the browser.
 * Razorpay signs `<razorpay_order_id>|<razorpay_payment_id>` with the key secret.
 */
export function verifyCheckoutSignature(opts: {
  razorpayOrderId: string;
  razorpayPaymentId: string;
  signature: string;
}): boolean {
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret)
    .update(`${opts.razorpayOrderId}|${opts.razorpayPaymentId}`)
    .digest("hex");
  return safeEqual(expected, opts.signature);
}

/**
 * Verifies a webhook. Must be given the EXACT raw request body — re-serialising
 * parsed JSON changes the bytes and the signature will not match.
 */
export function verifyWebhookSignature(rawBody: string, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  return safeEqual(expected, signature);
}

export interface RazorpayPayment {
  id: string;
  status: string; // created | authorized | captured | refunded | failed
  amount: number; // paise
  order_id: string;
  method?: string;
}

/**
 * Server-side fetch of the authoritative payment record. Used to confirm the
 * captured amount really matches what we charged, so a tampered client cannot
 * pay ₹1 for a ₹500 order even with a valid signature.
 */
export async function fetchPayment(paymentId: string): Promise<RazorpayPayment | null> {
  try {
    const res = await fetch(`${RAZORPAY_API}/payments/${paymentId}`, {
      headers: { authorization: authHeader() },
    });
    const data = (await res.json().catch(() => ({}))) as Partial<RazorpayPayment>;
    if (!res.ok || !data.id) {
      console.error("[pay][razorpay] fetch payment failed:", res.status, data);
      return null;
    }
    return data as RazorpayPayment;
  } catch (e) {
    console.error("[pay][razorpay] network error fetching payment:", e);
    return null;
  }
}

/**
 * The gateway's own view of an order. `amount_paid` is the honest test of
 * whether money arrived — a customer can make several attempts against one
 * gateway order, so a single failed payment does not mean the order is dead.
 */
export async function gatewayOrderIsPaid(providerOrderId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${RAZORPAY_API}/orders/${providerOrderId}`, {
      headers: { authorization: authHeader() },
    });
    const data = (await res.json().catch(() => ({}))) as {
      status?: string;
      amount_paid?: number;
    };
    if (!res.ok) {
      console.error("[pay][razorpay] fetch order failed:", res.status, data);
      return null; // unknown — caller must not treat this as "unpaid"
    }
    return data.status === "paid" || (data.amount_paid ?? 0) > 0;
  } catch (e) {
    console.error("[pay][razorpay] network error fetching order:", e);
    return null;
  }
}

export type MarkPaidResult = "paid" | "already-paid" | "not-found" | "amount-mismatch";

/**
 * Settles an order as PAID. Shared by the browser callback and the webhook,
 * which race each other by design — whichever authentic confirmation arrives
 * first wins and the other is a no-op.
 *
 * `capturedPaise` is re-checked against the stored order total here (not only
 * at the call site) so every path into "PAID" is amount-verified.
 */
export async function markOrderPaid(opts: {
  orderId: string;
  gatewayPaymentId: string;
  capturedPaise: number;
  method?: string;
  viaWebhook: boolean;
}): Promise<MarkPaidResult> {
  const order = await db.order.findUnique({
    where: { id: opts.orderId },
    include: { payment: true, branch: { select: { name: true } } },
  });
  if (!order) return "not-found";

  if (toPaise(order.total) !== opts.capturedPaise) {
    console.error(
      `[pay] amount mismatch on order ${order.orderNumber}: expected ${toPaise(order.total)}p, captured ${opts.capturedPaise}p`
    );
    return "amount-mismatch";
  }

  if (order.paymentStatus === "PAID") {
    // The other confirmation path already settled it. Still record that the
    // webhook independently vouched for this payment.
    if (opts.viaWebhook && order.payment && !order.payment.webhookVerified)
      await db.payment.update({
        where: { orderId: order.id },
        data: { webhookVerified: true },
      });
    return "already-paid";
  }

  await db.$transaction([
    db.order.update({ where: { id: order.id }, data: { paymentStatus: "PAID" } }),
    db.payment.update({
      where: { orderId: order.id },
      data: {
        status: "PAID",
        providerRef: opts.gatewayPaymentId,
        ...(opts.method ? { method: opts.method.toUpperCase() } : {}),
        ...(opts.viaWebhook ? { webhookVerified: true } : {}),
      },
    }),
  ]);

  await notifyUser(
    order.userId,
    "ORDER_PLACED",
    "Payment received ✅",
    `Order ${order.orderNumber} is paid and has been sent to ${order.branch.name}. We'll confirm it shortly.`
  );
  return "paid";
}
