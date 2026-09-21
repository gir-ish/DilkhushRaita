import { describe, expect, it } from "vitest";
import { ORDER_NUMBER_RE, formatOrderNumber, istDayKey } from "@/lib/order-number";

/**
 * Order numbers people read out: 210926-0001 — the date, then the day's own
 * count from 0001.
 */

describe("the day part", () => {
  it("is the Indian date, day month year", () => {
    expect(istDayKey(new Date("2026-09-21T09:30:00+05:30"))).toBe("210926");
    expect(istDayKey(new Date("2026-01-05T12:00:00+05:30"))).toBe("050126");
  });

  it("follows the Indian day, not the UTC one", () => {
    // 00:30 on the 21st in Delhi is still the 20th in London.
    expect(istDayKey(new Date("2026-09-20T19:00:00Z"))).toBe("210926");
    expect(istDayKey(new Date("2026-09-20T18:00:00Z"))).toBe("200926");
  });
});

describe("the number", () => {
  it("starts at 0001 and counts up", () => {
    expect(formatOrderNumber("210926", 1)).toBe("210926-0001");
    expect(formatOrderNumber("210926", 42)).toBe("210926-0042");
    expect(formatOrderNumber("210926", 9999)).toBe("210926-9999");
  });

  it("takes a fifth digit rather than repeat a number after 9999", () => {
    expect(formatOrderNumber("210926", 10000)).toBe("210926-10000");
    expect(ORDER_NUMBER_RE.test(formatOrderNumber("210926", 10000))).toBe(true);
  });

  it("is short enough to read out, and matches its shape", () => {
    const n = formatOrderNumber(istDayKey(), 7);
    expect(n).toHaveLength(11);
    expect(ORDER_NUMBER_RE.test(n)).toBe(true);
  });

  it("finds one day's order by the four digits alone", () => {
    // What the search box does: a plain "contains".
    expect(formatOrderNumber("210926", 1).includes("0001")).toBe(true);
    expect(formatOrderNumber("220926", 1).includes("0001")).toBe(true);
  });
});
