import { describe, expect, it } from "vitest";
import { listedPrice, menuPricing, parseVariantPrices, portionPrice } from "@/lib/menu-pricing";

/**
 * Rohini and NSP price the same dish differently, and not by a fixed gap:
 * Dal Fry is 70/120 at Rohini and 70/130 at NSP. These pin that each branch
 * charges its own Half and Full, and that older rows keep working.
 */

const dalFry = {
  basePrice: 70,
  variants: [
    { id: "h", name: "Half", priceDelta: 0, isDefault: true },
    { id: "f", name: "Full", priceDelta: 50, isDefault: false },
  ],
};
const rohini = { priceOverride: 70, variantPricesJson: JSON.stringify({ Half: 70, Full: 120 }) };
const nsp = { priceOverride: 70, variantPricesJson: JSON.stringify({ Half: 70, Full: 130 }) };

describe("per-branch portion prices", () => {
  it("charges each branch its own Full", () => {
    expect(portionPrice(dalFry, rohini, dalFry.variants[1])).toBe(120);
    expect(portionPrice(dalFry, nsp, dalFry.variants[1])).toBe(130);
  });

  it("lists the dish at its default portion's price", () => {
    expect(listedPrice(dalFry, nsp)).toBe(70);
  });

  it("sends portions as a difference from the listed price, which clients add up", () => {
    const m = menuPricing(dalFry, nsp);
    expect(m.price).toBe(70);
    expect(m.variants.map((v) => [v.name, v.price, v.priceDelta])).toEqual([
      ["Half", 70, 0],
      ["Full", 130, 60],
    ]);
    // What the customer's screen computes: listed + delta.
    expect(m.price + m.variants[1].priceDelta).toBe(130);
  });

  it("matches portion names however they were typed", () => {
    const loose = { priceOverride: 70, variantPricesJson: JSON.stringify({ " full": 140 }) };
    expect(portionPrice(dalFry, loose, dalFry.variants[1])).toBe(140);
  });
});

describe("rows from before per-portion prices", () => {
  it("fall back to the branch price plus the portion's gap", () => {
    const legacy = { priceOverride: 80, variantPricesJson: "{}" };
    expect(portionPrice(dalFry, legacy, dalFry.variants[1])).toBe(130);
  });

  it("fall back to the base price when the branch has none", () => {
    expect(portionPrice(dalFry, null, dalFry.variants[1])).toBe(120);
    expect(listedPrice({ basePrice: 10, variants: [] }, null)).toBe(10);
  });

  it("ignore stored prices that are not usable numbers", () => {
    expect(parseVariantPrices('{"Half":-5,"Full":"abc","Large":90}')).toEqual({ Large: 90 });
    expect(parseVariantPrices("not json")).toEqual({});
    expect(parseVariantPrices("[1,2]")).toEqual({});
  });
});
