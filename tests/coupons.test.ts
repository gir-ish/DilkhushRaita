import { describe, expect, it } from "vitest";
import { evaluateCoupon, rankCoupons, type CouponLike, type CouponContext } from "@/lib/coupons";

function coupon(over: Partial<CouponLike> = {}): CouponLike {
  return {
    id: "c1",
    code: "TEST",
    name: "Test",
    description: "",
    rewardType: "PERCENT",
    value: 10,
    orderTypesJson: JSON.stringify(["DELIVERY", "PICKUP"]),
    daysOfWeekJson: "[]",
    firstOrderOnly: false,
    perCustomerLimit: 1,
    autoApply: false,
    stackable: false,
    priority: 0,
    active: true,
    ...over,
  };
}

function ctx(over: Partial<CouponContext> = {}): CouponContext {
  return {
    subtotal: 500,
    orderType: "DELIVERY",
    paymentMethod: "COD",
    branchId: "b1",
    now: new Date("2026-07-20T13:00:00+05:30"),
    nowHHmm: "13:00",
    dayOfWeek: 0,
    deliveryFee: 30,
    itemIdsInCart: [],
    itemPriceById: {},
    customer: { completedOrders: 5, lifetimeSpend: 2000, loyaltyTierId: null, lastOrderAt: null },
    totalRedemptions: 0,
    customerRedemptions: 0,
    ...over,
  };
}

describe("coupon engine", () => {
  it("applies percentage with max cap", () => {
    const e = evaluateCoupon(coupon({ value: 50, maxDiscount: 120 }), ctx());
    expect(e.eligible).toBe(true);
    expect(e.discount).toBe(120);
  });

  it("flat discount capped at subtotal", () => {
    const e = evaluateCoupon(coupon({ rewardType: "FLAT", value: 900 }), ctx({ subtotal: 300 }));
    expect(e.discount).toBe(300);
  });

  it("rejects below min cart with helpful reason", () => {
    const e = evaluateCoupon(coupon({ minCartValue: 600 }), ctx({ subtotal: 500 }));
    expect(e.eligible).toBe(false);
    expect(e.reason).toContain("₹100");
  });

  it("first-order only rejects returning customers", () => {
    const e = evaluateCoupon(coupon({ firstOrderOnly: true }), ctx());
    expect(e.eligible).toBe(false);
  });

  it("per-customer limit enforced", () => {
    const e = evaluateCoupon(coupon({ perCustomerLimit: 1 }), ctx({ customerRedemptions: 1 }));
    expect(e.eligible).toBe(false);
    expect(e.reason).toMatch(/already used/i);
  });

  it("campaign total limit enforced", () => {
    const e = evaluateCoupon(coupon({ totalLimit: 100 }), ctx({ totalRedemptions: 100 }));
    expect(e.eligible).toBe(false);
  });

  it("expired campaigns rejected", () => {
    const e = evaluateCoupon(coupon({ endAt: new Date("2026-01-01") }), ctx());
    expect(e.eligible).toBe(false);
    expect(e.reason).toMatch(/expired/i);
  });

  it("time-window coupons only apply in window", () => {
    const c = coupon({ startTime: "11:00", endTime: "15:00" });
    expect(evaluateCoupon(c, ctx({ nowHHmm: "13:00" })).eligible).toBe(true);
    expect(evaluateCoupon(c, ctx({ nowHHmm: "18:00" })).eligible).toBe(false);
  });

  it("free delivery only on delivery orders", () => {
    const c = coupon({ rewardType: "FREE_DELIVERY", value: 0 });
    const del = evaluateCoupon(c, ctx());
    expect(del.eligible).toBe(true);
    expect(del.freeDelivery).toBe(true);
    expect(del.savings).toBe(30);
    expect(evaluateCoupon(c, ctx({ orderType: "PICKUP", deliveryFee: 0 })).eligible).toBe(false);
  });

  it("inactive-days win-back coupon", () => {
    const c = coupon({ inactiveDays: 30 });
    const recent = ctx({ customer: { completedOrders: 3, lifetimeSpend: 900, loyaltyTierId: null, lastOrderAt: new Date("2026-07-15") } });
    const stale = ctx({ customer: { completedOrders: 3, lifetimeSpend: 900, loyaltyTierId: null, lastOrderAt: new Date("2026-05-01") } });
    expect(evaluateCoupon(c, recent).eligible).toBe(false);
    expect(evaluateCoupon(c, stale).eligible).toBe(true);
  });

  it("ranks the best coupon first", () => {
    const { best } = rankCoupons(
      [coupon({ id: "a", code: "A", value: 10 }), coupon({ id: "b", code: "B", value: 30 })],
      ctx()
    );
    expect(best?.coupon.code).toBe("B");
  });
});
