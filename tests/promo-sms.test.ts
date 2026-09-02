import { describe, expect, it } from "vitest";
import {
  BATCH_SIZE,
  PROMO_MESSAGE,
  batches,
  creditsFor,
  parseRecipients,
} from "@/lib/promo-sms";

/**
 * The promotional campaign spends money per recipient, and the amount is not
 * obvious from looking at a list. These pin the things that decide the bill and
 * the things that decide whether a message arrives at all.
 */

describe("the approved message", () => {
  it("is the wording registered as template 1777178765648170151", () => {
    /*
     * Pinned character for character. An operator compares every message
     * against the registered template and silently drops anything that
     * differs, after the credit is spent — so an innocent tidy-up of the
     * phrasing here would stop the whole campaign arriving, with nothing in
     * any log to say why.
     */
    expect(PROMO_MESSAGE).toBe(
      "Dilkhush Raita Wala Dhaba is now online! Enjoy delicious dhaba-style food, " +
        "fresh flavors and your favorite dishes from the comfort of home. " +
        "Explore our menu and order now at https://dilkhushraita.com/"
    );
  });

  it("has no variable to fill, so none can be left unfilled", () => {
    expect(PROMO_MESSAGE).not.toContain("{#var#}");
    expect(PROMO_MESSAGE).not.toContain("{name}");
  });

  it("is plain GSM-7, so it is not silently re-encoded", () => {
    // One character outside this alphabet forces the whole message into UCS-2,
    // which cuts the per-credit allowance from 160 characters to 70.
    const outside = [...PROMO_MESSAGE].filter((c) => c.charCodeAt(0) > 126);
    expect(outside, `non-GSM-7: ${outside.join("")}`).toHaveLength(0);
  });

  it("points at the URL already whitelisted on DLT", () => {
    expect(PROMO_MESSAGE).toContain("https://dilkhushraita.com/");
  });

  it("costs two credits, which is what the dashboard must show", () => {
    // 200 characters. Worth knowing before a thousand-number campaign, not
    // after.
    expect(PROMO_MESSAGE.length).toBe(200);
    expect(creditsFor(PROMO_MESSAGE)).toBe(2);
  });
});

describe("what a message costs", () => {
  it("is one credit up to 160 characters and two past it", () => {
    expect(creditsFor("a".repeat(160))).toBe(1);
    expect(creditsFor("a".repeat(161))).toBe(2);
    expect(creditsFor("a".repeat(306))).toBe(2);
    expect(creditsFor("a".repeat(307))).toBe(3);
  });
});

describe("reading a list of numbers", () => {
  it("takes them however they were written", () => {
    const { numbers } = parseRecipients(`
      9876543210
      +91 98123 45678, 919000000001
      09000000002;9000000003
    `);
    expect(numbers).toEqual([
      "+919876543210",
      "+919812345678",
      "+919000000001",
      "+919000000002",
      "+919000000003",
    ]);
  });

  it("keeps a number written with spaces in one piece", () => {
    // "+91 98765 43210" is the ordinary way to write it here. Splitting on
    // whitespace turns one number into three unusable fragments.
    expect(parseRecipients("+91 98765 43210").numbers).toEqual(["+919876543210"]);
  });

  it("collapses duplicates rather than charging twice for them", () => {
    const r = parseRecipients("9876543210, 9876543210, +919876543210, 09876543210");
    expect(r.numbers).toHaveLength(1);
    expect(r.duplicates).toBe(3);
  });

  it("reports what it could not use instead of dropping it", () => {
    const r = parseRecipients("9876543210, 12345, hello, 5000000000");
    expect(r.numbers).toEqual(["+919876543210"]);
    expect(r.rejected.map((x) => x.raw)).toEqual(["12345", "hello", "5000000000"]);
  });

  it("refuses to go past the campaign ceiling", () => {
    const many = Array.from({ length: 60 }, (_, i) => `98765${String(i).padStart(5, "0")}`).join("\n");
    const r = parseRecipients(many, 50);
    expect(r.numbers).toHaveLength(50);
    expect(r.rejected).toHaveLength(10);
  });

  it("returns nothing for an empty paste rather than a phantom recipient", () => {
    expect(parseRecipients("   \n\n , ; ").numbers).toEqual([]);
  });
});

describe("batching", () => {
  it("splits so one failure cannot take the campaign with it", () => {
    const b = batches(Array.from({ length: 125 }, (_, i) => i), BATCH_SIZE);
    expect(b.map((x) => x.length)).toEqual([50, 50, 25]);
  });

  it("produces no empty request for an empty list", () => {
    expect(batches([])).toEqual([]);
  });
});
