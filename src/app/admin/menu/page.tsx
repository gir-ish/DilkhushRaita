"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal, Spinner, VegMark } from "@/components/ui";
import { inr } from "@/lib/utils";

interface Category { id: string; name: string; displayOrder: number; active: boolean; _count: { items: number } }
interface BranchLite { id: string; name: string }
interface Item {
  id: string; name: string; description: string; basePrice: number; imageEmoji: string;
  veg: boolean; spicy: boolean; bestseller: boolean; recommended: boolean; active: boolean;
  categoryId: string; category: { name: string }; prepTimeMins: number;
  ingredients: string; allergens: string;
  variants: { id?: string; name: string; priceDelta: number; isDefault: boolean }[];
  addOns: { id?: string; name: string; price: number; veg: boolean; required: boolean }[];
  branchItems: { branchId: string; available: boolean; priceOverride: number | null; stockQty: number; branch?: { name: string } }[];
}

export default function AdminMenuPage() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [items, setItems] = useState<Item[] | null>(null);
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Item | "new" | null>(null);
  const [newCat, setNewCat] = useState("");

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

  const toggleAvailability = async (item: Item, branchId: string, available: boolean) => {
    await fetch(`/api/admin/menu/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ branchOverrides: [{ branchId, available, stockQty: item.branchItems.find((b) => b.branchId === branchId)?.stockQty ?? -1 }] }),
    });
    load();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Menu</h1>
        <a href="/api/admin/menu/items?format=csv" className="btn-outline !min-h-[38px] text-sm">⬇️ Export CSV</a>
        <label className="btn-outline !min-h-[38px] text-sm cursor-pointer">
          ⬆️ Import CSV
          <input
            type="file"
            accept=".csv"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const r = await fetch("/api/admin/menu/import", { method: "POST", body: await f.text() });
              const d = await r.json();
              if (r.ok) { alert(`Imported: ${d.created} created, ${d.updated} updated`); load(); }
              else setError(d.error);
            }}
          />
        </label>
        <button onClick={() => setEditing("new")} className="btn-primary !min-h-[38px]">+ New item</button>
      </div>

      <ErrorBox message={error} />

      <section className="card p-4 mb-4" aria-label="Categories">
        <h2 className="font-semibold mb-2">Categories</h2>
        <div className="flex flex-wrap gap-2 items-center">
          {categories?.map((c) => (
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

      {!items ? (
        <Spinner label="Loading items…" />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[640px]">
            <thead>
              <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                <th className="p-3">Item</th>
                <th className="p-3">Category</th>
                <th className="p-3">Price</th>
                {branches.map((b) => <th key={b.id} className="p-3">{b.name}</th>)}
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id} className={`border-b border-cream-100 ${!it.active ? "opacity-40" : ""}`}>
                  <td className="p-3">
                    <span className="flex items-center gap-2">
                      <span aria-hidden>{it.imageEmoji}</span>
                      <VegMark veg={it.veg} />
                      <span className="font-semibold">{it.name}</span>
                      {it.bestseller && "⭐"}
                    </span>
                  </td>
                  <td className="p-3">{it.category.name}</td>
                  <td className="p-3">{inr(it.basePrice)}</td>
                  {branches.map((b) => {
                    const bi = it.branchItems.find((x) => x.branchId === b.id);
                    const avail = bi?.available ?? true;
                    return (
                      <td key={b.id} className="p-3">
                        <button
                          onClick={() => toggleAvailability(it, b.id, !avail)}
                          className={`text-xs font-bold px-2 py-1 rounded-full ${avail ? "bg-green-100 text-leaf-600" : "bg-red-100 text-red-700"}`}
                          aria-label={`Toggle ${it.name} at ${b.name}`}
                        >
                          {avail ? "In stock" : "Off"}
                        </button>
                        {bi?.priceOverride != null && <span className="block text-xs text-maroon-800/50">{inr(bi.priceOverride)}</span>}
                        {bi != null && bi.stockQty >= 0 && <span className="block text-xs text-mustard-600">qty {bi.stockQty}</span>}
                      </td>
                    );
                  })}
                  <td className="p-3">
                    <button onClick={() => setEditing(it)} className="underline text-maroon-600">Edit</button>
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
    </div>
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
  const [variants, setVariants] = useState(item?.variants.map((v) => ({ name: v.name, priceDelta: v.priceDelta, isDefault: v.isDefault })) ?? []);
  const [addOns, setAddOns] = useState(item?.addOns.map((a) => ({ name: a.name, price: a.price, veg: a.veg, required: a.required })) ?? []);
  const [overrides, setOverrides] = useState(
    branches.map((b) => {
      const bi = item?.branchItems.find((x) => x.branchId === b.id);
      return {
        branchId: b.id,
        branchName: b.name,
        available: bi?.available ?? true,
        priceOverride: bi?.priceOverride ?? null,
        stockQty: bi?.stockQty ?? -1,
      };
    })
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        ...f,
        basePrice: +f.basePrice,
        prepTimeMins: +f.prepTimeMins,
        variants: variants.filter((v) => v.name.trim()),
        addOns: addOns.filter((a) => a.name.trim()),
        ...(item
          ? { branchOverrides: overrides.map(({ branchName, ...o }) => ({ ...o, priceOverride: o.priceOverride === null || (o.priceOverride as unknown) === "" ? null : +o.priceOverride!, stockQty: +o.stockQty })) }
          : {}),
      };
      const r = await fetch(item ? `/api/admin/menu/items/${item.id}` : "/api/admin/menu/items", {
        method: item ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
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
            <label className="label" htmlFor="i-price">Base price (₹) *</label>
            <input id="i-price" type="number" min={0} className="input" value={f.basePrice} onChange={(e) => setF({ ...f, basePrice: +e.target.value })} />
          </div>
          <div>
            <label className="label" htmlFor="i-emoji">Emoji (placeholder image)</label>
            <input id="i-emoji" className="input" maxLength={4} value={f.imageEmoji} onChange={(e) => setF({ ...f, imageEmoji: e.target.value })} />
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
          <legend className="label">Portion variants</legend>
          {variants.map((v, i) => (
            <div key={i} className="flex gap-2 mb-2">
              <input className="input" placeholder="Name (e.g. Half)" value={v.name} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} aria-label="Variant name" />
              <input className="input !w-28" type="number" placeholder="+₹" value={v.priceDelta} onChange={(e) => setVariants(variants.map((x, j) => (j === i ? { ...x, priceDelta: +e.target.value } : x)))} aria-label="Price delta" />
              <label className="flex items-center gap-1 text-xs whitespace-nowrap">
                <input type="radio" name="defVar" checked={v.isDefault} onChange={() => setVariants(variants.map((x, j) => ({ ...x, isDefault: j === i })))} /> default
              </label>
              <button onClick={() => setVariants(variants.filter((_, j) => j !== i))} aria-label="Remove variant" className="text-red-700">✕</button>
            </div>
          ))}
          <button onClick={() => setVariants([...variants, { name: "", priceDelta: 0, isDefault: variants.length === 0 }])} className="text-sm underline">+ Add variant</button>
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

        {item && (
          <fieldset>
            <legend className="label">Branch settings</legend>
            {overrides.map((o, i) => (
              <div key={o.branchId} className="grid grid-cols-4 gap-2 items-center mb-2 text-sm">
                <span className="font-semibold">{o.branchName}</span>
                <label className="flex items-center gap-1">
                  <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={o.available} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, available: e.target.checked } : x)))} />
                  available
                </label>
                <input className="input !min-h-[36px]" type="number" placeholder="Price override" value={o.priceOverride ?? ""} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, priceOverride: e.target.value === "" ? null : +e.target.value } : x)))} aria-label={`Price override at ${o.branchName}`} />
                <input className="input !min-h-[36px]" type="number" min={-1} placeholder="Stock (-1 = ∞)" value={o.stockQty} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, stockQty: +e.target.value } : x)))} aria-label={`Stock at ${o.branchName}`} />
              </div>
            ))}
          </fieldset>
        )}

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
