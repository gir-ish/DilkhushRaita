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
      <header className="pt-7 pb-5">
        <p className="eyebrow">Our menu</p>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mt-1.5">
          <h1 className="font-display text-fluid-2xl font-semibold text-maroon-700">
            {branch.name}
          </h1>
          <Badge tone={branch.open ? "green" : "gray"}>
            {branch.open ? "Open" : (branch.openReason ?? "Closed")}
          </Badge>
          {branch.busyMode && <Badge tone="maroon">Busy — longer prep times</Badge>}
        </div>
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-maroon-800/60">
          <span className="money">⏱ ~{branch.prepTimeMins} min prep</span>
          {branch.minOrderValue > 0 && (
            <>
              <span aria-hidden className="text-mustard-400">
                ◆
              </span>
              <span className="money">Min order {inr(branch.minOrderValue)}</span>
            </>
          )}
          <span aria-hidden className="text-mustard-400">
            ◆
          </span>
          <Link
            href="/"
            className="link-classic font-semibold text-maroon-600 hover:text-maroon-700"
          >
            change branch
          </Link>
        </p>
      </header>

      {/* The whole filter bar travels with the page. The gradient tail below it
          keeps dish cards from appearing to slice through the bar as they
          scroll under its bottom edge. */}
      <div className="sticky top-16 z-30 -mx-4 px-4 pt-2 pb-2 bg-cream-100/92 backdrop-blur-md border-b border-maroon-800/10 after:absolute after:inset-x-0 after:top-full after:h-4 after:bg-gradient-to-b after:from-cream-100/80 after:to-transparent after:pointer-events-none">
        <label htmlFor="menu-search" className="sr-only">Search the menu</label>
        <input
          id="menu-search"
          type="search"
          className="input"
          placeholder="Search dal, paneer, raita…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <div className="rail py-2.5" role="tablist" aria-label="Categories">
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
        <div className="rail pb-1" aria-label="Filters">
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
        <div className="py-16 text-center">
          <p className="text-4xl" aria-hidden>
            🍽
          </p>
          <p className="mt-3 font-display text-fluid-lg font-semibold text-maroon-700">
            Nothing matches those filters
          </p>
          <p className="mt-1 text-sm text-maroon-800/60">
            Try clearing a filter or searching for something else.
          </p>
        </div>
      )}

      {filtered.map((c) => (
        <section key={c.id} aria-labelledby={`cat-${c.id}`} className="mt-9 first:mt-7">
          <div className="flex items-center gap-4 mb-4">
            <h2
              id={`cat-${c.id}`}
              className="font-display text-fluid-xl font-semibold text-maroon-700 whitespace-nowrap"
            >
              {c.name}
            </h2>
            {/* Rule runs out to the margin, as a menu section head does. */}
            <span aria-hidden className="rule-ornament flex-1" />
            <span className="text-xs font-semibold text-maroon-800/40 money">
              {c.items.length}
            </span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
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
        <div className="fixed bottom-0 inset-x-0 z-40 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] pointer-events-none sm:left-auto sm:w-96">
          <Link
            href="/cart"
            className="btn-primary w-full !min-h-[56px] !text-base shadow-lift pointer-events-auto animate-sheet-up"
          >
            <span aria-hidden>🛒</span>
            <span className="font-semibold">
              {cart.count} item{cart.count > 1 ? "s" : ""}
            </span>
            <span aria-hidden className="text-cream-50/40">
              |
            </span>
            <span className="money">{inr(cart.displayTotal)}</span>
            <span className="ml-auto text-cream-50/85">View cart →</span>
          </Link>
        </div>
      )}
    </div>
  );
}

function ItemCard({ item, fav, onOpen }: { item: MenuItemDto; fav: boolean; onOpen: () => void }) {
  return (
    <article
      className={`card p-3.5 flex gap-3.5 ${item.available ? "card-hover" : "opacity-55 saturate-50"}`}
    >
      <div className="relative shrink-0">
        <FoodImage
          emoji={item.imageEmoji}
          url={item.imageUrl}
          name={item.name}
          className="h-[104px] w-[104px] rounded-xl ring-1 ring-maroon-800/10 shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"
        />
        {item.bestseller && (
          <span className="absolute -top-1.5 -left-1.5 rounded-full bg-gradient-to-b from-mustard-300 to-mustard-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-maroon-800 ring-2 ring-cream-50 shadow-sm">
            ★ Best
          </span>
        )}
        {fav && (
          <span
            className="absolute -bottom-1.5 -right-1.5 grid h-6 w-6 place-items-center rounded-full bg-cream-50 text-xs ring-1 ring-maroon-800/10 shadow-sm"
            aria-label="Favourite"
          >
            ❤️
          </span>
        )}
      </div>

      <div className="min-w-0 flex-1 flex flex-col">
        <div className="flex items-center gap-2">
          <VegMark veg={item.veg} />
          {item.spicy && (
            <span aria-label="Spicy" title="Spicy" className="text-xs">
              🌶
            </span>
          )}
          <span className="ml-auto text-[11px] font-semibold text-maroon-800/45 money">
            ⏱ {item.prepTimeMins}m · ★ 4.{(item.name.length % 5) + 3}
            {/* rating placeholder until reviews accumulate */}
          </span>
        </div>

        <h3 className="font-display font-semibold text-[15.5px] text-maroon-800 leading-snug mt-1.5">
          {item.name}
        </h3>
        {item.nameHindi && (
          <p className="text-[11px] text-maroon-800/45 leading-tight">{item.nameHindi}</p>
        )}
        <p className="text-xs text-maroon-800/60 line-clamp-2 mt-1 leading-relaxed">
          {item.description}
        </p>

        <div className="mt-auto flex items-end justify-between gap-2 pt-2.5">
          <span className="font-display text-[19px] font-semibold text-maroon-700 money leading-none">
            {inr(item.price)}
          </span>
          {item.available ? (
            <button
              onClick={onOpen}
              className="btn-secondary !min-h-[36px] !px-5 !text-[13px] tracking-wide uppercase"
              aria-label={`Add ${item.name}`}
            >
              Add
            </button>
          ) : (
            <span className="text-[11px] font-semibold text-red-800 bg-red-50 border border-red-200 rounded-md px-2 py-1">
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
