import { describe, expect, it } from "vitest";
import { menuToCsv, parseMenuCsv, rowBasePrice, rowFullDelta } from "@/lib/menu-csv";

/**
 * The menu spreadsheet: how a file is read, what it refuses, and that an
 * export reads back as the same menu.
 */

const BRANCHES = ["rohini", "nsp"];
const HEAD = "category,name,name_hindi,description,veg,spicy,bestseller,rohini_half,rohini_full,rohini_price,nsp_half,nsp_full,nsp_price,addons";

const parse = (...lines: string[]) => parseMenuCsv([HEAD, ...lines].join("\n"), BRANCHES);

describe("reading a menu file", () => {
  it("reads a Half/Full dish with a different Full at each branch", () => {
    const m = parse("Dal,Dal Fry,दाल फ्राई,Yellow dal,yes,no,yes,70,120,,70,130,,Extra Butter:20; Extra Raita:30");
    expect(m.errors).toEqual([]);
    const r = m.rows[0];
    expect(r).toMatchObject({ name: "Dal Fry", nameHindi: "दाल फ्राई", portions: true, bestseller: true });
    expect(r.prices).toEqual({ rohini: { half: 70, full: 120 }, nsp: { half: 70, full: 130 } });
    expect(r.addOns).toEqual([
      { name: "Extra Butter", price: 20 },
      { name: "Extra Raita", price: 30 },
    ]);
    expect(rowBasePrice(r)).toBe(70);
    expect(rowFullDelta(r)).toBe(50);
  });

  it("reads a one-size dish, and a branch that does not sell it", () => {
    const m = parse("Snacks,French Fries,,,yes,no,no,,,,,,80,");
    expect(m.errors).toEqual([]);
    expect(m.rows[0].portions).toBe(false);
    expect(m.rows[0].prices).toEqual({ rohini: null, nsp: { price: 80 } });
  });

  it("takes prices written with a rupee sign", () => {
    const m = parse("Breads,Butter Roti,,,,,,,,₹13,,,Rs.13,");
    expect(m.rows[0].prices).toEqual({ rohini: { price: 13 }, nsp: { price: 13 } });
  });

  it("strips the byte-order mark Excel puts at the start", () => {
    const m = parseMenuCsv("\uFEFF" + [HEAD, "Dal,Dal Fry,,,,,,70,120,,70,130,,"].join("\n"), BRANCHES);
    expect(m.errors).toEqual([]);
    expect(m.rows).toHaveLength(1);
  });

  it("still takes the old single-price format", () => {
    const m = parseMenuCsv("name,category,price,veg\nDal Fry,Dal,70,true", BRANCHES);
    expect(m.errors).toEqual([]);
    expect(m.rows[0].prices).toEqual({ rohini: { price: 70 }, nsp: { price: 70 } });
    expect(m.rows[0].addOns).toBeUndefined(); // no column: add-ons left alone
  });
});

describe("refusing a bad file", () => {
  it("wants both Half and Full at a branch", () => {
    expect(parse("Dal,Dal Fry,,,,,,70,,,70,130,,").errors[0].message).toMatch(/rohini needs both/);
  });

  it("will not mix one price and Half/Full at one branch", () => {
    expect(parse("Dal,Dal Fry,,,,,,70,120,90,,,,").errors[0].message).toMatch(/both a single price and Half\/Full/);
  });

  it("will not have Half/Full at one branch and one size at the other", () => {
    expect(parse("Dal,Dal Fry,,,,,,70,120,,,,90,").errors[0].message).toMatch(/pick one for both/);
  });

  it("wants a price somewhere", () => {
    expect(parse("Dal,Dal Fry,,,,,,,,,,,,").errors[0].message).toMatch(/no price at any branch/);
  });

  it("refuses the same dish twice", () => {
    const m = parse("Dal,Dal Fry,,,,,,70,120,,,,,", "Dal,dal  fry,,,,,,70,120,,,,,");
    expect(m.errors[0]).toEqual({ line: 3, message: expect.stringMatching(/also on line 2/) });
  });

  it("says which add-on it could not read", () => {
    expect(parse("Dal,Dal Fry,,,,,,70,120,,,,,Extra Butter").errors[0].message).toMatch(/Name:price/);
  });

  it("warns about a column for a branch that does not exist", () => {
    const m = parseMenuCsv("category,name,rohini_price,pitampura_price\nBreads,Roti,10,10", BRANCHES);
    expect(m.errors).toEqual([]);
    expect(m.warnings[0]).toMatch(/pitampura/);
  });

  it("says what is wrong with a yes/no", () => {
    expect(parse("Dal,Dal Fry,,,maybe,,,70,120,,,,,").errors[0].message).toMatch(/use yes or no/);
  });
});

describe("export", () => {
  it("writes a file that reads back as the same menu", () => {
    const csv = menuToCsv(
      [
        {
          id: "i1", name: "Dal Fry", nameHindi: "दाल फ्राई", description: "Yellow dal,\ntempered", imageEmoji: "🍲",
          basePrice: 70, veg: true, spicy: false, bestseller: true, recommended: false,
          category: { name: "Dal" },
          variants: [
            { name: "Half", priceDelta: 0, isDefault: true, active: true },
            { name: "Full", priceDelta: 50, isDefault: false, active: true },
          ],
          addOns: [{ name: "Extra Butter", price: 20, active: true }],
          branchItems: [
            { branchId: "b1", onMenu: true, priceOverride: 70, variantPricesJson: '{"Half":70,"Full":120}' },
            { branchId: "b2", onMenu: true, priceOverride: 70, variantPricesJson: '{"Half":70,"Full":130}' },
          ],
        },
        {
          id: "i2", name: "French Fries", nameHindi: null, description: "", imageEmoji: "🍟",
          basePrice: 80, veg: true, spicy: false, bestseller: false, recommended: false,
          category: { name: "Snacks" }, variants: [], addOns: [],
          branchItems: [
            { branchId: "b1", onMenu: false, priceOverride: null, variantPricesJson: "{}" },
            { branchId: "b2", onMenu: true, priceOverride: 80, variantPricesJson: "{}" },
          ],
        },
      ],
      [{ id: "b1", slug: "rohini" }, { id: "b2", slug: "nsp" }]
    );
    expect(csv.startsWith("\uFEFF")).toBe(true); // Excel shows Hindi correctly

    const back = parseMenuCsv(csv, BRANCHES);
    expect(back.errors).toEqual([]);
    expect(back.rows.map((r) => [r.id, r.name, r.prices])).toEqual([
      ["i1", "Dal Fry", { rohini: { half: 70, full: 120 }, nsp: { half: 70, full: 130 } }],
      ["i2", "French Fries", { rohini: null, nsp: { price: 80 } }],
    ]);
    expect(back.rows[0].description).toBe("Yellow dal, tempered"); // one line
    expect(back.rows[0].addOns).toEqual([{ name: "Extra Butter", price: 20 }]);
  });
});
