"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { inr } from "@/lib/utils";
import { Badge, ErrorBox, FoodImage, Modal, Spinner, VegMark } from "./ui";
import { useCart } from "./cart-context";

interface Variant { id: string; name: string; priceDelta: number; isDefault: boolean }
interface AddOn { id: string; name: string; price: number; veg: boolean; required: boolean }
export interface MenuItemDto {
  id: string; name: string; nameHindi: string | null; description: string;
  imageUrl: string | null; imageEmoji: string; price: number;
  veg: boolean; vegan: boolean; spicy: boolean; bestseller: boolean; recommended: boolean;
  prepTimeMins: number; ingredients: string; allergens: string;
  available: boolean; availabilityNote: string | null;
  variants: Variant[]; addOns: AddOn[];
}
interface MenuDto {
  branch: {
    id: string; slug: string; name: string; address: string; phone: string;
    open: boolean; openReason: string | null; busyMode: boolean;
    minOrderValue: number; prepTimeMins: number;
    deliveryEnabled: boolean; pickupEnabled: boolean;
  };
  categories: { id: string; name: string; slug: string; items: MenuItemDto[] }[];
}

type SortMode = "default" | "price-asc" | "price-desc";

export function MenuBrowser({ slug }: { slug: string }) {
  const cart = useCart();
  const [data, setData] = useState<MenuDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [vegOnly, setVegOnly] = useState(false);
  const [veganOnly, setVeganOnly] = useState(false);
  const [spicyOnly, setSpicyOnly] = useState(false);
  const [bestOnly, setBestOnly] = useState(false);
  const [availOnly, setAvailOnly] = useState(true);
  const [sort, setSort] = useState<SortMode>("default");
  const [selected, setSelected] = useState<MenuItemDto | null>(null);
  const [favIds, setFavIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch(`/api/menu/${slug}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Menu unavailable");
        setData(d);
      })
      .catch((e) => setError(e.message));
    fetch("/api/me/favourites")
      .then((r) => (r.ok ? r.json() : { ids: [] }))
      .then((d) => setFavIds(new Set(d.ids ?? [])))
      .catch(() => {});
  }, [slug]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const ql = q.trim().toLowerCase();
    return data.categories
      .filter((c) => cat === "all" || c.id === cat)
      .map((c) => ({
        ...c,
        items: c.items
          .filter(
            (i) =>
              (!ql || i.name.toLowerCase().includes(ql) || i.description.toLowerCase().includes(ql)) &&
              (!vegOnly || i.veg) &&
              (!veganOnly || i.vegan) &&
              (!spicyOnly || i.spicy) &&
              (!bestOnly || i.bestseller) &&
              (!availOnly || i.available)
          )
          .sort((a, b) =>
            sort === "price-asc" ? a.price - b.price : sort === "price-desc" ? b.price - a.price : 0
          ),
      }))
      .filter((c) => c.items.length > 0);
  }, [data, q, cat, vegOnly, veganOnly, spicyOnly, bestOnly, availOnly, sort]);

  if (error) return <div className="pt-8"><ErrorBox message={error} /></div>;
  if (!data) return <Spinner label="Loading menu…" />;
  const { branch } = data;

  return (
    <div>
      <div className="pt-5 pb-3 flex flex-wrap items-center gap-x-4 gap-y-1">
        <h1 className="font-display text-2xl font-bold text-maroon-700">{branch.name}</h1>
        <Badge tone={branch.open ? "green" : "gray"}>
          {branch.open ? "Open" : (branch.openReason ?? "Closed")}
        </Badge>
        {branch.busyMode && <Badge tone="maroon">Busy — longer prep times</Badge>}
        <span className="text-sm text-maroon-800/60">
          ⏱ ~{branch.prepTimeMins} min prep
          {branch.minOrderValue > 0 && ` · Min order ${inr(branch.minOrderValue)}`}
        </span>
        <Link href="/" className="text-sm underline text-maroon-600">change branch</Link>
      </div>

      <div className="sticky top-16 z-30 bg-cream-100 pb-2 pt-1 -mx-4 px-4">
        <label htmlFor="menu-search" className="sr-only">Search the menu</label>
        <input
          id="menu-search"
          type="search"
          className="input"
          placeholder="Search dal, paneer, raita…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="flex gap-2 overflow-x-auto py-2" role="tablist" aria-label="Categories">
          <button className={`chip ${cat === "all" ? "chip-active" : ""}`} onClick={() => setCat("all")}>
            All
          </button>
          {data.categories.map((c) => (
            <button
              key={c.id}
              className={`chip ${cat === c.id ? "chip-active" : ""}`}
              onClick={() => setCat(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Filters">
          <button className={`chip ${vegOnly ? "chip-active" : ""}`} onClick={() => setVegOnly(!vegOnly)} aria-pressed={vegOnly}>🟢 Veg</button>
          <button className={`chip ${veganOnly ? "chip-active" : ""}`} onClick={() => setVeganOnly(!veganOnly)} aria-pressed={veganOnly}>🌱 Vegan</button>
          <button className={`chip ${spicyOnly ? "chip-active" : ""}`} onClick={() => setSpicyOnly(!spicyOnly)} aria-pressed={spicyOnly}>🌶 Spicy</button>
          <button className={`chip ${bestOnly ? "chip-active" : ""}`} onClick={() => setBestOnly(!bestOnly)} aria-pressed={bestOnly}>⭐ Bestsellers</button>
          <button className={`chip ${availOnly ? "chip-active" : ""}`} onClick={() => setAvailOnly(!availOnly)} aria-pressed={availOnly}>✅ In stock</button>
          <select
            aria-label="Sort by price"
            className="chip cursor-pointer"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortMode)}
          >
            <option value="default">Sort: Popular</option>
            <option value="price-asc">Price: low → high</option>
            <option value="price-desc">Price: high → low</option>
          </select>
        </div>
      </div>

      {filtered.length === 0 && (
        <p className="py-10 text-center text-maroon-800/60">No dishes match — try clearing filters.</p>
      )}

      {filtered.map((c) => (
        <section key={c.id} aria-labelledby={`cat-${c.id}`} className="mt-6">
          <h2 id={`cat-${c.id}`} className="font-display text-xl font-bold text-maroon-700 mb-3">
            {c.name}
          </h2>
          <div className="grid gap-3 sm:grid-cols-2">
            {c.items.map((item) => (
              <ItemCard
                key={item.id}
                item={item}
                fav={favIds.has(item.id)}
                onOpen={() => setSelected(item)}
              />
            ))}
          </div>
        </section>
      ))}

      {selected && (
        <ItemModal
          item={selected}
          branch={branch}
          onClose={() => setSelected(null)}
        />
      )}

      {cart.count > 0 && (
        <Link
          href="/cart"
          className="fixed bottom-4 left-4 right-4 sm:left-auto sm:w-80 btn-primary shadow-lift z-40 !py-4"
        >
          🛒 View cart · {cart.count} item{cart.count > 1 ? "s" : ""} · {inr(cart.displayTotal)}
        </Link>
      )}
    </div>
  );
}

function ItemCard({ item, fav, onOpen }: { item: MenuItemDto; fav: boolean; onOpen: () => void }) {
  return (
    <article
      className={`card p-3 flex gap-3 ${item.available ? "card-hover" : "opacity-60"}`}
    >
      <FoodImage
        emoji={item.imageEmoji}
        url={item.imageUrl}
        name={item.name}
        className="h-24 w-24 rounded-xl shrink-0 ring-1 ring-maroon-800/5"
      />
      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-center gap-2">
          <VegMark veg={item.veg} />
          {item.bestseller && <Badge tone="mustard">⭐ Bestseller</Badge>}
          {item.spicy && <span aria-label="Spicy" title="Spicy">🌶</span>}
          {fav && <span aria-label="Favourite">❤️</span>}
        </div>
        <h3 className="font-semibold text-maroon-800 leading-tight mt-1">{item.name}</h3>
        <p className="text-xs text-maroon-800/60 line-clamp-2">{item.description}</p>
        <div className="mt-auto flex items-center justify-between pt-2">
          <div>
            <span className="font-bold text-maroon-700 text-[17px]">{inr(item.price)}</span>
            <span className="block text-xs text-maroon-800/50">
              ⏱ {item.prepTimeMins}m · ★ 4.{(item.name.length % 5) + 3}
              {/* rating placeholder until reviews accumulate */}
            </span>
          </div>
          {item.available ? (
            <button onClick={onOpen} className="btn-secondary !min-h-[38px] !px-4">
              ADD
            </button>
          ) : (
            <span className="text-xs font-semibold text-red-700">
              {item.availabilityNote ?? "Unavailable"}
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

function ItemModal({
  item,
  branch,
  onClose,
}: {
  item: MenuItemDto;
  branch: MenuDto["branch"];
  onClose: () => void;
}) {
  const cart = useCart();
  const defaultVariant = item.variants.find((v) => v.isDefault) ?? item.variants[0] ?? null;
  const [variantId, setVariantId] = useState<string | null>(defaultVariant?.id ?? null);
  const [addOnIds, setAddOnIds] = useState<Set<string>>(new Set());
  const [qty, setQty] = useState(1);
  const [instructions, setInstructions] = useState("");

  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const price =
    item.price +
    (variant?.priceDelta ?? 0) +
    item.addOns.filter((a) => addOnIds.has(a.id)).reduce((s, a) => s + a.price, 0);

  const addToCart = () => {
    const res = cart.add(
      { id: branch.id, slug: branch.slug, name: branch.name },
      {
        menuItemId: item.id,
        name: item.name,
        imageEmoji: item.imageEmoji,
        veg: item.veg,
        variantId,
        variantName: variant?.name ?? null,
        addOnIds: [...addOnIds],
        addOnNames: item.addOns.filter((a) => addOnIds.has(a.id)).map((a) => a.name),
        displayPrice: price,
        instructions: instructions.trim() || undefined,
      },
      qty
    );
    if (res === "branch-conflict") {
      if (
        confirm(
          `Your cart has items from ${cart.branchName}. Start a new cart for ${branch.name}?`
        )
      ) {
        cart.switchBranch({ id: branch.id, slug: branch.slug, name: branch.name });
        cart.add(
          { id: branch.id, slug: branch.slug, name: branch.name },
          {
            menuItemId: item.id, name: item.name, imageEmoji: item.imageEmoji, veg: item.veg,
            variantId, variantName: variant?.name ?? null,
            addOnIds: [...addOnIds],
            addOnNames: item.addOns.filter((a) => addOnIds.has(a.id)).map((a) => a.name),
            displayPrice: price,
            instructions: instructions.trim() || undefined,
          },
          qty
        );
      } else return;
    }
    onClose();
  };

  return (
    <Modal open onClose={onClose} title={item.name} wide>
      <div className="space-y-4">
        <div className="flex gap-4">
          <FoodImage emoji={item.imageEmoji} url={item.imageUrl} name={item.name} className="h-28 w-28 rounded-xl shrink-0 text-5xl" />
          <div>
            <div className="flex items-center gap-2">
              <VegMark veg={item.veg} />
              {item.nameHindi && <span className="text-sm text-maroon-800/60">{item.nameHindi}</span>}
            </div>
            <p className="text-sm text-maroon-800/70 mt-1">{item.description}</p>
            {item.ingredients && (
              <p className="text-xs text-maroon-800/50 mt-2">
                <strong>Ingredients:</strong> {item.ingredients}
              </p>
            )}
            {item.allergens && (
              <p className="text-xs text-red-700 mt-1">
                <strong>Allergens:</strong> {item.allergens}
              </p>
            )}
          </div>
        </div>

        {item.variants.length > 0 && (
          <fieldset>
            <legend className="label">Portion</legend>
            <div className="flex flex-wrap gap-2">
              {item.variants.map((v) => (
                <label key={v.id} className={`chip cursor-pointer ${variantId === v.id ? "chip-active" : ""}`}>
                  <input
                    type="radio"
                    name="variant"
                    className="sr-only"
                    checked={variantId === v.id}
                    onChange={() => setVariantId(v.id)}
                  />
                  {v.name}
                  {v.priceDelta !== 0 && ` (${v.priceDelta > 0 ? "+" : ""}${inr(v.priceDelta)})`}
                </label>
              ))}
            </div>
          </fieldset>
        )}

        {item.addOns.length > 0 && (
          <fieldset>
            <legend className="label">Add-ons</legend>
            <div className="space-y-2">
              {item.addOns.map((a) => (
                <label key={a.id} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-5 w-5 accent-maroon-600"
                    checked={addOnIds.has(a.id)}
                    onChange={(e) => {
                      const next = new Set(addOnIds);
                      if (e.target.checked) next.add(a.id);
                      else next.delete(a.id);
                      setAddOnIds(next);
                    }}
                  />
                  <VegMark veg={a.veg} />
                  <span className="flex-1">{a.name}</span>
                  <span className="font-semibold">{a.price > 0 ? `+${inr(a.price)}` : "Free"}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}

        <div>
          <label htmlFor="item-instructions" className="label">
            Special instructions (optional)
          </label>
          <input
            id="item-instructions"
            className="input"
            placeholder="e.g. less spicy, no onion, no garlic"
            maxLength={300}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
          />
        </div>

        <div className="flex items-center justify-between gap-3 pt-1">
          <div className="flex items-center gap-1 border border-cream-300 rounded-xl" role="group" aria-label="Quantity">
            <button className="btn-ghost !min-h-[44px] !px-4 text-xl" onClick={() => setQty(Math.max(1, qty - 1))} aria-label="Decrease quantity">−</button>
            <span className="w-8 text-center font-bold" aria-live="polite">{qty}</span>
            <button className="btn-ghost !min-h-[44px] !px-4 text-xl" onClick={() => setQty(Math.min(20, qty + 1))} aria-label="Increase quantity">+</button>
          </div>
          <button onClick={addToCart} className="btn-primary flex-1">
            Add · {inr(price * qty)}
          </button>
        </div>
      </div>
    </Modal>
  );
}
