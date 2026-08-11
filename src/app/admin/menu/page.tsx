"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal, Spinner, VegMark } from "@/components/ui";
import { inr } from "@/lib/utils";

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
    // Carried through every save: the PATCH route nulls anything it is not
    // given, so omitting these silently wipes an item's serving window.
    availableFrom?: string | null; availableTo?: string | null;
    branch?: { name: string };
  }[];
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

      <p className="text-sm text-maroon-800/60 mb-2">
        Each branch has its own price. Open <strong>Edit</strong> on a dish to set what
        Rohini and NSP each charge.
      </p>

      {!items ? (
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
                    {b.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
                    <span className="block text-[11px] font-normal normal-case text-maroon-800/40">
                      price · stock
                    </span>
                  </th>
                ))}
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
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
                    return (
                      <td key={b.id} className="p-3 align-top">
                        {/* The price this branch actually charges. Editing lives
                            in Edit, so a stray click on a busy dashboard cannot
                            reprice a dish. */}
                        <span className="block font-semibold">
                          {inr(bi?.priceOverride ?? it.basePrice)}
                        </span>
                        <button
                          onClick={() => toggleAvailability(it, b.id, !avail)}
                          className={`mt-1 text-xs font-bold px-2 py-1 rounded-full ${avail ? "bg-green-100 text-leaf-600" : "bg-red-100 text-red-700"}`}
                          aria-label={`Toggle ${it.name} at ${b.name}`}
                        >
                          {avail ? "In stock" : "Off"}
                        </button>
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
      const branchOverrides = overrides.map(({ branchName, ...o }) => ({
        ...o,
        priceOverride:
          o.priceOverride === null || (o.priceOverride as unknown) === ""
            ? null
            : +o.priceOverride!,
        stockQty: +o.stockQty,
      }));

      // basePrice is no longer edited by hand: it is the fallback a branch uses
      // when it has no price of its own, so take the first branch that does.
      // Without this a dish could reach the menu at ₹0.
      const priced = branchOverrides.find((o) => o.priceOverride != null);
      if (!priced) throw new Error("Set a price for at least one branch");

      const payload = {
        ...f,
        basePrice: priced.priceOverride!,
        prepTimeMins: +f.prepTimeMins,
        variants: variants.filter((v) => v.name.trim()),
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

        {/* Price lives here, once per branch. Rohini and NSP charge what they
            charge; there is no single "base price" for the owner to reconcile
            against. Shown when creating too, so a new dish is priced up front. */}
        <fieldset>
          <legend className="label">Price at each branch *</legend>
          {overrides.map((o, i) => (
            <div key={o.branchId} className="grid grid-cols-[1fr_auto_7rem_7rem] gap-2 items-center mb-2 text-sm">
              <span className="font-semibold">
                {o.branchName.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
              </span>
              <label className="flex items-center gap-1">
                <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={o.available} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, available: e.target.checked } : x)))} />
                available
              </label>
              <input
                className="input !min-h-[36px]"
                type="number"
                min={0}
                placeholder="₹ price"
                value={o.priceOverride ?? ""}
                onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, priceOverride: e.target.value === "" ? null : +e.target.value } : x)))}
                aria-label={`Price at ${o.branchName}`}
              />
              <input className="input !min-h-[36px]" type="number" min={-1} placeholder="Stock (-1 = ∞)" value={o.stockQty} onChange={(e) => setOverrides(overrides.map((x, j) => (j === i ? { ...x, stockQty: +e.target.value } : x)))} aria-label={`Stock at ${o.branchName}`} />
            </div>
          ))}
          <p className="text-xs text-maroon-800/50">
            Leave a branch blank to charge the same as the first branch that has a price.
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
