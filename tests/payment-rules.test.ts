import { describe, expect, it } from "vitest";
import { DEFAULT_PAYMENT_RULES, paymentOptions, type PaymentRules } from "@/lib/payment-rules";

/**
 * Which ways a customer may pay, and the reason when they may not — the same
 * answer the checkout screen shows and the order route enforces, so the two
 * cannot disagree.
 */

const rules = (over: Partial<PaymentRules> = {}): PaymentRules => ({ ...DEFAULT_PAYMENT_RULES, ...over });
const ctx = (over: Partial<Parameters<typeof paymentOptions>[1]> = {}) => ({
  total: 500,
  nowHHmm: "13:00",
  onlineConfigured: true,
  ...over,
});

describe("by default", () => {
  it("offers both", () => {
    const o = paymentOptions(rules(), ctx());
    expect(o.cod.allowed).toBe(true);
    expect(o.online.allowed).toBe(true);
  });

  it("offers no online payment until a gateway is set up", () => {
    const o = paymentOptions(rules(), ctx({ onlineConfigured: false }));
    expect(o.online).toEqual({ allowed: false, reason: "Online payment is not set up yet" });
    expect(o.cod.allowed).toBe(true);
  });
});

describe("switches", () => {
  it("closes cash when the owner turns it off", () => {
    const o = paymentOptions(rules({ codEnabled: false }), ctx());
    expect(o.cod).toEqual({ allowed: false, reason: "Cash is not being accepted right now" });
    expect(o.online.allowed).toBe(true);
  });

  it("closes online when the owner turns it off", () => {
    const o = paymentOptions(rules({ onlineEnabled: false }), ctx());
    expect(o.online).toEqual({ allowed: false, reason: "Online payment is switched off right now" });
  });
});

describe("a ceiling on cash", () => {
  it("lets a bill at the limit through and stops the one above it", () => {
    const r = rules({ codMaxOrderValue: 2000 });
    expect(paymentOptions(r, ctx({ total: 2000 })).cod.allowed).toBe(true);
    const over = paymentOptions(r, ctx({ total: 2000.5 })).cod;
    expect(over.allowed).toBe(false);
    expect(over.reason).toBe("Orders above ₹2,000 must be paid online");
  });
});

describe("cash hours", () => {
  it("takes cash inside the window and not outside it", () => {
    const r = rules({ codFrom: "06:00", codTo: "21:00" });
    expect(paymentOptions(r, ctx({ nowHHmm: "20:59" })).cod.allowed).toBe(true);
    const night = paymentOptions(r, ctx({ nowHHmm: "21:30" })).cod;
    expect(night.allowed).toBe(false);
    expect(night.reason).toBe("Cash is accepted 06:00–21:00 only");
  });

  it("handles a window that runs past midnight", () => {
    // A dhaba open late: cash from 11am until 2am.
    const r = rules({ codFrom: "11:00", codTo: "02:00" });
    expect(paymentOptions(r, ctx({ nowHHmm: "23:30" })).cod.allowed).toBe(true);
    expect(paymentOptions(r, ctx({ nowHHmm: "01:30" })).cod.allowed).toBe(true);
    expect(paymentOptions(r, ctx({ nowHHmm: "09:00" })).cod.allowed).toBe(false);
  });
});

describe("a customer put on prepaid only", () => {
  it("is told so, whatever the shop-wide rule says", () => {
    const o = paymentOptions(rules(), ctx({ codBlockedForCustomer: true }));
    expect(o.cod).toEqual({ allowed: false, reason: "This account is set to online payment only" });
    expect(o.online.allowed).toBe(true);
  });
});
