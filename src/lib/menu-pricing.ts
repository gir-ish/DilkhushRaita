/**
 * What a dish costs at one branch.
 *
 * Rohini and NSP price the same dish differently, and not by a fixed amount:
 * Dal Fry is 70/120 at Rohini and 70/130 at NSP. So each branch keeps its own
 * price per portion (BranchMenuItem.variantPricesJson), and everything that
 * shows or charges a price — the menu, the counter, the server-side quote —
 * asks this module, so they cannot disagree.
 *
 * Fallbacks, for rows that predate per-portion prices: a portion with no price
 * of its own at a branch costs that branch's base price plus the portion's
 * global priceDelta, exactly as before.
 */

export type VariantPrices = Record<string, number>;

interface PricedItem {
  basePrice: number;
  variants: { name: string; priceDelta: number; isDefault: boolean; active?: boolean }[];
}

interface PricedBranchRow {
  priceOverride: number | null;
  variantPricesJson?: string | null;
}

/** Reads a stored {"Half":70,"Full":120}, ignoring anything that is not a usable price. */
export function parseVariantPrices(json: string | null | undefined): VariantPrices {
  if (!json) return {};
  try {
    const raw: unknown = JSON.parse(json);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: VariantPrices = {};
    for (const [name, price] of Object.entries(raw as Record<string, unknown>))
      if (typeof price === "number" && Number.isFinite(price) && price >= 0) out[name] = price;
    return out;
  } catch {
    return {};
  }
}

/** Portion names match however they were typed: "half", "Half ", "HALF". */
function key(name: string): string {
  return name.trim().toLowerCase();
}

function lookup(prices: VariantPrices, name: string): number | undefined {
  const k = key(name);
  for (const [n, p] of Object.entries(prices)) if (key(n) === k) return p;
  return undefined;
}

/** The branch's price before any portion is chosen. */
export function branchBase(item: PricedItem, bi?: PricedBranchRow | null): number {
  return bi?.priceOverride ?? item.basePrice;
}

/** What one portion costs at this branch. */
export function portionPrice(
  item: PricedItem,
  bi: PricedBranchRow | null | undefined,
  variant: { name: string; priceDelta: number }
): number {
  const own = lookup(parseVariantPrices(bi?.variantPricesJson), variant.name);
  return own ?? branchBase(item, bi) + variant.priceDelta;
}

function activeVariants(item: PricedItem) {
  return item.variants.filter((v) => v.active !== false);
}

/**
 * The price a dish is listed at: its default portion's, or the base price for
 * a dish sold in one size.
 */
export function listedPrice(item: PricedItem, bi?: PricedBranchRow | null): number {
  const vs = activeVariants(item);
  const def = vs.find((v) => v.isDefault) ?? vs[0];
  return def ? portionPrice(item, bi, def) : branchBase(item, bi);
}

/**
 * Portions as the menu sends them: the listed price plus, for each portion,
 * the difference from it. Clients add priceDelta to the listed price, so
 * expressing each branch's own portion prices this way keeps every existing
 * screen correct without teaching it about branches.
 */
export function menuPricing<V extends PricedItem["variants"][number] & { id: string }>(
  item: { basePrice: number; variants: V[] },
  bi?: PricedBranchRow | null
) {
  const price = listedPrice(item, bi);
  return {
    price,
    variants: item.variants.filter((v) => v.active !== false).map((v) => {
      const own = portionPrice(item, bi, v);
      return { id: v.id, name: v.name, isDefault: v.isDefault, price: own, priceDelta: round2(own - price) };
    }),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
