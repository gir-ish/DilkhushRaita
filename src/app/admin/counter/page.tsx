"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBox, Modal, Spinner, VegMark } from "@/components/ui";
import { inr } from "@/lib/utils";

interface Variant { id: string; name: string; priceDelta: number; isDefault: boolean }
interface AddOn { id: string; name: string; price: number; veg: boolean }
interface MenuItem {
  id: string; name: string; description: string; price: number;
  veg: boolean; bestseller: boolean; available: boolean; imageEmoji: string; imageUrl: string | null;
  variants: Variant[]; addOns: AddOn[];
}
interface MenuData {
  branch: { id: string; name: string; slug: string };
  categories: { id: string; name: string; items: MenuItem[] }[];
}
interface BranchLite { id: string; name: string; slug: string }
interface CustomerHit { id: string; name: string | null; phone: string | null; completedOrders: number }
interface OpenTab {
  id: string;
  orderNumber: string;
  tableNo: string | null;
  status: string;
  total: number;
  rounds: number;
  itemCount: number;
  customer: { name: string | null; phone: string | null };
  items: { id: string; name: string; variantName: string | null; qty: number; lineTotal: number; round: number }[];
}

interface Line {
  key: string; // identity of an item+variant+add-on combination
  menuItemId: string;
  name: string;
  variantId: string | null;
  variantName: string | null;
  addOnIds: string[];
  addOnNames: string[];
  unitPrice: number;
  qty: number;
}

/**
 * Wrapped in Suspense below: useSearchParams() opts the page out of static
 * prerendering unless it sits inside a suspense boundary, which fails the
 * production build (it passes `next dev` and type-check, so a full build is
 * the only thing that catches it).
 */
function CounterInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [branches, setBranches] = useState<BranchLite[]>([]);
  const [slug, setSlug] = useState<string | null>(null);
  const [menu, setMenu] = useState<MenuData | null>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [lines, setLines] = useState<Line[]>([]);
  const [configuring, setConfiguring] = useState<MenuItem | null>(null);
  const [checkout, setCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"PARCEL" | "DINE_IN">("PARCEL");
  const [tabs, setTabs] = useState<OpenTab[] | null>(null);
  // When set, the cart is being added to this existing tab rather than
  // starting a new order.
  const [addingTo, setAddingTo] = useState<OpenTab | null>(null);
  const [settling, setSettling] = useState<OpenTab | null>(null);
  // Phone only: the cart lives in a sheet behind the bottom bar.
  const [cartOpen, setCartOpen] = useState(false);
  // Brief flash on the bottom bar so a tap is visibly acknowledged when the
  // cart itself is off-screen.
  const [bump, setBump] = useState(false);

  const branchId = menu?.branch.id ?? null;

  const loadTabs = useCallback(() => {
    if (!branchId) return;
    fetch(`/api/admin/counter/tabs?branchId=${branchId}`)
      .then((r) => (r.ok ? r.json() : { tabs: [] }))
      .then((d) => setTabs(d.tabs ?? []))
      .catch(() => setTabs([]));
  }, [branchId]);

  useEffect(loadTabs, [loadTabs]);

  // Deep link from Orders -> "Add items" on an open tab.
  const wantedTab = params.get("tab");
  useEffect(() => {
    if (!wantedTab || !tabs) return;
    const t = tabs.find((x) => x.id === wantedTab);
    if (t) {
      setMode("DINE_IN");
      setAddingTo(t);
    }
  }, [wantedTab, tabs]);

  useEffect(() => {
    // /api/admin/branches is scoped to the branches this staff member actually
    // runs. Using the public /api/branches here listed every branch and
    // defaulted to the first one, so a manager could raise orders against
    // someone else's branch and then not find them in their own queue.
    fetch("/api/admin/branches")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok || !Array.isArray(d.branches)) throw new Error(d.error ?? "Could not load branches");
        setBranches(d.branches);
        setSlug((cur) => cur ?? d.branches[0]?.slug ?? null);
        if (d.branches.length === 0)
          setError("You are not assigned to any branch, so you cannot take counter orders.");
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!slug) return;
    setMenu(null);
    fetch(`/api/menu/${slug}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "Menu unavailable");
        setMenu(d);
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  // Removing the last line from the sheet would otherwise leave a dead panel
  // with every button disabled.
  useEffect(() => {
    if (lines.length === 0) setCartOpen(false);
  }, [lines.length]);

  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setBump(false), 320);
    return () => clearTimeout(t);
  }, [bump]);

  const add = (item: MenuItem, variant: Variant | null, addOns: AddOn[]) => {
    setBump(true);
    const key = [item.id, variant?.id ?? "", ...addOns.map((a) => a.id).sort()].join("|");
    const unitPrice =
      item.price + (variant?.priceDelta ?? 0) + addOns.reduce((s, a) => s + a.price, 0);
    setLines((cur) => {
      const at = cur.findIndex((l) => l.key === key);
      if (at >= 0) {
        const next = [...cur];
        next[at] = { ...next[at], qty: next[at].qty + 1 };
        return next;
      }
      return [
        ...cur,
        {
          key,
          menuItemId: item.id,
          name: item.name,
          variantId: variant?.id ?? null,
          variantName: variant?.name ?? null,
          addOnIds: addOns.map((a) => a.id),
          addOnNames: addOns.map((a) => a.name),
          unitPrice,
          qty: 1,
        },
      ];
    });
  };

  const tap = (item: MenuItem) => {
    // Straight in if there is nothing to choose — speed matters at a counter.
    if (item.variants.length === 0 && item.addOns.length === 0) add(item, null, []);
    else setConfiguring(item);
  };

  const setQty = (key: string, delta: number) =>
    setLines((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l))
        .filter((l) => l.qty > 0)
    );

  const filtered = useMemo(() => {
    if (!menu) return [];
    const ql = q.trim().toLowerCase();
    return menu.categories
      .filter((c) => cat === "all" || c.id === cat)
      .map((c) => ({ ...c, items: c.items.filter((i) => !ql || i.name.toLowerCase().includes(ql)) }))
      .filter((c) => c.items.length > 0);
  }, [menu, q, cat]);

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  const submitLabel = addingTo
    ? `Send round ${addingTo.rounds + 1} →`
    : mode === "DINE_IN"
      ? "Open tab →"
      : "Charge →";

  /** Adding to a tab posts straight away; anything else needs the customer step. */
  const submit = async () => {
    if (!addingTo) {
      setCartOpen(false);
      return setCheckout(true);
    }
    setError(null);
    try {
      const r = await fetch(`/api/admin/counter/tabs/${addingTo.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: lines.map((l) => ({
            menuItemId: l.menuItemId,
            variantId: l.variantId,
            addOnIds: l.addOnIds,
            qty: l.qty,
          })),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setLines([]);
      setAddingTo(null);
      setCartOpen(false);
      loadTabs();
    } catch (e) {
      // Close the sheet: the error banner sits at the top of the page and would
      // otherwise be hidden behind it, so the failure would look like a no-op.
      setCartOpen(false);
      setError(e instanceof Error ? e.message : "Could not add to the tab");
    }
  };

  return (
    <>
      {/* Nothing in here may widen the page. The admin header is `sticky`,
          which pins it vertically only, so horizontal overflow slides the
          whole page — header included — sideways. The fixed cart bar and the
          modals sit outside this block.
          The bottom padding clears that bar; without it the last row of dishes
          sits underneath it and cannot be tapped. */}
      <div className={lines.length > 0 ? "pb-28 lg:pb-0" : undefined}>
      <div className="flex flex-wrap items-baseline gap-x-3 mb-3">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-maroon-700">Counter</h1>
        <p className="text-sm text-maroon-800/60">Take a walk-in or dine-in order</p>
      </div>

      {/* Which branch you are billing to must be impossible to misread. */}
      {branches.length > 1 && (
        <div
          className="flex gap-2 overflow-x-auto no-scrollbar pb-1 mb-3"
          role="group"
          aria-label="Branch"
        >
          {branches.map((b) => {
            const active = slug === b.slug;
            return (
              <button
                key={b.id}
                aria-pressed={active}
                onClick={() => {
                  if (b.slug === slug) return;
                  if (lines.length && !confirm("Switching branch clears the current order. Continue?")) return;
                  setLines([]);
                  setSlug(b.slug);
                }}
                className={`rounded-xl px-4 sm:px-5 py-2.5 sm:py-3 text-sm sm:text-[15px] font-bold whitespace-nowrap transition ${
                  active
                    ? "bg-maroon-600 text-cream-50 shadow-card"
                    : "bg-white text-maroon-700 border border-cream-300 hover:border-mustard-400 hover:bg-mustard-100"
                }`}
              >
                🏪 {b.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
              </button>
            );
          })}
        </div>
      )}
      {branches.length === 1 && (
        <p className="mb-3 inline-block rounded-full bg-maroon-50 px-3 py-1 text-sm font-bold text-maroon-700">
          🏪 Billing to {branches[0].name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
        </p>
      )}

      {/* Parcel bills at once; dine-in opens a tab billed when they leave. */}
      <div className="flex gap-2 mb-3" role="group" aria-label="Order kind">
        {([
          ["PARCEL", "🛍️ Parcel", "Bill now"],
          ["DINE_IN", "🍽️ Dine-in", "Open a table tab"],
        ] as const).map(([m, label, hint]) => (
          <button
            key={m}
            aria-pressed={mode === m}
            onClick={() => {
              if (mode === m) return;
              if (lines.length && !confirm("Switching clears the current order. Continue?")) return;
              setLines([]);
              setAddingTo(null);
              setMode(m);
            }}
            className={`flex-1 sm:flex-none rounded-xl px-3 sm:px-5 py-2.5 sm:py-3 text-left transition ${
              mode === m
                ? "bg-maroon-600 text-cream-50 shadow-card"
                : "bg-white text-maroon-700 border border-cream-300 hover:border-mustard-400 hover:bg-mustard-100"
            }`}
          >
            <span className="block text-sm sm:text-[15px] font-bold">{label}</span>
            <span className={`block text-xs ${mode === m ? "text-cream-50/75" : "text-maroon-800/50"}`}>
              {hint}
            </span>
          </button>
        ))}
      </div>

      {addingTo && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-mustard-400 bg-mustard-100 px-4 py-3">
          <span className="font-bold text-maroon-700">
            ➕ Adding round {addingTo.rounds + 1} to{" "}
            {addingTo.tableNo ? `Table ${addingTo.tableNo}` : addingTo.orderNumber}
          </span>
          <span className="text-sm text-maroon-800/70">
            ({addingTo.customer.name ?? "Guest"} · running {inr(addingTo.total)})
          </span>
          <button
            className="ml-auto underline text-sm font-semibold"
            onClick={() => {
              setAddingTo(null);
              setLines([]);
            }}
          >
            Cancel
          </button>
        </div>
      )}

      <ErrorBox message={error} />

      {mode === "DINE_IN" && !addingTo && (
        <OpenTabs
          tabs={tabs}
          onAdd={(t) => {
            setAddingTo(t);
            setLines([]);
          }}
          onSettle={(t) => setSettling(t)}
        />
      )}

      <div className="grid lg:grid-cols-3 gap-4 mt-2">
        {/* ---------------------------------------------------------- menu */}
        {/* min-w-0 is load-bearing. A grid item defaults to min-width:auto,
            i.e. it refuses to shrink below its min-content — and the category
            chip row's min-content is the full un-scrolled width of every chip
            (~1000px). Without this the column inflates to that width and drags
            the menu grid off the side of the screen. overflow-x-auto lets the
            chips scroll but does not shrink what they report as a minimum. */}
        <div className="lg:col-span-2 min-w-0">
          <input
            className="input"
            placeholder="Search the menu…"
            aria-label="Search the menu"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          {menu && (
            <div className="flex gap-2 overflow-x-auto no-scrollbar py-2">
              <button className={`chip ${cat === "all" ? "chip-active" : ""}`} onClick={() => setCat("all")}>
                All
              </button>
              {menu.categories.map((c) => (
                <button
                  key={c.id}
                  className={`chip ${cat === c.id ? "chip-active" : ""}`}
                  onClick={() => setCat(c.id)}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}

          {!menu ? (
            <Spinner label="Loading menu…" />
          ) : (
            filtered.map((c) => (
              <section key={c.id} className="mt-3">
                <h2 className="font-semibold text-maroon-700 mb-2">{c.name}</h2>
                {/* Two per row even on a phone: one dish per row turns a short
                    menu into a very long scroll between taps. */}
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-2">
                  {c.items.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => tap(it)}
                      disabled={!it.available}
                      // Tall enough to hit reliably on a tablet mid-service.
                      className="card card-hover p-3 sm:p-4 text-left min-h-[88px] sm:min-h-[92px] flex flex-col justify-between disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98]"
                    >
                      <span className="flex items-start gap-1.5 sm:gap-2">
                        <VegMark veg={it.veg} className="mt-0.5 sm:mt-1" />
                        <span className="font-semibold text-sm sm:text-[15px] leading-snug">{it.name}</span>
                      </span>
                      <span className="flex items-center justify-between gap-1 mt-2">
                        <span className="font-bold text-maroon-700 text-base sm:text-lg">{inr(it.price)}</span>
                        {(it.variants.length > 0 || it.addOns.length > 0) && (
                          <span className="rounded-full bg-cream-200 px-1.5 sm:px-2 py-0.5 text-[9px] sm:text-[10px] font-bold text-maroon-700">
                            OPTIONS
                          </span>
                        )}
                      </span>
                      {!it.available && (
                        <span className="block text-[11px] font-bold text-red-700 mt-1">Unavailable</span>
                      )}
                    </button>
                  ))}
                </div>
              </section>
            ))
          )}
        </div>

        {/* ------------------------------------------------- cart (desktop) */}
        <aside className="hidden lg:block lg:sticky lg:top-4 h-fit">
          <div className="card p-4">
            <h2 className="font-semibold mb-2">
              Current order {count > 0 && <span className="text-maroon-800/50">· {count} item{count > 1 ? "s" : ""}</span>}
            </h2>
            <CartPanel
              lines={lines}
              subtotal={subtotal}
              setQty={setQty}
              onClear={() => setLines([])}
              onSubmit={submit}
              submitLabel={submitLabel}
            />
          </div>
        </aside>
      </div>
      </div>

      {/* --------------------------------------------------- cart (phone) */}
      {/* On a phone the aside would sit below the whole menu, so the running
          total and the charge button are pinned instead — a tap on a dish is
          otherwise completely silent. */}
      {lines.length > 0 && (
        <div className="lg:hidden fixed inset-x-0 bottom-0 z-30 border-t border-cream-300 bg-white/95 backdrop-blur px-3 py-2.5 shadow-[0_-4px_16px_rgba(0,0,0,0.08)] pb-[max(0.625rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCartOpen(true)}
              className={`flex min-h-[52px] flex-1 items-center gap-2 rounded-xl border px-3 text-left transition ${
                bump ? "border-mustard-400 bg-mustard-100" : "border-cream-300 bg-cream-50"
              }`}
              aria-label={`Review order, ${count} items, subtotal ${inr(subtotal)}`}
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-maroon-600 text-sm font-bold text-cream-50">
                {count}
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold leading-tight text-maroon-700">{inr(subtotal)}</span>
                <span className="block text-[11px] font-semibold text-maroon-800/50">Tap to review</span>
              </span>
            </button>
            {/* `!` because .btn sets min-h-[44px] later in the cascade. */}
            <button onClick={submit} className="btn-primary !min-h-[52px] shrink-0 !px-4 !text-[15px]">
              {submitLabel}
            </button>
          </div>
        </div>
      )}

      {cartOpen && (
        <Modal open onClose={() => setCartOpen(false)} title={`Current order · ${count} item${count === 1 ? "" : "s"}`}>
          <CartPanel
            lines={lines}
            subtotal={subtotal}
            setQty={setQty}
            onClear={() => {
              setLines([]);
              setCartOpen(false);
            }}
            onSubmit={submit}
            submitLabel={submitLabel}
          />
        </Modal>
      )}

      {configuring && (
        <OptionsModal
          item={configuring}
          onClose={() => setConfiguring(null)}
          onAdd={(v, a) => {
            add(configuring, v, a);
            setConfiguring(null);
          }}
        />
      )}

      {checkout && menu && (
        <CheckoutModal
          branchId={menu.branch.id}
          lines={lines}
          mode={mode}
          onClose={() => setCheckout(false)}
          onDone={(orderId) => {
            setCheckout(false);
            setLines([]);
            if (mode === "DINE_IN") loadTabs();
            else router.push(`/admin/orders?highlight=${orderId}`);
          }}
        />
      )}

      {settling && (
        <SettleModal
          tab={settling}
          onClose={() => setSettling(null)}
          onDone={() => {
            setSettling(null);
            loadTabs();
          }}
        />
      )}
    </>
  );
}

/**
 * The cart body, shared by the desktop sidebar and the phone sheet so the two
 * can never drift apart.
 */
function CartPanel({
  lines,
  subtotal,
  setQty,
  onClear,
  onSubmit,
  submitLabel,
}: {
  lines: Line[];
  subtotal: number;
  setQty: (key: string, delta: number) => void;
  onClear: () => void;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <>
      {lines.length === 0 ? (
        <p className="text-sm text-maroon-800/50 py-6 text-center">Tap dishes to add them.</p>
      ) : (
        <ul className="divide-y divide-cream-200 text-sm max-h-[45vh] overflow-y-auto">
          {lines.map((l) => (
            <li key={l.key} className="py-2">
              <div className="flex justify-between gap-2">
                <span className="min-w-0">
                  <span className="font-medium">{l.name}</span>
                  {l.variantName && <span className="text-maroon-800/60"> ({l.variantName})</span>}
                  {l.addOnNames.length > 0 && (
                    <span className="block text-xs text-maroon-800/50">+ {l.addOnNames.join(", ")}</span>
                  )}
                </span>
                <span className="font-semibold shrink-0">{inr(l.unitPrice * l.qty)}</span>
              </div>
              <div className="flex items-center gap-1 mt-1.5">
                <button
                  onClick={() => setQty(l.key, -1)}
                  className="grid h-10 w-10 sm:h-9 sm:w-9 place-items-center rounded-lg border border-cream-300 text-xl font-bold text-maroon-700 hover:bg-maroon-50 active:scale-95"
                  aria-label={`One less ${l.name}`}
                >
                  −
                </button>
                <span className="w-10 sm:w-9 text-center text-lg font-bold" aria-live="polite">
                  {l.qty}
                </span>
                <button
                  onClick={() => setQty(l.key, 1)}
                  className="grid h-10 w-10 sm:h-9 sm:w-9 place-items-center rounded-lg border border-cream-300 text-xl font-bold text-maroon-700 hover:bg-maroon-50 active:scale-95"
                  aria-label={`One more ${l.name}`}
                >
                  +
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="border-t-2 border-cream-200 mt-3 pt-3 flex justify-between items-baseline">
        <span className="font-bold text-lg">Subtotal</span>
        <span className="font-bold text-2xl text-maroon-700">{inr(subtotal)}</span>
      </div>
      <p className="text-xs text-maroon-800/50 mt-1">
        Taxes and packaging are added by the server on the final bill.
      </p>

      <div className="grid grid-cols-3 gap-2 mt-4">
        <button
          onClick={onClear}
          disabled={lines.length === 0}
          className="btn-outline !text-red-700 !border-red-700"
        >
          Clear
        </button>
        <button
          onClick={onSubmit}
          disabled={lines.length === 0}
          className="btn-primary col-span-2 !py-4 !text-lg"
        >
          {submitLabel}
        </button>
      </div>
    </>
  );
}

function OptionsModal({
  item,
  onClose,
  onAdd,
}: {
  item: MenuItem;
  onClose: () => void;
  onAdd: (v: Variant | null, a: AddOn[]) => void;
}) {
  const [variantId, setVariantId] = useState<string | null>(
    (item.variants.find((v) => v.isDefault) ?? item.variants[0])?.id ?? null
  );
  const [addOnIds, setAddOnIds] = useState<Set<string>>(new Set());
  const variant = item.variants.find((v) => v.id === variantId) ?? null;
  const addOns = item.addOns.filter((a) => addOnIds.has(a.id));
  const price = item.price + (variant?.priceDelta ?? 0) + addOns.reduce((s, a) => s + a.price, 0);

  return (
    <Modal open onClose={onClose} title={item.name}>
      <div className="space-y-4">
        {item.variants.length > 0 && (
          <fieldset>
            <legend className="label">Portion</legend>
            <div className="flex flex-wrap gap-2">
              {item.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setVariantId(v.id)}
                  className={`chip ${variantId === v.id ? "chip-active" : ""}`}
                >
                  {v.name}
                  {v.priceDelta !== 0 && ` (${v.priceDelta > 0 ? "+" : ""}${inr(v.priceDelta)})`}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {item.addOns.length > 0 && (
          <fieldset>
            <legend className="label">Add-ons</legend>
            <div className="space-y-2">
              {item.addOns.map((a) => (
                <label key={a.id} className="flex items-center gap-3 cursor-pointer text-sm">
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
        <button onClick={() => onAdd(variant, addOns)} className="btn-primary w-full">
          Add · {inr(price)}
        </button>
      </div>
    </Modal>
  );
}

function CheckoutModal({
  branchId,
  lines,
  mode,
  onClose,
  onDone,
}: {
  branchId: string;
  lines: Line[];
  mode: "PARCEL" | "DINE_IN";
  onClose: () => void;
  onDone: (orderId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [picked, setPicked] = useState<CustomerHit | null>(null);
  const [name, setName] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "ONLINE">("CASH");
  const [paid, setPaid] = useState(true);
  const [instructions, setInstructions] = useState("");
  const [tableNo, setTableNo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounced so typing a 10-digit number is one request, not ten.
  const runSearch = useCallback((term: string) => {
    if (term.trim().length < 3) return setHits([]);
    fetch(`/api/admin/counter/customers?q=${encodeURIComponent(term.trim())}`)
      .then((r) => r.json())
      .then((d) => setHits(d.customers ?? []))
      .catch(() => setHits([]));
  }, []);

  useEffect(() => {
    const t = setTimeout(() => runSearch(search), 250);
    return () => clearTimeout(t);
  }, [search, runSearch]);

  // A complete number that we already know is not ambiguous — pick that
  // customer rather than making the cashier tap a list of one.
  useEffect(() => {
    if (picked || search.length !== 10) return;
    const exact = hits.find((h) => (h.phone ?? "").replace(/\D/g, "").endsWith(search));
    if (exact) setPicked(exact);
  }, [hits, search, picked]);

  const place = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/counter/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId,
          items: lines.map((l) => ({
            menuItemId: l.menuItemId,
            variantId: l.variantId,
            addOnIds: l.addOnIds,
            qty: l.qty,
          })),
          ...(picked
            ? { userId: picked.id }
            : { name: name.trim() || null, phone: search }),
          orderType: mode,
          tableNo: mode === "DINE_IN" ? tableNo.trim() || null : null,
          paymentMethod,
          paid,
          instructions: instructions.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      alert(
        mode === "DINE_IN"
          ? `Tab opened · ${d.orderNumber} · ${inr(d.total)} so far`
          : `Order ${d.orderNumber} placed · ${inr(d.total)}`
      );
      onDone(d.orderId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place the order");
      setBusy(false);
    }
  };

  // The number alone is enough to bill: a name is optional.
  const ready = picked !== null || search.length === 10;

  return (
    <Modal open onClose={onClose} title="Customer & payment" wide>
      <div className="space-y-4">
        {/* One box, not two. The cashier types the number; if we already know
            it the customer appears to be tapped, and if we do not, that same
            number is the new customer. Nothing else is required to bill. */}
        <div>
          <label className="label" htmlFor="c-search">Customer mobile</label>
          <div className="flex">
            <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-cream-300 bg-cream-100 text-sm font-semibold">
              +91
            </span>
            <input
              id="c-search"
              className="input !rounded-l-none"
              autoFocus
              inputMode="numeric"
              maxLength={10}
              placeholder="98XXXXXXXX"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value.replace(/\D/g, "").slice(0, 10));
                setPicked(null);
              }}
            />
          </div>
          {hits.length > 0 && !picked && (
            <ul className="mt-2 border border-cream-300 rounded-xl divide-y divide-cream-200 overflow-hidden">
              {hits.map((h) => (
                <li key={h.id}>
                  <button
                    onClick={() => {
                      setPicked(h);
                      setSearch((h.phone ?? "").replace(/^\+91/, ""));
                      setHits([]);
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-mustard-100 text-sm"
                  >
                    <span className="font-semibold">{h.name ?? "Unnamed"}</span>{" "}
                    <span className="text-maroon-800/60">{h.phone}</span>
                    <span className="block text-xs text-maroon-800/50">
                      {h.completedOrders} previous order{h.completedOrders === 1 ? "" : "s"}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <p className="mt-2 rounded-xl bg-leaf-50 border border-leaf-500/30 px-3 py-2 text-sm">
              ✓ <strong>{picked.name}</strong> · {picked.phone}
              <button
                className="underline ml-2"
                onClick={() => {
                  setPicked(null);
                  setSearch("");
                }}
              >
                change
              </button>
            </p>
          )}
        </div>

        {/* Only once the number is complete and unrecognised: a name is optional
            and never blocks the bill, but it is worth offering while they are
            standing there. */}
        {!picked && search.length === 10 && (
          <div className="border-t border-cream-200 pt-3">
            <label className="label" htmlFor="c-name">Name (optional)</label>
            <input
              id="c-name"
              className="input"
              maxLength={60}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="New customer — add a name if they give one"
            />
            <p className="text-xs text-maroon-800/50 mt-1">
              New number. Billing works without a name; saving one means they can be
              found next time, and their loyalty points build up either way.
            </p>
          </div>
        )}

        {mode === "DINE_IN" && (
          <div className="border-t border-cream-200 pt-3">
            <label className="label" htmlFor="c-table">Table number (optional)</label>
            <input
              id="c-table"
              className="input"
              maxLength={20}
              value={tableNo}
              onChange={(e) => setTableNo(e.target.value)}
              placeholder="e.g. 4"
            />
            <p className="text-xs text-maroon-800/50 mt-1">
              The tab stays open — bill it from “Open tables” when they leave.
            </p>
          </div>
        )}

        <div className={mode === "DINE_IN" ? "hidden" : "border-t border-cream-200 pt-3"}>
          <span className="label">Payment</span>
          <div className="flex gap-2">
            {(["CASH", "ONLINE"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={`chip ${paymentMethod === m ? "chip-active" : ""}`}
              >
                {m === "CASH" ? "💵 Cash" : "📱 UPI / Card"}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={paid} onChange={(e) => setPaid(e.target.checked)} />
            Payment collected now
          </label>
        </div>

        <div>
          <label className="label" htmlFor="c-notes">Note for the kitchen (optional)</label>
          <input id="c-notes" className="input" maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. table 4, less spicy" />
        </div>

        <ErrorBox message={error} />
        <button onClick={place} disabled={busy || !ready} className="btn-primary w-full !py-4">
          {busy ? "Placing…" : mode === "DINE_IN" ? "Open tab" : "Place order"}
        </button>
      </div>
    </Modal>
  );
}


export default function CounterPage() {
  return (
    <Suspense fallback={<Spinner label="Loading counter…" />}>
      <CounterInner />
    </Suspense>
  );
}

/** Open dine-in tabs for this branch: add another round, or settle and bill. */
function OpenTabs({
  tabs,
  onAdd,
  onSettle,
}: {
  tabs: OpenTab[] | null;
  onAdd: (t: OpenTab) => void;
  onSettle: (t: OpenTab) => void;
}) {
  if (tabs === null) return <Spinner label="Loading open tables…" />;
  if (tabs.length === 0)
    return (
      <p className="card p-4 text-sm text-maroon-800/60 mb-3">
        No open tables. Build an order below and press <strong>Open tab</strong> to start one.
      </p>
    );

  return (
    <section className="mb-4" aria-label="Open tables">
      <h2 className="font-semibold text-maroon-700 mb-2">
        Open tables <span className="text-maroon-800/50">· {tabs.length}</span>
      </h2>
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {tabs.map((t) => (
          <div key={t.id} className="card p-3 sm:p-4 border-l-4 border-l-mustard-400">
            <div className="flex items-start justify-between gap-2">
              <span className="font-bold text-lg">
                {t.tableNo ? `🪑 Table ${t.tableNo}` : `🍽️ ${t.orderNumber}`}
              </span>
              <span className="rounded-full bg-cream-200 px-2 py-0.5 text-xs font-bold whitespace-nowrap">
                {t.rounds} round{t.rounds > 1 ? "s" : ""}
              </span>
            </div>
            <p className="text-sm text-maroon-800/70 mt-0.5">
              {t.customer.name ?? "Guest"} · {t.itemCount} item{t.itemCount === 1 ? "" : "s"}
            </p>
            <p className="text-xs text-maroon-800/50 truncate mt-1">
              {t.items.map((i) => `${i.qty}×${i.name}`).join(", ")}
            </p>
            <p className="mt-2 text-2xl font-bold text-maroon-700">{inr(t.total)}</p>
            <div className="grid grid-cols-2 gap-2 mt-3">
              <button onClick={() => onAdd(t)} className="btn-secondary !min-h-[46px] !px-2">
                ➕ Add items
              </button>
              <button onClick={() => onSettle(t)} className="btn-primary !min-h-[46px] !px-2">
                💳 Bill
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Final bill for a dine-in tab. */
function SettleModal({
  tab,
  onClose,
  onDone,
}: {
  tab: OpenTab;
  onClose: () => void;
  onDone: () => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "ONLINE">("CASH");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const settle = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/counter/tabs/${tab.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentMethod }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not settle the tab");
      setBusy(false);
    }
  };

  // Grouping by round mirrors how the food actually arrived at the table.
  const rounds = [...new Set(tab.items.map((i) => i.round))].sort((a, b) => a - b);

  return (
    <Modal open onClose={onClose} title={tab.tableNo ? `Bill · Table ${tab.tableNo}` : `Bill · ${tab.orderNumber}`} wide>
      <div className="space-y-4">
        <p className="text-sm text-maroon-800/70">
          {tab.customer.name ?? "Guest"}
          {tab.customer.phone && ` · ${tab.customer.phone}`}
        </p>

        {rounds.map((r) => (
          <div key={r}>
            <p className="text-xs font-bold uppercase tracking-wider text-maroon-800/50 mb-1">
              Round {r}
            </p>
            <ul className="divide-y divide-cream-200 text-sm">
              {tab.items
                .filter((i) => i.round === r)
                .map((i) => (
                  <li key={i.id} className="py-1.5 flex justify-between gap-3">
                    <span>
                      {i.qty} × {i.name}
                      {i.variantName && <span className="text-maroon-800/60"> ({i.variantName})</span>}
                    </span>
                    <span className="font-medium shrink-0">{inr(i.lineTotal)}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}

        <div className="flex justify-between items-baseline border-t-2 border-cream-200 pt-3">
          <span className="font-bold text-lg">Total to pay</span>
          <span className="font-bold text-3xl text-maroon-700">{inr(tab.total)}</span>
        </div>
        <p className="text-xs text-maroon-800/50 -mt-2">Includes taxes and packaging.</p>

        <div>
          <span className="label">Paid by</span>
          <div className="flex gap-2">
            {(["CASH", "ONLINE"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={`chip ${paymentMethod === m ? "chip-active" : ""}`}
              >
                {m === "CASH" ? "💵 Cash" : "📱 UPI / Card"}
              </button>
            ))}
          </div>
        </div>

        <ErrorBox message={error} />
        <button onClick={settle} disabled={busy} className="btn-primary w-full !py-4 !text-lg">
          {busy ? "Settling…" : `Settle ${inr(tab.total)}`}
        </button>
      </div>
    </Modal>
  );
}
