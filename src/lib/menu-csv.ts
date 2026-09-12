import { parseCsv, toCsv } from "@/lib/csv";
import { parseVariantPrices, branchBase } from "@/lib/menu-pricing";

/**
 * The menu as a spreadsheet: one row per dish, one pair of columns per branch.
 *
 *   id, category, name, name_hindi, description, veg, spicy, bestseller,
 *   recommended, emoji, rohini_half, rohini_full, rohini_price,
 *   nsp_half, nsp_full, nsp_price, addons
 *
 * - A dish sold in Half and Full fills <branch>_half and <branch>_full.
 * - A dish sold in one size (roti, paratha, thali) fills <branch>_price.
 * - All of a branch's price cells blank means that branch does not sell it.
 * - addons: "Extra Butter:20; Extra Raita:30". Leaving the column out of the
 *   file leaves every dish's add-ons as they are; an empty cell removes them.
 * - id: optional. Set, it lets a row rename a dish ("Dilkush" → "Dilkhush")
 *   while keeping its order history and favourites. Without it, a row updates
 *   the dish with the same name, or creates one.
 *
 * Export writes exactly this, so the owner can download the menu, change
 * prices in Excel, and upload it back.
 */

export const PORTIONS = { half: "Half", full: "Full" } as const;

export interface BranchPrice {
  /** One-size dish. */
  price?: number;
  /** Half/Full dish. */
  half?: number;
  full?: number;
}

export interface MenuRow {
  line: number;
  id: string | null;
  category: string;
  name: string;
  nameHindi: string | null;
  description: string;
  veg: boolean;
  spicy: boolean;
  bestseller: boolean;
  recommended: boolean;
  emoji: string | null;
  /** Sold in Half and Full, rather than one size. */
  portions: boolean;
  /** Only branches that have columns in the file. null = not sold there. */
  prices: Record<string, BranchPrice | null>;
  /** undefined when the file has no addons column. */
  addOns?: { name: string; price: number }[];
}

export interface ParsedMenu {
  rows: MenuRow[];
  /** Branch slugs the file has price columns for. */
  branches: string[];
  errors: { line: number; message: string }[];
  warnings: string[];
}

const norm = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, "_");

/** Names compare however they were spaced or cased. */
export function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

function bool(v: string | undefined, fallback: boolean): boolean | null {
  const s = (v ?? "").trim().toLowerCase();
  if (!s) return fallback;
  if (["yes", "y", "true", "1", "veg"].includes(s)) return true;
  if (["no", "n", "false", "0", "non-veg", "nonveg"].includes(s)) return false;
  return null;
}

function money(v: string | undefined): number | null | undefined {
  const s = (v ?? "").replace(/[₹,\s]/g, "").replace(/^rs\.?/i, "");
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100000 ? n : null;
}

export function parseMenuCsv(text: string, knownBranches: string[]): ParsedMenu {
  // Excel's "CSV UTF-8" starts with a byte-order mark, which would otherwise
  // become part of the first header's name.
  const raw = parseCsv(text.replace(/^\uFEFF/, ""));
  const errors: ParsedMenu["errors"] = [];
  const warnings: string[] = [];
  if (raw.length === 0) return { rows: [], branches: [], errors: [{ line: 1, message: "The file is empty or has no header row" }], warnings };

  // Headers, normalised: "Name Hindi" and "name_hindi" are the same column.
  const headers = Object.keys(raw[0]);
  const col = new Map(headers.map((h) => [norm(h), h]));
  const get = (r: Record<string, string>, k: string) => {
    const h = col.get(k);
    return h === undefined ? undefined : r[h];
  };

  const known = new Set(knownBranches.map((b) => b.toLowerCase()));
  const branches: string[] = [];
  for (const h of col.keys()) {
    const m = h.match(/^(.+)_(half|full|price)$/);
    if (!m) continue;
    if (known.has(m[1])) {
      if (!branches.includes(m[1])) branches.push(m[1]);
    } else if (m[1] !== "base") {
      warnings.push(`Column "${col.get(h)}" ignored — there is no branch "${m[1]}". Branches: ${knownBranches.join(", ")}.`);
    }
  }
  // The old one-price format: "price" sets every branch.
  const legacyPrice = col.has("price") && branches.length === 0;
  if (!legacyPrice && branches.length === 0)
    errors.push({ line: 1, message: `No price columns. Add ${knownBranches.map((b) => `${b}_half, ${b}_full, ${b}_price`).join(" / ")}.` });
  if (!col.has("name")) errors.push({ line: 1, message: 'Missing the "name" column' });
  if (!col.has("category")) errors.push({ line: 1, message: 'Missing the "category" column' });
  if (errors.length) return { rows: [], branches, errors, warnings };

  const hasAddOns = col.has("addons") || col.has("add_ons");
  const seen = new Map<string, number>();
  const rows: MenuRow[] = [];

  raw.forEach((r, i) => {
    const line = i + 2; // header is line 1
    const fail = (message: string) => errors.push({ line, message });
    const name = (get(r, "name") ?? "").trim().replace(/\s+/g, " ");
    const category = (get(r, "category") ?? "").trim().replace(/\s+/g, " ");
    if (!name && !category) return; // a blank spacer row
    if (!name) return fail("No name");
    if (!category) return fail(`${name}: no category`);
    if (name.length > 80) return fail(`${name}: name longer than 80 characters`);

    const dup = seen.get(nameKey(name));
    if (dup) return fail(`${name}: also on line ${dup} — each dish once`);
    seen.set(nameKey(name), line);

    const flags: Record<"veg" | "spicy" | "bestseller" | "recommended", boolean> = {
      veg: true, spicy: false, bestseller: false, recommended: false,
    };
    for (const k of Object.keys(flags) as (keyof typeof flags)[]) {
      const v = bool(get(r, k), flags[k]);
      if (v === null) return fail(`${name}: "${get(r, k)}" in ${k} — use yes or no`);
      flags[k] = v;
    }

    const prices: MenuRow["prices"] = {};
    let portions: boolean | null = null;
    if (legacyPrice) {
      const p = money(get(r, "price"));
      if (p == null) return fail(`${name}: price "${get(r, "price") ?? ""}" is not a number`);
      for (const b of knownBranches) prices[b] = { price: p };
      portions = false;
    } else {
      for (const b of branches) {
        const cells = { half: get(r, `${b}_half`), full: get(r, `${b}_full`), price: get(r, `${b}_price`) };
        const half = money(cells.half), full = money(cells.full), price = money(cells.price);
        for (const [k, v] of Object.entries({ half, full, price }))
          if (v === null) return fail(`${name}: ${b}_${k} "${cells[k as keyof typeof cells]}" is not a price`);
        if (half === undefined && full === undefined && price === undefined) {
          prices[b] = null; // not sold at this branch
          continue;
        }
        if (price !== undefined && (half !== undefined || full !== undefined))
          return fail(`${name}: ${b} has both a single price and Half/Full — use one or the other`);
        const isPortioned = price === undefined;
        if (isPortioned && (half === undefined || full === undefined))
          return fail(`${name}: ${b} needs both ${b}_half and ${b}_full, or ${b}_price for one size`);
        if (portions !== null && portions !== isPortioned)
          return fail(`${name}: Half/Full at one branch and a single price at another — pick one for both`);
        portions = isPortioned;
        prices[b] = isPortioned ? { half: half!, full: full! } : { price: price! };
      }
      if (portions === null) return fail(`${name}: no price at any branch`);
    }

    let addOns: MenuRow["addOns"];
    if (hasAddOns) {
      addOns = [];
      const cell = (get(r, "addons") ?? get(r, "add_ons") ?? "").trim();
      for (const part of cell.split(/[;|]/).map((s) => s.trim()).filter(Boolean)) {
        const m = part.match(/^(.+?)\s*[:=]\s*(?:₹|rs\.?\s*)?(\d+(?:\.\d+)?)$/i);
        if (!m) return fail(`${name}: add-on "${part}" — write it as Name:price, e.g. Extra Butter:20`);
        if (m[1].length > 60) return fail(`${name}: add-on name "${m[1]}" is too long`);
        addOns.push({ name: m[1].trim(), price: Number(m[2]) });
      }
      if (addOns.length > 12) return fail(`${name}: at most 12 add-ons`);
    }

    const emoji = (get(r, "emoji") ?? "").trim();
    rows.push({
      line,
      id: (get(r, "id") ?? "").trim() || null,
      category,
      name,
      nameHindi: (get(r, "name_hindi") ?? "").trim() || null,
      description: (get(r, "description") ?? "").trim().slice(0, 500),
      ...flags,
      emoji: emoji ? [...emoji].slice(0, 4).join("") : null,
      portions: portions!,
      prices,
      addOns,
    });
  });

  return { rows, branches: legacyPrice ? knownBranches : branches, errors, warnings };
}

/** The price a row lists the dish at, at the first branch that sells it. */
export function rowBasePrice(row: MenuRow): number {
  for (const p of Object.values(row.prices)) if (p) return p.price ?? p.half!;
  return 0;
}

/** Full minus Half, at the first branch that sells it — the fallback gap. */
export function rowFullDelta(row: MenuRow): number {
  for (const p of Object.values(row.prices)) if (p && p.full !== undefined) return p.full - p.half!;
  return 0;
}

// ------------------------------------------------------------------ export

interface ExportItem {
  id: string;
  name: string;
  nameHindi: string | null;
  description: string;
  imageEmoji: string;
  basePrice: number;
  veg: boolean;
  spicy: boolean;
  bestseller: boolean;
  recommended: boolean;
  category: { name: string };
  variants: { name: string; priceDelta: number; isDefault: boolean; active: boolean }[];
  addOns: { name: string; price: number; active: boolean }[];
  branchItems: { branchId: string; onMenu: boolean; priceOverride: number | null; variantPricesJson: string }[];
}

/**
 * The menu in the import format. A UTF-8 byte-order mark goes first so Excel
 * shows the Hindi names as Hindi rather than as mojibake.
 */
export function menuToCsv(items: ExportItem[], branches: { id: string; slug: string }[]): string {
  const yn = (b: boolean) => (b ? "yes" : "no");
  const oneLine = (s: string) => s.replace(/\s*\r?\n\s*/g, " ");
  const rows = items.map((it) => {
    const vs = it.variants.filter((v) => v.active);
    const half = vs.find((v) => v.name.trim().toLowerCase() === "half");
    const full = vs.find((v) => v.name.trim().toLowerCase() === "full");
    const row: Record<string, unknown> = {
      id: it.id,
      category: it.category.name,
      name: it.name,
      name_hindi: it.nameHindi ?? "",
      description: oneLine(it.description),
      veg: yn(it.veg),
      spicy: yn(it.spicy),
      bestseller: yn(it.bestseller),
      recommended: yn(it.recommended),
      emoji: it.imageEmoji,
    };
    for (const b of branches) {
      const bi = it.branchItems.find((x) => x.branchId === b.id);
      // Whether the branch sells it — not today's stock, which a menu file
      // does not carry.
      const sold = bi ? bi.onMenu : true;
      const base = branchBase(it, bi);
      const own = parseVariantPrices(bi?.variantPricesJson);
      const at = (v: { name: string; priceDelta: number }) => own[v.name] ?? base + v.priceDelta;
      row[`${b.slug}_half`] = sold && half && full ? at(half) : "";
      row[`${b.slug}_full`] = sold && half && full ? at(full) : "";
      // Anything not plain Half/Full (Regular/Large) exports as its listed price.
      const def = vs.find((v) => v.isDefault) ?? vs[0];
      row[`${b.slug}_price`] = sold && !(half && full) ? (def ? at(def) : base) : "";
    }
    row.addons = it.addOns.filter((a) => a.active).map((a) => `${a.name}:${a.price}`).join("; ");
    return row;
  });
  return "\uFEFF" + toCsv(rows);
}
