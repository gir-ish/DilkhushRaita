import { describe, expect, it } from "vitest";
import { DEFAULT_SMS_SETTINGS, pointsSmsFor } from "@/lib/points-sms";

/**
 * The points SMS the shop sends by itself after a big order: who gets it, and
 * exactly what it says. No gateway, no database — nothing here is sent.
 */

const order = (over: Partial<Parameters<typeof pointsSmsFor>[1]> = {}) => ({
  total: 1250,
  earned: 62,
  name: "Rahul Kumar",
  phone: "+919253171637",
  notifyPromos: true,
  nowHHmm: "13:30",
  ...over,
});

describe("after an order above ₹1,000", () => {
  it("tells the customer, by first name, the points it earned", () => {
    expect(pointsSmsFor(DEFAULT_SMS_SETTINGS, order())).toEqual({
      templateId: "1777178964821207154",
      phone: "+919253171637",
      message:
        "Hi Rahul, you earned 62 Dilkhush Points on your order! Use your points to save on your next order: https://dilkhushraita.com/",
    });
  });

  it("says 'Friend' when there is no usable name", () => {
    const r = pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ name: null }));
    expect("message" in r && r.message).toMatch(/^Hi Friend, you earned 62/);
  });
});

describe("is not sent", () => {
  it("for an order of ₹1,000 or less — it has to be more", () => {
    expect(pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ total: 1000 }))).toEqual({ skip: "order is not above ₹1000" });
    expect("message" in pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ total: 1000.5 }))).toBe(true);
  });

  it("when the owner has switched it off, or set a higher amount", () => {
    expect(pointsSmsFor({ ...DEFAULT_SMS_SETTINGS, pointsSmsEnabled: false }, order())).toEqual({
      skip: "points SMS are switched off",
    });
    expect("skip" in pointsSmsFor({ pointsSmsEnabled: true, pointsSmsMinOrder: 2000 }, order())).toBe(true);
  });

  it("when the order earned no points", () => {
    expect(pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ earned: 0 }))).toEqual({ skip: "no points earned" });
  });

  it("to a customer who turned promotions off", () => {
    expect(pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ notifyPromos: false }))).toEqual({
      skip: "customer turned promotional messages off",
    });
  });

  it("outside 9am–9pm, when operators refuse promotional SMS", () => {
    expect("skip" in pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ nowHHmm: "21:15" }))).toBe(true);
    expect("skip" in pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ nowHHmm: "08:59" }))).toBe(true);
    expect("message" in pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ nowHHmm: "09:00" }))).toBe(true);
  });

  it("without a phone number", () => {
    expect(pointsSmsFor(DEFAULT_SMS_SETTINGS, order({ phone: null }))).toEqual({ skip: "no phone number" });
  });
});
