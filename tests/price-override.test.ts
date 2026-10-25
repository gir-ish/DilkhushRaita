import { describe, expect, it } from "vitest";
import { effectiveUnitPrice, MAX_LINE_PRICE } from "@/lib/quote";
import { canRepriceLines } from "@/lib/pricing-authority";

/**
 * Charging something other than the menu price for one line of one bill.
 *
 * Two questions, kept apart: who is allowed to, and what the number becomes.
 * The till asks the first to decide whether to draw a button; every counter
 * route asks it again to decide whether to honour one.
 */

describe("who may reprice a line", () => {
  it("lets the owner", () => {
    expect(canRepriceLines("OWNER")).toBe(true);
  });

  it("lets a branch manager, who runs the shop when the owner is not there", () => {
    expect(canRepriceLines("BRANCH_MANAGER")).toBe(true);
  });

  it("does not let a cashier — a recorded discount is theirs, the menu is not", () => {
    expect(canRepriceLines("CASHIER")).toBe(false);
  });

  it("does not let the kitchen, delivery or marketing", () => {
    for (const role of ["KITCHEN", "DELIVERY_MANAGER", "DELIVERY_AGENT", "MARKETING"])
      expect(canRepriceLines(role)).toBe(false);
  });

  it("does not let a customer, whatever they send", () => {
    expect(canRepriceLines("CUSTOMER")).toBe(false);
    expect(canRepriceLines("")).toBe(false);
    expect(canRepriceLines("owner")).toBe(false); // case matters; roles are stored upper
  });
});

describe("what the line is charged", () => {
  it("charges the menu price when nothing was overridden", () => {
    expect(effectiveUnitPrice(250, null, true)).toEqual({ unitPrice: 250 });
    expect(effectiveUnitPrice(250, undefined, true)).toEqual({ unitPrice: 250 });
  });

  it("ignores a price from someone not allowed to set one", () => {
    expect(effectiveUnitPrice(250, 10, false)).toEqual({ unitPrice: 250 });
  });

  it("charges less, and remembers what the menu said", () => {
    expect(effectiveUnitPrice(250, 200, true)).toEqual({ unitPrice: 200, listPrice: 250 });
  });

  it("charges more, because a special order costs what it costs", () => {
    expect(effectiveUnitPrice(250, 400, true)).toEqual({ unitPrice: 400, listPrice: 250 });
  });

  it("comps a plate to nothing", () => {
    expect(effectiveUnitPrice(250, 0, true)).toEqual({ unitPrice: 0, listPrice: 250 });
  });

  it("records no change when the price typed is the menu price", () => {
    expect(effectiveUnitPrice(250, 250, true)).toEqual({ unitPrice: 250 });
  });

  it("rounds to paise rather than carrying a float", () => {
    expect(effectiveUnitPrice(250, 199.999, true)).toEqual({ unitPrice: 200, listPrice: 250 });
  });

  it("refuses a negative price instead of paying the customer", () => {
    expect(effectiveUnitPrice(250, -50, true)).toEqual({ unitPrice: 250 });
  });

  it("caps a slipped finger rather than billing a lakh", () => {
    expect(effectiveUnitPrice(250, 99_999_999, true)).toEqual({
      unitPrice: MAX_LINE_PRICE,
      listPrice: 250,
    });
  });

  it("ignores nonsense", () => {
    expect(effectiveUnitPrice(250, NaN, true)).toEqual({ unitPrice: 250 });
    expect(effectiveUnitPrice(250, Infinity, true)).toEqual({ unitPrice: 250 });
  });
});
