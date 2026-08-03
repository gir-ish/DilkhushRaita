import { describe, expect, it } from "vitest";
import { computeTotals, deliveryFeeFor, subtotalOf } from "@/lib/pricing";

const cfg = {
  baseDeliveryFee: 30,
  perKmFee: 7,
  freeKm: 3,
  freeDeliveryAbove: 499,
  packagingFee: 15,
  taxPercent: 5,
};

describe("pricing", () => {
  it("computes subtotal from lines", () => {
    expect(subtotalOf([{ unitPrice: 100, qty: 2 }, { unitPrice: 49.5, qty: 1 }])).toBe(249.5);
  });

  it("charges base fee within free km", () => {
    expect(deliveryFeeFor(cfg, 2.5, 300, false)).toBe(30);
  });

  it("adds per-km fee beyond free km", () => {
    expect(deliveryFeeFor(cfg, 5, 300, false)).toBe(30 + 2 * 7);
  });

  it("free delivery above threshold", () => {
    expect(deliveryFeeFor(cfg, 5, 500, false)).toBe(0);
  });

  it("free delivery flag wins", () => {
    expect(deliveryFeeFor(cfg, 10, 100, true)).toBe(0);
  });

  it("computes a full breakdown", () => {
    const t = computeTotals({
      lines: [{ unitPrice: 200, qty: 2 }],
      cfg,
      orderType: "DELIVERY",
      distanceKm: 4,
      discount: 50,
    });
    expect(t.subtotal).toBe(400);
    expect(t.discount).toBe(50);
    expect(t.deliveryFee).toBe(37); // 30 + 1km * 7
    expect(t.packagingFee).toBe(15);
    expect(t.tax).toBe(17.5); // 5% of (400-50)
    expect(t.total).toBe(400 - 50 + 37 + 15 + 17.5);
  });

  it("pickup orders have no delivery fee", () => {
    const t = computeTotals({
      lines: [{ unitPrice: 100, qty: 1 }],
      cfg,
      orderType: "PICKUP",
      distanceKm: 10,
    });
    expect(t.deliveryFee).toBe(0);
  });

  it("discount can never exceed subtotal and total never negative", () => {
    const t = computeTotals({
      lines: [{ unitPrice: 100, qty: 1 }],
      cfg,
      orderType: "PICKUP",
      discount: 5000,
      loyaltyCredit: 5000,
    });
    expect(t.discount).toBe(100);
    expect(t.total).toBeGreaterThanOrEqual(0);
  });

  it("loyalty credit is capped at payable amount", () => {
    const t = computeTotals({
      lines: [{ unitPrice: 100, qty: 1 }],
      cfg,
      orderType: "PICKUP",
      loyaltyCredit: 100000,
    });
    expect(t.total).toBe(0);
    expect(t.loyaltyCredit).toBe(100 + 15 + 5); // subtotal + packaging + tax
  });
});
