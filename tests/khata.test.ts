import { describe, expect, it } from "vitest";
import { DEFAULT_KHATA_LIMITS, khataBand, summarizeKhata, type KhataRow } from "@/lib/khata";

/**
 * The khata's arithmetic: what is due, which bills a payment clears, and
 * what a cancelled order does to the account. Money, so every rule is pinned.
 */

let n = 0;
const at = (day: number, minute = 0) => new Date(Date.UTC(2026, 8, day, 12, minute));
const row = (kind: KhataRow["kind"], amount: number, when: Date, extra: Partial<KhataRow> = {}): KhataRow => ({
  id: `e${++n}`,
  kind,
  amount,
  orderId: null,
  createdAt: when,
  orderStatus: kind === "CHARGE" ? "DELIVERED" : null,
  ...extra,
});

describe("what is due", () => {
  it("is bills minus payments minus waivers", () => {
    const k = summarizeKhata([
      row("CHARGE", 600, at(1), { orderId: "A" }),
      row("CHARGE", 400, at(2), { orderId: "B" }),
      row("PAYMENT", 100, at(3)),
      row("WAIVE", 5, at(4)),
    ]);
    expect(k).toMatchObject({ charged: 1000, paid: 100, waived: 5, due: 895 });
  });

  it("is zero, not a stray paisa, once paid off", () => {
    const k = summarizeKhata([
      row("CHARGE", 33.33, at(1), { orderId: "A" }),
      row("CHARGE", 33.33, at(1, 1), { orderId: "B" }),
      row("CHARGE", 33.34, at(1, 2), { orderId: "C" }),
      row("PAYMENT", 100, at(2)),
    ]);
    expect(k.due).toBe(0);
    expect(k.pendingBills).toEqual([]);
  });
});

describe("which bills a payment clears", () => {
  it("clears the oldest bill first, then part of the next", () => {
    const k = summarizeKhata([
      row("CHARGE", 400, at(2), { orderId: "B" }),
      row("CHARGE", 600, at(1), { orderId: "A" }), // older, though listed second
      row("PAYMENT", 700, at(3)),
    ]);
    expect(k.bills.map((b) => [b.orderId, b.settled, b.pending])).toEqual([
      ["A", 600, 0],
      ["B", 100, 300],
    ]);
    expect(k.pendingBills.map((b) => b.orderId)).toEqual(["B"]);
  });

  it("counts a part-payment taken with the bill against that bill", () => {
    // Bill and payment are written in the same moment.
    const t = at(5);
    const k = summarizeKhata([row("PAYMENT", 200, t, { orderId: "A" }), row("CHARGE", 500, t, { orderId: "A" })]);
    expect(k.bills[0]).toMatchObject({ orderId: "A", settled: 200, pending: 300 });
    expect(k.history.map((h) => h.balanceAfter)).toEqual([500, 300]);
  });
});

describe("a cancelled order", () => {
  it("is no longer owed", () => {
    const k = summarizeKhata([
      row("CHARGE", 600, at(1), { orderId: "A" }),
      row("CHARGE", 400, at(2), { orderId: "B", orderStatus: "CANCELLED" }),
    ]);
    expect(k.due).toBe(600);
    expect(k.bills.map((b) => b.orderId)).toEqual(["A"]);
    expect(k.history.find((h) => h.entry.orderId === "B")!.void).toBe(true);
  });

  it("leaves what was paid for it as money paid ahead", () => {
    const k = summarizeKhata([
      row("CHARGE", 500, at(1), { orderId: "A", orderStatus: "REJECTED" }),
      row("PAYMENT", 200, at(1), { orderId: "A" }),
    ]);
    expect(k.due).toBe(-200);
  });
});

describe("colours", () => {
  const limits = { yellowAbove: 0, redAbove: 1000 };

  it("is green with nothing pending, yellow with some, red above the limit", () => {
    expect(khataBand(0, limits)).toBe("green");
    expect(khataBand(-50, limits)).toBe("green"); // paid ahead
    expect(khataBand(1, limits)).toBe("yellow");
    expect(khataBand(1000, limits)).toBe("yellow"); // "above", not "at"
    expect(khataBand(1000.5, limits)).toBe("red");
  });

  it("moves with the owner's limits", () => {
    const relaxed = { yellowAbove: 200, redAbove: 5000 };
    expect(khataBand(150, relaxed)).toBe("green");
    expect(khataBand(250, relaxed)).toBe("yellow");
    expect(khataBand(6000, relaxed)).toBe("red");
  });

  it("starts at any pending amount and ₹1000", () => {
    expect(DEFAULT_KHATA_LIMITS).toEqual({ yellowAbove: 0, redAbove: 1000 });
  });
});

describe("history", () => {
  it("shows the balance after every entry", () => {
    const k = summarizeKhata([
      row("CHARGE", 1000, at(1), { orderId: "A" }),
      row("PAYMENT", 100, at(2)),
      row("PAYMENT", 400, at(3)),
    ]);
    expect(k.history.map((h) => [h.entry.kind, h.balanceAfter])).toEqual([
      ["CHARGE", 1000],
      ["PAYMENT", 900],
      ["PAYMENT", 500],
    ]);
  });
});
