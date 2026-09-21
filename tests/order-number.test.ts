import { describe, expect, it } from "vitest";
import { ORDER_NUMBER_RE, branchCode, formatOrderNumber, istDayKey } from "@/lib/order-number";

/**
 * Order numbers people read out: RHN-210926-0001 — the branch, the date, then
 * that branch's own count for the day, from 0001.
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
    expect(formatOrderNumber("RHN", "210926", 1)).toBe("RHN-210926-0001");
    expect(formatOrderNumber("RHN", "210926", 42)).toBe("RHN-210926-0042");
    expect(formatOrderNumber("NSP", "210926", 9999)).toBe("NSP-210926-9999");
  });

  it("takes a fifth digit rather than repeat a number after 9999", () => {
    expect(formatOrderNumber("RHN", "210926", 10000)).toBe("RHN-210926-10000");
    expect(ORDER_NUMBER_RE.test(formatOrderNumber("RHN", "210926", 10000))).toBe(true);
  });

  it("is short enough to read out, and matches its shape", () => {
    const n = formatOrderNumber("NSP", istDayKey(), 7);
    expect(n).toHaveLength(15);
    expect(ORDER_NUMBER_RE.test(n)).toBe(true);
  });

  it("gives each branch its own 0001 on the same day", () => {
    expect(formatOrderNumber("RHN", "210926", 1)).not.toBe(formatOrderNumber("NSP", "210926", 1));
    // What the search box does: a plain "contains" on either.
    expect(formatOrderNumber("RHN", "210926", 1).includes("0001")).toBe(true);
    expect(formatOrderNumber("NSP", "220926", 1).includes("0001")).toBe(true);
  });
});

describe("the branch code", () => {
  it("uses the one the owner set", () => {
    expect(branchCode({ code: "rhn", slug: "rohini" })).toBe("RHN");
    expect(branchCode({ code: " NSP ", slug: "nsp" })).toBe("NSP");
  });

  it("knows the two branches that predate the setting", () => {
    expect(branchCode({ code: null, slug: "rohini" })).toBe("RHN");
    expect(branchCode({ code: null, slug: "nsp" })).toBe("NSP");
  });

  it("falls back to the first letters of a new branch's slug", () => {
    expect(branchCode({ code: null, slug: "pitampura" })).toBe("PIT");
    expect(branchCode({ code: null, slug: "42" })).toBe("DK");
  });
});
