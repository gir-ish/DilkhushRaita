import { createHmac } from "crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  onlinePaymentsEnabled,
  paymentProvider,
  toPaise,
  verifyCheckoutSignature,
  verifyWebhookSignature,
} from "@/lib/payments";

const KEY_SECRET = "test_secret_do_not_use_in_prod";
const WEBHOOK_SECRET = "test_webhook_secret";

const ENV_KEYS = [
  "RAZORPAY_KEY_SECRET",
  "RAZORPAY_WEBHOOK_SECRET",
  "PAYMENT_PROVIDER",
] as const;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.RAZORPAY_KEY_SECRET = KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = WEBHOOK_SECRET;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

function signCheckout(orderId: string, paymentId: string, secret = KEY_SECRET) {
  return createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
}

describe("toPaise", () => {
  it("converts whole rupees", () => {
    expect(toPaise(500)).toBe(50000);
  });

  it("converts paise-precision amounts exactly", () => {
    expect(toPaise(499.99)).toBe(49999);
    expect(toPaise(0.01)).toBe(1);
  });

  // Order totals are computed as JS floats, so the classic 0.1+0.2 artefact
  // can reach this function. It must not become 30.000000000000004 paise.
  it("survives floating-point artefacts", () => {
    expect(toPaise(0.1 + 0.2)).toBe(30);
    expect(Number.isInteger(toPaise(1234.565))).toBe(true);
  });

  it("never emits a fractional paise value", () => {
    for (const rupees of [1.005, 33.333, 99.999, 1e-3]) {
      expect(Number.isInteger(toPaise(rupees))).toBe(true);
    }
  });
});

describe("verifyCheckoutSignature", () => {
  const orderId = "order_ABC123";
  const paymentId = "pay_XYZ789";

  it("accepts a genuine signature", () => {
    expect(
      verifyCheckoutSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        signature: signCheckout(orderId, paymentId),
      })
    ).toBe(true);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(
      verifyCheckoutSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        signature: signCheckout(orderId, paymentId, "attacker_secret"),
      })
    ).toBe(false);
  });

  // The signature covers order_id|payment_id, so swapping either must break it.
  it("rejects a signature bound to a different order", () => {
    expect(
      verifyCheckoutSignature({
        razorpayOrderId: "order_DIFFERENT",
        razorpayPaymentId: paymentId,
        signature: signCheckout(orderId, paymentId),
      })
    ).toBe(false);
  });

  it("rejects a signature bound to a different payment", () => {
    expect(
      verifyCheckoutSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: "pay_DIFFERENT",
        signature: signCheckout(orderId, paymentId),
      })
    ).toBe(false);
  });

  it("rejects empty and malformed signatures", () => {
    for (const signature of ["", "deadbeef", "x".repeat(64)]) {
      expect(
        verifyCheckoutSignature({
          razorpayOrderId: orderId,
          razorpayPaymentId: paymentId,
          signature,
        })
      ).toBe(false);
    }
  });

  // Fail closed: an unconfigured server must never accept a payment.
  it("rejects everything when the key secret is not configured", () => {
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(
      verifyCheckoutSignature({
        razorpayOrderId: orderId,
        razorpayPaymentId: paymentId,
        signature: signCheckout(orderId, paymentId),
      })
    ).toBe(false);
  });
});

describe("verifyWebhookSignature", () => {
  const body = JSON.stringify({
    event: "payment.captured",
    payload: { payment: { entity: { id: "pay_1", order_id: "order_1", amount: 50000 } } },
  });
  const sign = (raw: string, secret = WEBHOOK_SECRET) =>
    createHmac("sha256", secret).update(raw).digest("hex");

  it("accepts an authentic webhook", () => {
    expect(verifyWebhookSignature(body, sign(body))).toBe(true);
  });

  // The amount lives in the signed body, so tampering with it must invalidate
  // the signature — this is what stops a forged "paid ₹5000" callback.
  it("rejects a tampered body", () => {
    const tampered = body.replace("50000", "1");
    expect(verifyWebhookSignature(tampered, sign(body))).toBe(false);
  });

  it("rejects a signature from the wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "wrong_secret"))).toBe(false);
  });

  it("rejects an empty signature", () => {
    expect(verifyWebhookSignature(body, "")).toBe(false);
  });

  it("rejects everything when the webhook secret is not configured", () => {
    delete process.env.RAZORPAY_WEBHOOK_SECRET;
    expect(verifyWebhookSignature(body, sign(body))).toBe(false);
  });
});

describe("provider gating", () => {
  it("defaults to cod when unset", () => {
    delete process.env.PAYMENT_PROVIDER;
    expect(paymentProvider()).toBe("cod");
    expect(onlinePaymentsEnabled()).toBe(false);
  });

  it("enables online only for razorpay", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    expect(onlinePaymentsEnabled()).toBe(true);
    process.env.PAYMENT_PROVIDER = "cod";
    expect(onlinePaymentsEnabled()).toBe(false);
  });
});
