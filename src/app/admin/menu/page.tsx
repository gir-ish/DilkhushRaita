"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal, Spinner, VegMark } from "@/components/ui";
import { inr } from "@/lib/utils";
import { branchBase, portionPrice, parseVariantPrices } from "@/lib/menu-pricing";

interface Category { id: string; name: string; displayOrder: number; active: boolean; _count: { items: number } }
interface BranchLite { id: string; name: string }
interface Item {
  id: string; name: string; description: string; basePrice: number; imageEmoji: string;
  imageUrl: string | null;
  veg: boolean; spicy: boolean; bestseller: boolean; recommended: boolean; active: boolean;
  categoryId: string; category: { name: string }; prepTimeMins: number;
  ingredients: string; allergens: string;
  variants: { id?: string; name: string; priceDelta: number; isDefault: boolean }[];
  addOns: { id?: string; name: string; price: number; veg: boolean; required: boolean }[];
  branchItems: {
    branchId: string; available: boolean; priceOverride: number | null; stockQty: number;
    variantPricesJson?: string;
    // false: this branch does not sell the dish; it is off that branch's menu.
    onMenu?: boolean;
    // Carried through every save: the PATCH route nulls anything it is not
    // given, so omitting these silently wipes an item's serving window.
    availableFrom?: string | null; availableTo?: string | null;
    branch?: { name: string };
  }[];
}

const shortBranch = (name: string) => name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "");

/**
 * What a dish costs at one branch, portion by portion — Half ₹70, Full ₹120 —
 * or its single price. Worked out by the same module the menu and checkout
 * use, so the dashboard shows what the customer is charged.
 */
function pricesAt(it: Item, branchId: string): { name: string | null; price: number }[] {
  const bi = it.branchItems.find((b) => b.branchId === branchId);
  if (!it.variants.length) return [{ name: null, price: branchBase(it, bi) }];
  return it.variants.map((v) => ({ name: v.name, price: portionPrice(it, bi, v) }));
}

/** One cell of the "Edit prices" grid: a price per portion, or one price. */
type Draft = Record<string, string>;
const ONE = "__one__";

export default function AdminMenuPage() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [newCat, setNewCat] = useState("");
  // "Edit prices" mode: every branch's prices become inputs, saved together.
  const [priceMode, setPriceMode] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [savingPrices, setSavingPrices] = useState(false);
  const [importing, setImporting] = useState<{ fileName: string; text: string; preview: ImportPreview } | null>(null);
  // Dishes taken off the menu stay in the database for order history, but
  // are out of the way here unless asked for.
  const [showHidden, setShowHidden] = useState(false);
  const hiddenCount = items?.filter((i) => !i.active).length ?? 0;
  const shown = items?.filter((i) => showHidden || i.active) ?? null;

  const load = useCallback(() => {
    fetch("/api/admin/menu/categories").then((r) => r.json()).then((d) => setCategories(d.categories ?? []));
    fetch("/api/admin/menu/items").then((r) => r.json()).then((d) => setItems(d.items ?? []));
    fetch("/api/admin/branches").then((r) => r.json()).then((d) => setBranches(d.branches ?? []));
  }, []);
  useEffect(load, [load]);

  const addCategory = async () => {
    if (!newCat.trim()) return;
    const r = await fetch("/api/admin/menu/categories", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newCat.trim(), displayOrder: (categories?.length ?? 0) + 1 }),
    });
    if (r.ok) { setNewCat(""); load(); } else setError((await r.json()).error);
  };


  /**
   * Writes one branch's row for one item.
   *
   * Everything not being changed is resent as-is: the PATCH route replaces the
   * whole BranchMenuItem, so a partial payload would quietly reset stock counts
   * and serving windows.
   */
  const saveOverride = async (
    item: Item,
    branchId: string,
    patch: Partial<{ available: boolean; priceOverride: number | null; stockQty: number }>
  ) => {
    const bi = item.branchItems.find((b) => b.branchId === branchId);
    setError(null);
    try {
      const r = await fetch(`/api/admin/menu/items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchOverrides: [
            {
              branchId,
              onMenu: bi?.onMenu ?? true,
              available: bi?.available ?? true,
              stockQty: bi?.stockQty ?? -1,
              priceOverride: bi?.priceOverride ?? null,
              availableFrom: bi?.availableFrom ?? null,
              availableTo: bi?.availableTo ?? null,
              ...patch,
            },
          ],
        }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not save");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    }
  };

  const toggleAvailability = (item: Item, branchId: string, available: boolean) =>
    saveOverride(item, branchId, { available });

  /** Grid cells whose value differs from what is saved, as price changes. */
  const pendingChanges = () => {
    const out: { menuItemId: string; branchId: string; price?: number; variantPrices?: Record<string, number> }[] = [];
    for (const [key, draft] of Object.entries(drafts)) {
      const [menuItemId, branchId] = key.split(":");
      const it = items?.find((i) => i.id === menuItemId);
      if (!it) continue;
      const saved = pricesAt(it, branchId);
      const values = saved.map((p) => draft[p.name ?? ONE] ?? String(p.price));
      if (values.every((v, i) => v.trim() !== "" && +v === saved[i].price)) continue;
      if (values.some((v) => v.trim() === "" || !Number.isFinite(+v) || +v < 0))
        throw new Error(`${it.name}: enter a price for every portion`);
      out.push(
        it.variants.length
          ? { menuItemId, branchId, variantPrices: Object.fromEntries(saved.map((p, i) => [p.name!, +values[i]])) }
          : { menuItemId, branchId, price: +values[0] }
      );
    }
    return out;
  };
  let pendingCount = 0;
  try {
    pendingCount = pendingChanges().length;
  } catch {
    pendingCount = Object.keys(drafts).length;
  }

  const savePrices = async () => {
    setError(null);
    setSavingPrices(true);
    try {
      const changes = pendingChanges();
      if (changes.length) {
        const r = await fetch("/api/admin/menu/prices", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ changes }),
        });
        if (!r.ok) throw new Error((await r.json()).error ?? "Could not save prices");
      }
      setDrafts({});
      setPriceMode(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save prices");
    } finally {
      setSavingPrices(false);
    }
  };

  const previewImport = async (file: File) => {
    setError(null);
    const text = await file.text();
    const r = await fetch("/api/admin/menu/import?dryRun=1", { method: "POST", body: text });
    const d = await r.json();
    if (!r.ok) return setError(d.error ?? "Could not read that file");
    setImporting({ fileName: file.name, text, preview: d });
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Menu</h1>
        {priceMode ? (
          <>
            <button onClick={savePrices} disabled={savingPrices || pendingCount === 0} className="btn-primary !min-h-[38px]">
              {savingPrices ? "Saving…" : `💾 Save prices${pendingCount ? ` (${pendingCount})` : ""}`}
            </button>
            <button onClick={() => { setDrafts({}); setPriceMode(false); setError(null); }} className="btn-outline !min-h-[38px] text-sm">
              Cancel
            </button>
          </>
        ) : (
          <>
            <button onClick={() => setPriceMode(true)} disabled={!items?.length} className="btn-outline !min-h-[38px] text-sm">
              ✏️ Edit prices
            </button>
            <a href="/api/admin/menu/items?format=csv" className="btn-outline !min-h-[38px] text-sm">⬇️ Export CSV</a>
            <label className="btn-outline !min-h-[38px] text-sm cursor-pointer">
              ⬆️ Import CSV
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = ""; // the same file can be picked again after a fix
                  if (f) previewImport(f);
                }}
              />
            </label>
            <button onClick={() => setEditing("new")} className="btn-primary !min-h-[38px]">+ New item</button>
          </>
        )}
      </div>

      <ErrorBox message={error} />

      <section className="card p-4 mb-4" aria-label="Categories">
        <h2 className="font-semibold mb-2">Categories</h2>
        <div className="flex flex-wrap gap-2 items-center">
          {categories?.filter((c) => showHidden || c.active).map((c) => (
            <span key={c.id} className={`chip ${!c.active ? "opacity-50" : ""}`}>
              {c.name} ({c._count.items})
              <button
                aria-label={`${c.active ? "Deactivate" : "Activate"} ${c.name}`}
                className="ml-1 underline text-xs"
                onClick={async () => {
                  await fetch(`/api/admin/menu/categories/${c.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ active: !c.active }),
                  });
                  load();
                }}
              >
                {c.active ? "hide" : "show"}
              </button>
            </span>
          ))}
          <span className="flex gap-1">
            <input className="input !min-h-[36px] !py-1 !w-36" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} aria-label="New category name" />
            <button onClick={addCategory} className="btn-secondary !min-h-[36px] !px-3">Add</button>
          </span>
        </div>
      </section>

      <p className="text-sm text-maroon-800/60 mb-2">
        {priceMode ? (
          <>Change any Half, Full or single price, then press <strong>Save prices</strong>. Changed boxes are highlighted.</>
        ) : (
          <>Each branch has its own Half and Full price. Press <strong>Edit prices</strong> to change them for every dish at once, or <strong>Edit</strong> on one dish.</>
        )}
        {hiddenCount > 0 && (
          <label className="ml-2 inline-flex items-center gap-1 cursor-pointer whitespace-nowrap">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
            show {hiddenCount} hidden
          </label>
        )}
      </p>

      {!shown ? (
        <Spinner label="Loading items…" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                <th className="p-3">Item</th>
                <th className="p-3">Category</th>
                {branches.map((b) => (
                  <th key={b.id} className="p-3">
                    {shortBranch(b.name)}
                    <span className="block text-[11px] font-normal normal-case text-maroon-800/40">
                      price · stock
                    </span>
                  </th>
                ))}
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((it) => (
                <tr key={it.id} className={`border-b border-cream-100 ${!it.active ? "opacity-40" : ""}`}>
                  <td className="p-3">
                    <span className="flex items-center gap-2">
                      {it.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={it.imageUrl}
                          alt=""
                          className="h-8 w-8 rounded-md object-cover border border-cream-300"
                        />
                      ) : (
                        <span aria-hidden>{it.imageEmoji}</span>
                      )}
                      <VegMark veg={it.veg} />
                      <span className="font-semibold">{it.name}</span>
                      {it.bestseller && "⭐"}
                    </span>
                  </td>
                  <td className="p-3">{it.category.name}</td>
                  {branches.map((b) => {
                    const bi = it.branchItems.find((x) => x.branchId === b.id);
                    const avail = bi?.available ?? true;
                    const key = `${it.id}:${b.id}`;
                    if (bi?.onMenu === false)
                      return (
                        <td key={b.id} className="p-3 align-top text-xs text-maroon-800/40">
                          Not sold here
                        </td>
                      );
                    return (
                      <td key={b.id} className="p-3 align-top">
                        {/* The prices this branch actually charges. They only
                            become inputs in "Edit prices" mode, so a stray tap
                            on a busy dashboard cannot reprice a dish. */}
                        {pricesAt(it, b.id).map((p) => {
                          const slot = p.name ?? ONE;
                          if (!priceMode)
                            return (
                              <span key={slot} className="block font-semibold whitespace-nowrap">
                                {p.name && <span className="text-xs font-normal text-maroon-800/60 mr-1">{p.name}</span>}
                                {inr(p.price)}
                              </span>
                            );
                          const draft = drafts[key]?.[slot];
                          const changed = draft !== undefined && (draft.trim() === "" || +draft !== p.price);
                          return (
                            <label key={slot} className="flex items-center gap-1 mb-1">
                              {p.name && <span className="w-8 text-xs text-maroon-800/60">{p.name}</span>}
                              <input
                                type="number"
                                min={0}
                                inputMode="numeric"
                                className={`input !min-h-[32px] !py-1 !px-2 !w-20 ${changed ? "!border-mustard-600 !bg-mustard-100" : ""}`}
                                value={draft ?? String(p.price)}
                                onChange={(e) =>
                                  setDrafts((d) => ({ ...d, [key]: { ...d[key], [slot]: e.target.value } }))
                                }
                                aria-label={`${it.name}${p.name ? ` ${p.name}` : ""} price at ${shortBranch(b.name)}`}
                              />
                            </label>
                          );
                        })}
                        {!priceMode && <button
                          onClick={() => toggleAvailability(it, b.id, !avail)}
                          className={`mt-1 text-xs font-bold px-2 py-1 rounded-full ${avail ? "bg-green-100 text-leaf-600" : "bg-red-100 text-red-700"}`}
                          aria-label={`Toggle ${it.name} at ${b.name}`}
                        >
                          {avail ? "In stock" : "Off"}
                        </button>}
                        {priceMode && !avail && <span className="block text-xs text-red-700">off at this branch</span>}
                        {bi != null && bi.stockQty >= 0 && <span className="block text-xs text-mustard-600">qty {bi.stockQty}</span>}
                      </td>
                    );
                  })}
                  <td className="p-3">
                    {!priceMode && <button onClick={() => setEditing(it)} className="underline text-maroon-600">Edit</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && categories && (
        <ItemEditor
          item={editing === "new" ? null : editing}
          categories={categories}
          branches={branches}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}

      {importing && (
        <ImportReview
          {...importing}
          onClose={() => setImporting(null)}
          onDone={() => { setImporting(null); load(); }}
        />
      )}
    </div>
  );
}

interface ImportPreview {
  created: string[];
  updated: { name: string; renamedFrom: string | null; reactivated: boolean }[];
  notInFile: { id: string; name: string; category: string }[];
  branches: string[];
  errors: { line: number; message: string }[];
  warnings: string[];
}

/**
 * What an uploaded menu file will do, before it does it: which dishes it
 * adds, updates or renames, what is wrong with it, and which dishes on the
 * menu it does not mention — those stay unless the owner ticks the box.
 */
function ImportReview({
  fileName, text, preview, onClose, onDone,
}: {
  fileName: string;
  text: string;
  preview: ImportPreview;
  onClose: () => void;
  onDone: () => void;
}) {
  const [hideMissing, setHideMissing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const renamed = preview.updated.filter((u) => u.renamedFrom);
  const blocked = preview.errors.length > 0;

  const apply = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/menu/import${hideMissing ? "?hideMissing=1" : ""}`, { method: "POST", body: text });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error ?? "Import failed");
      alert(
        `Menu updated: ${d.created} new, ${d.updated} updated` + (d.hidden ? `, ${d.hidden} taken off the menu` : "") + "."
      );
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={`Import — ${fileName}`} wide>
      <div className="space-y-4 text-sm">
        <p>
          Prices for <strong>{preview.branches.join(" and ") || "no branch"}</strong>.{" "}
          <strong>{preview.created.length}</strong> new dishes, <strong>{preview.updated.length}</strong> updated
          {renamed.length > 0 && <>, of which <strong>{renamed.length}</strong> renamed</>}.
        </p>

        {blocked && (
          <div className="rounded-xl bg-red-50 border border-red-200 p-3">
            <p className="font-semibold text-red-800 mb-1">
              Fix {preview.errors.length === 1 ? "this" : `these ${preview.errors.length}`} in the file first — nothing will change until then:
            </p>
            <ul className="list-disc pl-5 text-red-800 max-h-48 overflow-y-auto">
              {preview.errors.map((e, i) => <li key={i}>Line {e.line}: {e.message}</li>)}
            </ul>
          </div>
        )}

        {preview.warnings.length > 0 && (
          <ul className="list-disc pl-5 text-mustard-600">
            {preview.warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        )}

        {preview.created.length > 0 && (
          <details>
            <summary className="cursor-pointer font-semibold">New dishes ({preview.created.length})</summary>
            <p className="mt-1 text-maroon-800/70">{preview.created.join(", ")}</p>
          </details>
        )}
        {renamed.length > 0 && (
          <details>
            <summary className="cursor-pointer font-semibold">Renamed ({renamed.length})</summary>
            <ul className="mt-1 text-maroon-800/70">
              {renamed.map((u) => <li key={u.name}>{u.renamedFrom} → <strong>{u.name}</strong></li>)}
            </ul>
          </details>
        )}

        {preview.notInFile.length > 0 && (
          <div className="rounded-xl bg-cream-100 p-3">
            <p className="font-semibold mb-1">
              {preview.notInFile.length} dishes on the menu are not in this file:
            </p>
            <p className="text-maroon-800/70 mb-2">
              {preview.notInFile.map((n) => n.name).join(", ")}
            </p>
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 mt-0.5 accent-maroon-600" checked={hideMissing} onChange={(e) => setHideMissing(e.target.checked)} />
              <span>
                Take these off the menu too, so the menu is exactly this file. They are hidden,
                not deleted — order history keeps them, and each can be switched back on with Edit.
              </span>
            </label>
          </div>
        )}

        <ErrorBox message={error} />
        <div className="flex gap-2">
          <button onClick={apply} disabled={busy || blocked} className="btn-primary flex-1">
            {busy ? "Importing…" : blocked ? "Fix the file first" : "Import menu"}
          </button>
          <button onClick={onClose} className="btn-outline">Cancel</button>
        </div>
      </div>
    </Modal>
  );
}

function ItemEditor({
  item, categories, branches, onClose, onSaved,
}: {
  item: Item | null;
  categories: Category[];
  branches: BranchLite[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    categoryId: item?.categoryId ?? categories[0]?.id ?? "",
    name: item?.name ?? "",
    description: item?.description ?? "",
    imageEmoji: item?.imageEmoji ?? "🍛",
    imageUrl: item?.imageUrl ?? null,
    basePrice: item?.basePrice ?? 0,
    veg: item?.veg ?? true,
    spicy: item?.spicy ?? false,
    bestseller: item?.bestseller ?? false,
    recommended: item?.recommended ?? false,
    active: item?.active ?? true,
    prepTimeMins: item?.prepTimeMins ?? 20,
    ingredients: item?.ingredients ?? "",
    allergens: item?.allergens ?? "",
  });
  // Portions are just names here; what each costs is set per branch below.
  const [variants, setVariants] = useState(item?.variants.map((v) => ({ name: v.name, isDefault: v.isDefault })) ?? []);
  const [addOns, setAddOns] = useState(item?.addOns.map((a) => ({ name: a.name, price: a.price, veg: a.veg, required: a.required })) ?? []);
  const [overrides, setOverrides] = useState(
    branches.map((b) => {
      const bi = item?.branchItems.find((x) => x.branchId === b.id);
      // A branch with nothing of its own charges the first branch's prices;
      // its boxes start empty to say so.
      const own = bi != null && (bi.priceOverride != null || Object.keys(parseVariantPrices(bi.variantPricesJson)).length > 0);
      return {
        branchId: b.id,
        branchName: b.name,
        onMenu: bi?.onMenu ?? true,
        available: bi?.available ?? true,
        priceOverride: bi?.priceOverride ?? null,
        // One box per portion, in the order of `variants`.
        portions: (item?.variants ?? []).map((v) => (own && item ? String(portionPrice(item, bi, v)) : "")),
        stockQty: bi?.stockQty ?? -1,
      };
    })
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const addPortion = (name = "") => {
    setVariants([...variants, { name, isDefault: variants.length === 0 }]);
    setOverrides(overrides.map((o) => ({ ...o, portions: [...o.portions, ""] })));
  };
  const removePortion = (i: number) => {
    const next = variants.filter((_, j) => j !== i);
    if (next.length && !next.some((v) => v.isDefault)) next[0] = { ...next[0], isDefault: true };
    setVariants(next);
    setOverrides(overrides.map((o) => ({ ...o, portions: o.portions.filter((_, j) => j !== i) })));
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const named = variants.map((v, i) => ({ ...v, name: v.name.trim(), i })).filter((v) => v.name);
      const names = named.map((v) => v.name.toLowerCase());
      if (new Set(names).size !== names.length) throw new Error("Two portions have the same name");
      const defIndex = Math.max(0, named.findIndex((v) => v.isDefault));

      const branchOverrides = overrides.map(({ branchName, portions, ...o }) => {
        const stockQty = +o.stockQty;
        // Not sold here: its prices are left exactly as stored, ready for
        // the day it is put back on this branch's menu.
        if (!o.onMenu) return { ...o, stockQty, variantPrices: undefined as Record<string, number> | undefined };
        if (!named.length) {
          const p = o.priceOverride === null || (o.priceOverride as unknown) === "" ? null : +o.priceOverride!;
          return { ...o, stockQty, priceOverride: p, variantPrices: {} as Record<string, number> };
        }
        const cells = named.map((v) => portions[v.i] ?? "");
        const filled = cells.filter((c) => String(c).trim() !== "");
        // All of a branch's portions, or none of them — none means "charge
        // what the first priced branch charges".
        if (filled.length && filled.length !== cells.length)
          throw new Error(`${shortBranch(branchName)}: give a price for every portion, or leave them all empty`);
        if (filled.some((c) => !Number.isFinite(+c) || +c < 0))
          throw new Error(`${shortBranch(branchName)}: prices must be numbers`);
        if (!filled.length) return { ...o, stockQty, priceOverride: null, variantPrices: {} as Record<string, number> };
        const variantPrices = Object.fromEntries(named.map((v, j) => [v.name, +cells[j]]));
        return { ...o, stockQty, priceOverride: +cells[defIndex], variantPrices };
      });

      // basePrice is no longer edited by hand: it is the fallback a branch uses
      // when it has no price of its own, so take the first branch that does.
      // Without this a dish could reach the menu at ₹0.
      if (!branchOverrides.some((o) => o.onMenu))
        throw new Error("Sell it at one branch at least — or use Deactivate to take it off the menu");
      const priced = branchOverrides.find((o) => o.onMenu && o.priceOverride != null);
      if (!priced) throw new Error("Set a price for at least one branch");
      // Likewise each portion's fallback gap, from that same branch.
      const def = named[defIndex];
      const variantsOut = named.map((v) => ({
        name: v.name,
        isDefault: v === def,
        priceDelta: def && priced.variantPrices ? priced.variantPrices[v.name] - priced.variantPrices[def.name] : 0,
      }));

      const payload = {
        ...f,
        basePrice: priced.priceOverride!,
        prepTimeMins: +f.prepTimeMins,
        variants: variantsOut,
        addOns: addOns.filter((a) => a.name.trim()),
        ...(item ? { branchOverrides } : {}),
      };
      const r = await fetch(item ? `/api/admin/menu/items/${item.id}` : "/api/admin/menu/items", {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);

      // Creating an item only makes its branch rows; a second call gives them
      // their prices, so a new dish is priced per branch from the start.
      if (!item && d.item?.id) {
        const r2 = await fetch(`/api/admin/menu/items/${d.item.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ branchOverrides }),
        });
        if (!r2.ok) throw new Error((await r2.json()).error ?? "Item created, but prices did not save");
      }
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={item ? `Edit — ${item.name}` : "New menu item"} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="label" htmlFor="i-name">Name *</label>
            <input id="i-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="i-cat">Category</label>
            <select id="i-cat" className="input" value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label" htmlFor="i-emoji">Emoji (shown when there is no photo)</label>
            <input id="i-emoji" className="input" maxLength={4} value={f.imageEmoji} onChange={(e) => setF({ ...f, imageEmoji: e.target.value })} />
          </div>
          <div className="col-span-2">
            <ImagePicker value={f.imageUrl} onChange={(imageUrl) => setF({ ...f, imageUrl })} />
          </div>
          <div>
            <label className="label" htmlFor="i-prep">Prep time (min)</label>
            <input id="i-prep" type="number" min={1} className="input" value={f.prepTimeMins} onChange={(e) => setF({ ...f, prepTimeMins: +e.target.value })} />
          </div>
          <div className="col-span-2">
            <label className="label" htmlFor="i-desc">Description</label>
            <textarea id="i-desc" className="input" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="i-ing">Ingredients</label>
            <input id="i-ing" className="input" value={f.ingredients} onChange={(e) => setF({ ...f, ingredients: e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="i-all">Allergens</label>
            <input id="i-all" className="input" value={f.allergens} onChange={(e) => setF({ ...f, allergens: e.target.value })} />
          </div>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {([["veg", "🟢 Veg"], ["spicy", "🌶 Spicy"], ["bestseller", "⭐ Bestseller"], ["recommended", "👍 Recommended"], ["active", "Active"]] as const).map(([k, label]) => (
            <label key={k} className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={f[k] as boolean} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
              {label}
            </label>
          ))}
        </div>

        <fieldset>
          <legend className="label">Portions</legend>
          {variants.map((v, i) => (
            <div key={i} className="flex gap-2 mb-2 items-center">
              <input className="input" placeholder="Name (e.g. Half)" value={v.name} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Portion name" />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                <input type="radio" name="defVar" checked={v.isDefault} onChange={() => setVariants(variants.map((x, j) => ({ ...x, isDefault: j === i })))} /> shown first
              </label>
              <button onClick={() => removePortion(i)} aria-label="Remove portion" className="text-red-700">✕</button>
            </div>
          ))}
          <div className="flex flex-wrap gap-3 text-sm">
            {variants.length === 0 && (
              <button onClick={() => { setVariants([{ name: "Half", isDefault: true }, { name: "Full", isDefault: false }]); setOverrides(overrides.map((o) => ({ ...o, portions: ["", ""] }))); }} className="underline">
                + Sell in Half and Full
              </button>
            )}
            <button onClick={() => addPortion()} className="underline">+ Add portion</button>
          </div>
          <p className="text-xs text-maroon-800/50 mt-1">
            {variants.length ? "Set each portion's price for each branch below." : "No portions: the dish has one price per branch."}
          </p>
        </fieldset>

        <fieldset>
          <legend className="label">Add-ons</legend>
          {addOns.map((a, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className="input" placeholder="Name (e.g. Extra Raita)" value={a.name} onChange={(e) => setAddOns(addOns.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Add-on name" />
              <input className="input !w-28" type="number" min={0} placeholder="₹" value={a.price} onChange={(e) => setAddOns(addOns.map((x, j) => (j === i ? { ...x, price: +e.target.value } : x)))} aria-label="Add-on price" />
              <button onClick={() => setAddOns(addOns.filter((_, j) => j !== i))} aria-label="Remove add-on" className="text-red-700">✕</button>
            </div>
          ))}
          <button onClick={() => setAddOns([...addOns, { name: "", price: 0, veg: true, required: false }])} className="text-sm underline">+ Add add-on</button>
        </fieldset>

        {/* Price lives here, once per branch. Rohini and NSP charge what they
            charge; there is no single "base price" for the owner to reconcile
            against. Shown when creating too, so a new dish is priced up front. */}
        <fieldset>
          <legend className="label">Price at each branch *</legend>
          {overrides.map((o, i) => (
            <div key={o.branchId} className="flex flex-wrap gap-2 items-center mb-3 text-sm border-b border-cream-100 pb-2">
              <span className="font-semibold w-40">{shortBranch(o.branchName)}</span>
              <label className="flex items-center gap-1" title="Untick if this branch does not make this dish — it disappears from that branch's menu">
                <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={o.onMenu} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, onMenu: e.target.checked } : x)))} />
                sold here
              </label>
              {!o.onMenu ? (
                <span className="text-xs text-maroon-800/50">Not on this branch&apos;s menu</span>
              ) : (
              <>
              <label className="flex items-center gap-1" title="Untick when it has run out today — it shows as sold out">
                <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={o.available} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, available: e.target.checked } : x)))} />
                in stock
              </label>
              {variants.length === 0 ? (
                <input
                  className="input !min-h-[36px] !w-28"
                  type="number"
                  min={0}
                  placeholder="₹ price"
                  value={o.priceOverride ?? ""}
                  onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, priceOverride: e.target.value === "" ? null : +e.target.value } : x)))}
                  aria-label={`Price at ${o.branchName}`}
                />
              ) : (
                variants.map((v, k) => (
                  <label key={k} className="flex items-center gap-1">
                    <span className="text-xs text-maroon-800/60">{v.name || `Portion ${k + 1}`}</span>
                    <input
                      className="input !min-h-[36px] !w-24"
                      type="number"
                      min={0}
                      placeholder="₹"
                      value={o.portions[k] ?? ""}
                      onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, portions: x.portions.map((p, m) => (m === k ? e.target.value : p)) } : x)))}
                      aria-label={`${v.name || `Portion ${k + 1}`} price at ${o.branchName}`}
                    />
                  </label>
                ))
              )}
              <input className="input !min-h-[36px] !w-28" type="number" min={-1} placeholder="Stock (-1 = ∞)" value={o.stockQty} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, stockQty: +e.target.value } : x)))} aria-label={`Stock at ${o.branchName}`} title="Stock (-1 = unlimited)" />
              </>
              )}
            </div>
          ))}
          <p className="text-xs text-maroon-800/50">
            Leave a branch empty to charge the same as the first branch that has a price.
          </p>
        </fieldset>

        <ErrorBox message={error} />
        <div className="flex gap-2">
          <button onClick={save} disabled={busy || !f.name || !f.categoryId} className="btn-primary flex-1">
            {busy ? "Saving…" : "Save item"}
          </button>
          {item && (
            <button
              onClick={async () => {
                if (!confirm("Deactivate this item? It will disappear from the menu but stay in order history.")) return;
                await fetch(`/api/admin/menu/items/${item.id}`, { method: "DELETE" });
                onSaved();
              }}
              className="btn-outline !text-red-700 !border-red-700"
            >
              Deactivate
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}

interface StoredImage { name: string; url: string; sizeKb: number }

/**
 * Photo picker for a menu item: choose an already-uploaded photo from the
 * dropdown, upload a new one, or clear it back to the emoji placeholder.
 * Uploads land in public/uploads/menu/, so photos dropped in there by FTP or
 * cPanel File Manager show up in the list too.
 */
function ImagePicker({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [images, setImages] = useState<StoredImage[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/menu/images")
      .then((r) => r.json())
      .then((d) => setImages(d.images ?? []))
      .catch(() => setImages([]));
  }, []);

  useEffect(load, [load]);

  const upload = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // No Content-Type header — the browser must set the multipart boundary.
      const r = await fetch("/api/admin/menu/images", { method: "POST", body: fd });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onChange(d.image.url); // select what was just uploaded
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <span className="label">Photo</span>
      <div className="flex items-start gap-3">
        <div className="h-20 w-20 shrink-0 rounded-xl border border-cream-300 bg-cream-100 overflow-hidden grid place-items-center">
          {value ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={value} alt="Selected menu photo" className="h-full w-full object-cover" />
          ) : (
            <span className="text-xs text-maroon-800/40 text-center px-1">No photo</span>
          )}
        </div>

        <div className="flex-1 min-w-0 space-y-2">
          <select
            className="input"
            aria-label="Choose an existing photo"
            value={value ?? ""}
            onChange={(e) => onChange(e.target.value || null)}
          >
            <option value="">— No photo (use emoji) —</option>
            {images?.map((img) => (
              <option key={img.name} value={img.url}>
                {img.name} ({img.sizeKb} KB)
              </option>
            ))}
            {/* Keeps an externally-hosted URL visible instead of silently blanking it. */}
            {value && !images?.some((i) => i.url === value) && (
              <option value={value}>{value}</option>
            )}
          </select>

          <div className="flex flex-wrap items-center gap-2">
            <label className={`btn-secondary !min-h-[36px] !px-3 text-sm ${busy ? "opacity-50" : "cursor-pointer"}`}>
              {busy ? "Uploading…" : "⬆ Upload new"}
              <input
                type="file"
                className="sr-only"
                accept="image/jpeg,image/png,image/webp,image/avif"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) upload(file);
                  e.target.value = ""; // allow re-picking the same file
                }}
              />
            </label>
            {value && (
              <button type="button" className="btn-ghost !min-h-[36px] !px-3 text-sm" onClick={() => onChange(null)}>
                Remove
              </button>
            )}
            <button type="button" className="btn-ghost !min-h-[36px] !px-3 text-sm" onClick={load}>
              ↻ Refresh list
            </button>
          </div>

          <p className="text-xs text-maroon-800/50">
            JPG, PNG, WebP or AVIF · max 5 MB. Saved to <code>public/uploads/menu/</code>.
          </p>
          <ErrorBox message={error} />
        </div>
      </div>
    </div>
  );
}
