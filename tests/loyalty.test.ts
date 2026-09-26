import { describe, expect, it } from "vitest";
import { pointsEarned, pointsValue, redeemablePoints, tierFor } from "@/lib/loyalty";

const tiers = [
  { id: "t0", name: "New Customer", minCompletedOrders: 0, minLifetimeSpend: 0, pointMultiplier: 1, freeDelivery: false, discountPercent: 0, sortOrder: 0 },
  { id: "t1", name: "Regular", minCompletedOrders: 3, minLifetimeSpend: 750, pointMultiplier: 1.2, freeDelivery: false, discountPercent: 0, sortOrder: 1 },
  { id: "t2", name: "Dhaba Lover", minCompletedOrders: 8, minLifetimeSpend: 2500, pointMultiplier: 1.5, freeDelivery: true, discountPercent: 0, sortOrder: 2 },
  { id: "t3", name: "VIP", minCompletedOrders: 20, minLifetimeSpend: 8000, pointMultiplier: 2, freeDelivery: true, discountPercent: 5, sortOrder: 3 },
];

describe("loyalty", () => {
  it("earns 1 point per ₹10", () => {
    expect(pointsEarned(349)).toBe(34);
  });

  it("multiplier scales earning", () => {
    expect(pointsEarned(349, 2)).toBe(69);
  });

  it("100 points = ₹50", () => {
    expect(pointsValue(100)).toBe(50);
  });

  it("needs minimum balance to redeem", () => {
    expect(redeemablePoints(99, 500)).toBe(0);
    expect(redeemablePoints(100, 500)).toBe(100);
  });

  it("cannot redeem past the payable amount", () => {
    expect(redeemablePoints(1000, 100)).toBe(200); // 200 pts = ₹100
  });

  // The scheme is repriced from the dashboard, so every calculation has to
  // follow the supplied rates rather than the built-in defaults.
  it("honours custom rates", () => {
    const rates = { pointsPer10Rupees: 1, pointValueRupees: 0.25, minPointsToRedeem: 200, maxRedeemPerOrder: 0, maxRedeemPercent: 0 };
    expect(pointsValue(100, rates)).toBe(25);
    expect(redeemablePoints(199, 500, rates)).toBe(0); // under the new floor
    expect(redeemablePoints(200, 500, rates)).toBe(200);
    // ₹100 payable at ₹0.25/point caps redemption at 400 points.
    expect(redeemablePoints(1000, 100, rates)).toBe(400);
  });

  it("honours a custom earn rate", () => {
    const rates = { pointsPer10Rupees: 2, pointValueRupees: 0.5, minPointsToRedeem: 100, maxRedeemPerOrder: 0, maxRedeemPercent: 0 };
    expect(pointsEarned(349, 1, rates)).toBe(69);
  });

  it("assigns the highest qualifying tier (both thresholds required)", () => {
    expect(tierFor(tiers, { completedOrders: 0, lifetimeSpend: 0 })?.name).toBe("New Customer");
    expect(tierFor(tiers, { completedOrders: 5, lifetimeSpend: 1000 })?.name).toBe("Regular");
    expect(tierFor(tiers, { completedOrders: 10, lifetimeSpend: 1000 })?.name).toBe("Regular"); // spend too low for Dhaba Lover
    expect(tierFor(tiers, { completedOrders: 25, lifetimeSpend: 9000 })?.name).toBe("VIP");
  });
});

describe("redemption ceilings", () => {
  // Without one of these, a customer who has saved for months clears the
  // whole bill in a single order — which is what the shop found out the
  // hard way.
  const base = {
    pointsPer10Rupees: 1,
    pointValueRupees: 0.5,
    minPointsToRedeem: 10,
    maxRedeemPerOrder: 0,
    maxRedeemPercent: 0,
  };

  it("spends the whole balance when no ceiling is set", () => {
    expect(redeemablePoints(1000, 1000, base)).toBe(1000);
  });

  it("stops at the ceiling in points", () => {
    const rates = { ...base, maxRedeemPerOrder: 10 };
    expect(redeemablePoints(1000, 1000, rates)).toBe(10);
    // …and ₹5 is all that comes off, whatever they hold.
    expect(pointsValue(redeemablePoints(1000, 1000, rates), rates)).toBe(5);
  });

  it("does not invent points to reach the ceiling", () => {
    const rates = { ...base, maxRedeemPerOrder: 500 };
    expect(redeemablePoints(60, 1000, rates)).toBe(60);
  });

  it("stops at the share of the bill", () => {
    // 20% of ₹1000 is ₹200, which at ₹0.5 a point is 400 points.
    const rates = { ...base, maxRedeemPercent: 20 };
    expect(redeemablePoints(1000, 1000, rates)).toBe(400);
  });

  it("applies whichever ceiling bites first", () => {
    const rates = { ...base, maxRedeemPerOrder: 100, maxRedeemPercent: 20 };
    // The 100-point ceiling is tighter than 20% of ₹1000.
    expect(redeemablePoints(1000, 1000, rates)).toBe(100);
    // On a small bill the percentage is tighter: 20% of ₹100 = ₹20 = 40 points.
    expect(redeemablePoints(1000, 100, rates)).toBe(40);
  });

  it("still refuses a balance under the floor, ceiling or not", () => {
    const rates = { ...base, minPointsToRedeem: 100, maxRedeemPerOrder: 10 };
    expect(redeemablePoints(99, 1000, rates)).toBe(0);
  });

  it("never returns a negative number on a bill of nothing", () => {
    const rates = { ...base, maxRedeemPerOrder: 10, maxRedeemPercent: 20 };
    expect(redeemablePoints(1000, 0, rates)).toBe(0);
  });
});
