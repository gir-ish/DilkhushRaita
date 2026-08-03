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

  it("assigns the highest qualifying tier (both thresholds required)", () => {
    expect(tierFor(tiers, { completedOrders: 0, lifetimeSpend: 0 })?.name).toBe("New Customer");
    expect(tierFor(tiers, { completedOrders: 5, lifetimeSpend: 1000 })?.name).toBe("Regular");
    expect(tierFor(tiers, { completedOrders: 10, lifetimeSpend: 1000 })?.name).toBe("Regular"); // spend too low for Dhaba Lover
    expect(tierFor(tiers, { completedOrders: 25, lifetimeSpend: 9000 })?.name).toBe("VIP");
  });
});
