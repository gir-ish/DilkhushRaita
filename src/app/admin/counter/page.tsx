"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ErrorBox, Modal, Spinner, VegMark } from "@/components/ui";
import { inr } from "@/lib/utils";
import { playTone } from "@/lib/sound";
import { KhataModal } from "@/components/admin/khata-modal";
import { COUNTER_MAX_QTY } from "@/lib/order-limits";
import { PrintSheet, type PrintableOrder } from "@/components/admin/print-sheet";

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

/**
 * An order already taken that the cashier is now adding more items to: a
 * table ordering another round, or a parcel whose customer asked for one more
 * thing while collecting it. Either way the items join that bill rather than
 * becoming a second order with its own number.
 */
interface AddingTo {
  kind: "TAB" | "PARCEL";
  id: string;
  orderNumber: string;
  /** "Table 4" for a tab, the order number for a parcel. */
  where: string;
  who: string | null;
  total: number;
  /** The round about to be sent; a parcel does not count rounds. */
  round: number | null;
  /** Already paid for, so the extra is owed now and nothing else is. */
  settled: boolean;
}
interface CustomerHit { id: string; name: string | null; phone: string | null; completedOrders: number; khataDue?: number }
interface OpenTab {
  id: string;
  branchId: string;
  orderNumber: string;
  tableNo: string | null;
  status: string;
  total: number;
  rounds: number;
  itemCount: number;
  customer: { name: string | null; phone: string | null };
  items: { id: string; name: string; variantName: string | null; qty: number; lineTotal: number; round: number }[];
}

interface Pickup {
  id: string;
  branchId: string;
  orderNumber: string;
  status: string;
  total: number;
  placedAt: string;
  paymentMethod: string;
  paymentStatus: string;
  customer: { name: string | null; phone: string | null };
  itemCount: number;
  items: { id: string; name: string; variantName: string | null; qty: number; lineTotal: number }[];
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
/** The add-target for an open table. */
function tabTarget(t: OpenTab): AddingTo {
  return {
    kind: "TAB",
    id: t.id,
    orderNumber: t.orderNumber,
    where: t.tableNo ? `Table ${t.tableNo}` : t.orderNumber,
    who: t.customer.name,
    total: t.total,
    round: t.rounds + 1,
    settled: false,
  };
}

/** The add-target for a parcel still waiting to be handed over. */
function parcelTarget(p: Pickup): AddingTo {
  return {
    kind: "PARCEL",
    id: p.id,
    orderNumber: p.orderNumber,
    where: "🛍️ " + p.orderNumber,
    who: p.customer.name,
    total: p.total,
    round: null,
    // Paid for already: the new items are the only thing still owed.
    settled: p.paymentStatus === "PAID",
  };
}

function CounterInner() {
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
  // Parcels ordered and not yet handed over, and the one being collected.
  const [pickups, setPickups] = useState<Pickup[] | null>(null);
  const [collecting, setCollecting] = useState<Pickup | null>(null);
  // When set, the cart is being added to this existing tab rather than
  // starting a new order.
  const [addingTo, setAddingTo] = useState<AddingTo | null>(null);
  // How the extra is paid when items are added to a parcel already settled.
  const [extraMethod, setExtraMethod] = useState<"CASH" | "ONLINE">("CASH");
  const [settling, setSettling] = useState<OpenTab | null>(null);
  // "Khata" at the counter: someone has come in to pay what they owe.
  const [khataOpen, setKhataOpen] = useState(false);
  // The number of the order just taken, kept in front of the cashier: it is
  // what they call out, write on the bag, and read back on the phone.
  const [lastPlaced, setLastPlaced] = useState<{ orderId: string; orderNumber: string; total: number; kind: string } | null>(null);
  // The bill being looked at or printed. Fetched one order at a time: the
  // counter knows the id of what it just took and nothing else.
  const [billing, setBilling] = useState<PrintableOrder | null>(null);
  /*
   * Whether the waiting lists are open.
   *
   * On a busy evening a dozen parcels push the menu off the bottom of the
   * screen, and the cashier scrolls past them to take every new order. Folding
   * them away leaves one line, and the counts on the Parcel and Dine-in
   * buttons still say what is waiting. The choice is remembered on this
   * device, so it is made once and not once per order.
   */
  const [listsOpen, setListsOpen] = useState(true);

  useEffect(() => {
    try {
      setListsOpen(localStorage.getItem("dk_counter_lists") !== "closed");
    } catch {
      // Private window, blocked storage: the lists just stay open.
    }
  }, []);

  const toggleLists = useCallback(() => {
    setListsOpen((open) => {
      try {
        localStorage.setItem("dk_counter_lists", open ? "closed" : "open");
      } catch {
        // Not worth an error; it simply will not be remembered.
      }
      return !open;
    });
  }, []);
  // Phone only: the cart lives in a sheet behind the bottom bar.
  const [cartOpen, setCartOpen] = useState(false);
  // Brief flash on the bottom bar so a tap is visibly acknowledged when the
  // cart itself is off-screen.
  const [bump, setBump] = useState(false);

  const branchId = menu?.branch.id ?? null;

  // Every branch the user can see, so each branch's button can say what is
  // waiting there; the screen itself shows the branch in front of them.
  const loadTabs = useCallback(() => {
    fetch("/api/admin/counter/tabs")
      .then((r) => (r.ok ? r.json() : { tabs: [] }))
      .then((d) => setTabs(d.tabs ?? []))
      .catch(() => setTabs([]));
  }, []);

  useEffect(loadTabs, [loadTabs]);

  const loadPickups = useCallback(() => {
    fetch("/api/admin/counter/pickups")
      .then((r) => (r.ok ? r.json() : { pickups: [] }))
      .then((d) => setPickups(d.pickups ?? []))
      .catch(() => setPickups([]));
  }, []);
  useEffect(() => {
    loadPickups();
    // The kitchen moves parcels along from its own screen; keep up with it.
    const t = setInterval(loadPickups, 20_000);
    return () => clearInterval(t);
  }, [loadPickups]);

  // Deep link from Orders -> "Add items" on an open tab.
  const wantedTab = params.get("tab");
  useEffect(() => {
    if (!wantedTab || !tabs) return;
    const t = tabs.find((x) => x.id === wantedTab);
    if (t) {
      setMode("DINE_IN");
      setAddingTo(tabTarget(t));
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

  /**
   * A count typed straight in — 218 rotis is a lot of tapping.
   *
   * Zero (or an empty box) takes the line off the order, the same as tapping
   * "−" down to nothing. The ceiling is the counter's own, which is not the
   * website's: see src/lib/order-limits.ts.
   */
  const setQtyExact = (key: string, qty: number) =>
    setLines((cur) =>
      cur
        .map((l) => (l.key === key ? { ...l, qty: Math.min(Math.max(Math.floor(qty), 0), COUNTER_MAX_QTY) } : l))
        .filter((l) => l.qty > 0)
    );

  /**
   * What is still open, counted per branch: tables mid-meal and parcels not
   * yet handed over. On the buttons it answers "is anything waiting?" — at
   * this branch, and at the other one — without switching screens.
   */
  const openByBranch = useMemo(() => {
    const out: Record<string, number> = {};
    for (const t of tabs ?? []) out[t.branchId] = (out[t.branchId] ?? 0) + 1;
    for (const p of pickups ?? []) out[p.branchId] = (out[p.branchId] ?? 0) + 1;
    return out;
  }, [tabs, pickups]);
  const branchTabs = useMemo(() => (tabs ?? []).filter((t) => t.branchId === branchId), [tabs, branchId]);
  const branchPickups = useMemo(() => (pickups ?? []).filter((p) => p.branchId === branchId), [pickups, branchId]);

  const openBill = useCallback(async (orderId: string) => {
    try {
      const r = await fetch(`/api/admin/orders/${orderId}`);
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setBilling(d.order);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the bill");
    }
  }, []);

  /** Whichever way the order was taken — sidebar or sheet — this follows. */
  const afterPlaced = useCallback(
    (
      placed: { orderId: string; orderNumber: string; total: number; kind: string },
      print: boolean
    ) => {
      setCheckout(false);
      setCartOpen(false);
      setLines([]);
      setLastPlaced(placed);
      // Nobody leaves the counter: the next customer is already waiting, and a
      // counter order is accepted the moment it is taken, so there is nothing
      // to go and approve on the queue.
      if (mode === "DINE_IN") loadTabs();
      else loadPickups();
      if (print) openBill(placed.orderId);
    },
    [mode, loadTabs, loadPickups, openBill]
  );

  const filtered = useMemo(() => {
    if (!menu) return [];
    const ql = q.trim().toLowerCase();
    return menu.categories
      .filter((c) => cat === "all" || c.id === cat)
      .map((c) => ({
        ...c,
        // Only what this branch can actually serve. A dish switched off here,
        // sold out, or outside its serving window is not on the counter's menu
        // at all — showing it greyed out just gives the cashier something to
        // hunt past while a customer waits. The customer-facing menu still
        // lists them, because "we have it, not right now" is worth knowing
        // there; at the till it is only noise.
        items: c.items.filter((i) => i.available && (!ql || i.name.toLowerCase().includes(ql))),
      }))
      .filter((c) => c.items.length > 0);
  }, [menu, q, cat]);

  const subtotal = lines.reduce((s, l) => s + l.unitPrice * l.qty, 0);
  const count = lines.reduce((s, l) => s + l.qty, 0);

  const submitLabel = addingTo
    ? addingTo.round
      ? `Send round ${addingTo.round} →`
      : `Add to ${addingTo.orderNumber} →`
    : mode === "DINE_IN"
      ? "Open tab →"
      : "Charge →";

  /**
   * Adding to an order that already exists posts straight away; a new one
   * needs the customer and payment step first.
   */
  const submit = async () => {
    if (!addingTo) {
      setCartOpen(false);
      return setCheckout(true);
    }
    const tab = addingTo.kind === "TAB";
    setError(null);
    try {
      const r = await fetch(
        tab ? `/api/admin/counter/tabs/${addingTo.id}` : `/api/admin/counter/pickups/${addingTo.id}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: lines.map((l) => ({
              menuItemId: l.menuItemId,
              variantId: l.variantId,
              addOnIds: l.addOnIds,
              qty: l.qty,
            })),
            // Paid already: only the new items are charged, and this is how.
            ...(!tab && addingTo.settled ? { extraPayment: extraMethod } : {}),
          }),
        }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      playTone("success");
      setLines([]);
      setAddingTo(null);
      setCartOpen(false);
      if (tab) loadTabs();
      else {
        loadPickups();
        // The bill has changed, so say what it is now and what was taken for
        // the extra.
        setLastPlaced({
          orderId: addingTo.id,
          orderNumber: d.orderNumber ?? addingTo.orderNumber,
          total: d.total ?? addingTo.total,
          kind: addingTo.settled ? `${inr(d.extra ?? 0)} extra taken` : "Items added",
        });
      }
    } catch (e) {
      // Close the sheet: the error banner sits at the top of the page and would
      // otherwise be hidden behind it, so the failure would look like a no-op.
      playTone("error");
      setCartOpen(false);
      setError(
        e instanceof Error
          ? e.message
          : tab
            ? "Could not add to the tab"
            : "Could not add to the parcel"
      );
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
                <span className="flex items-center justify-center gap-2">
                  🏪 {b.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
                  {openByBranch[b.id] > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                        active ? "bg-cream-50/25 text-cream-50" : "bg-cream-200 text-maroon-700"
                      }`}
                    >
                      {openByBranch[b.id]}
                    </span>
                  )}
                </span>
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
      <div className="flex gap-2 mb-3">
      <div className="flex gap-2 flex-1" role="group" aria-label="Order kind">
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
            <span className="flex items-center gap-2 text-sm sm:text-[15px] font-bold">
              {label}
              {(m === "PARCEL" ? branchPickups.length : branchTabs.length) > 0 && (
                <span
                  className={`rounded-full px-2 py-0.5 text-xs font-bold ${
                    mode === m ? "bg-cream-50/25 text-cream-50" : "bg-cream-200 text-maroon-700"
                  }`}
                >
                  {m === "PARCEL" ? branchPickups.length : branchTabs.length}
                </span>
              )}
            </span>
            <span className={`block text-xs ${mode === m ? "text-cream-50/75" : "text-maroon-800/50"}`}>
              {hint}
            </span>
          </button>
        ))}
      </div>
        <button
          onClick={() => setKhataOpen(true)}
          className="rounded-xl px-3 sm:px-5 py-2.5 sm:py-3 text-left bg-white text-maroon-700 border border-cream-300 hover:border-mustard-400 hover:bg-mustard-100 transition"
        >
          <span className="block text-sm sm:text-[15px] font-bold">📒 Khata</span>
          <span className="block text-xs text-maroon-800/50">Receive a payment</span>
        </button>
      </div>

      {addingTo && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-mustard-400 bg-mustard-100 px-4 py-3">
          <span className="font-bold text-maroon-700">
            ➕ {addingTo.round ? `Adding round ${addingTo.round} to` : "Adding items to"}{" "}
            {addingTo.where}
          </span>
          <span className="rounded-lg bg-white/70 px-2 py-0.5 font-mono text-sm font-bold text-maroon-700">
            {addingTo.orderNumber}
          </span>
          <span className="text-sm text-maroon-800/70">
            ({addingTo.who ?? "Guest"} · {addingTo.settled ? "paid" : "running"} {inr(addingTo.total)})
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
          {/* Paid for already, so the customer owes the new items and nothing
              else. The cashier says here how that difference is coming in. */}
          {addingTo.settled && (
            <div className="flex w-full flex-wrap items-center gap-2 border-t border-mustard-400/60 pt-2">
              <span className="text-sm font-semibold text-maroon-800/70">
                Already paid — take only the new items, by
              </span>
              {(["CASH", "ONLINE"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setExtraMethod(m)}
                  className={`chip ${extraMethod === m ? "chip-active" : ""}`}
                >
                  {m === "CASH" ? "💵 Cash" : "📱 UPI / Card"}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <ErrorBox message={error} />

      {/* Right at the top: the number just given out. The cashier reads it
          back to the customer and writes it on the bag. */}
      {lastPlaced && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border-2 border-leaf-500/40 bg-leaf-50 px-4 py-3">
          <span className="font-mono text-2xl font-bold text-maroon-700">{lastPlaced.orderNumber}</span>
          <span className="text-sm font-semibold text-leaf-600">{lastPlaced.kind} · {inr(lastPlaced.total)}</span>
          <button onClick={() => openBill(lastPlaced.orderId)} className="btn-secondary !min-h-[40px] !px-3 ml-auto">
            🧾 Bill / print
          </button>
          <button className="underline text-sm font-semibold" onClick={() => setLastPlaced(null)}>
            Dismiss
          </button>
        </div>
      )}

      {mode === "PARCEL" && !addingTo && (
        <WaitingParcels
          pickups={branchPickups}
          onCollect={(p) => setCollecting(p)}
          onBill={openBill}
          open={listsOpen}
          onToggle={toggleLists}
        />
      )}

      {mode === "DINE_IN" && !addingTo && (
        <OpenTabs
          tabs={branchTabs}
          onBill={openBill}
          open={listsOpen}
          onToggle={toggleLists}
          onAdd={(t) => {
            setAddingTo(tabTarget(t));
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
              setQtyExact={setQtyExact}
              onClear={() => setLines([])}
              onSubmit={submit}
              submitLabel={submitLabel}
              /* On a laptop the payment step is right below, so there is
                 nothing to charge through to. */
              showSubmit={!!addingTo}
            />
            {!addingTo && menu && lines.length > 0 && (
              <div className="mt-4 border-t-2 border-cream-200 pt-4">
                <CheckoutForm
                  branchId={menu.branch.id}
                  lines={lines}
                  mode={mode}
                  onDone={(_id, _payLater, placed, print) => afterPlaced(placed, print)}
                />
              </div>
            )}
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
            setQtyExact={setQtyExact}
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
          onDone={(_id, _payLater, placed, print) => afterPlaced(placed, print)}
        />
      )}

      {khataOpen && <KhataFinder onClose={() => setKhataOpen(false)} />}

      {collecting && (
        <CollectModal
          parcel={collecting}
          onClose={() => setCollecting(null)}
          onAddItems={() => {
            setAddingTo(parcelTarget(collecting));
            setLines([]);
            setCollecting(null);
          }}
          onDone={(settled) => {
            setCollecting(null);
            loadPickups();
            setLastPlaced({ ...settled, kind: "Handed over" });
          }}
        />
      )}

      {settling && (
        <SettleModal
          tab={settling}
          onClose={() => setSettling(null)}
          onDone={(settled) => {
            setSettling(null);
            loadTabs();
            setLastPlaced({ ...settled, kind: "Table settled" });
          }}
        />
      )}

      {/* The bill and the kitchen ticket, both printable — the same sheet the
          order queue prints, so one order cannot come out two ways. */}
      {billing && <PrintSheet order={billing} onClose={() => setBilling(null)} />}
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
  setQtyExact,
  onClear,
  onSubmit,
  submitLabel,
  showSubmit = true,
}: {
  lines: Line[];
  subtotal: number;
  setQty: (key: string, delta: number) => void;
  setQtyExact: (key: string, qty: number) => void;
  onClear: () => void;
  onSubmit: () => void;
  submitLabel: string;
  showSubmit?: boolean;
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
                {/* Typed in for a big number, tapped for one or two. */}
                <input
                  className="w-16 sm:w-14 h-10 sm:h-9 rounded-lg border border-cream-300 bg-white text-center text-lg font-bold text-maroon-700 focus:outline-none focus:ring-2 focus:ring-mustard-400"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={COUNTER_MAX_QTY}
                  value={l.qty}
                  onChange={(e) => setQtyExact(l.key, +e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  aria-label={`How many ${l.name}`}
                />
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

      <div className={`grid gap-2 mt-4 ${showSubmit ? "grid-cols-3" : "grid-cols-1"}`}>
        <button
          onClick={onClear}
          disabled={lines.length === 0}
          className="btn-outline !text-red-700 !border-red-700"
        >
          Clear
        </button>
        {showSubmit && (
          <button
            onClick={onSubmit}
            disabled={lines.length === 0}
            className="btn-primary col-span-2 !py-4 !text-lg"
          >
            {submitLabel}
          </button>
        )}
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

/**
 * Who is paying, and how — the last step before an order exists.
 *
 * On a laptop this sits in the cart itself, under the items, so taking an
 * order is one screen and one button; on a phone there is no room beside the
 * menu, so the same form is shown in a sheet. Hence a plain form here and a
 * modal around it below, rather than one component that is always a dialog.
 */
function CheckoutForm({
  branchId,
  lines,
  mode,
  onDone,
  autoFocusPhone = false,
}: {
  branchId: string;
  lines: Line[];
  mode: "PARCEL" | "DINE_IN";
  autoFocusPhone?: boolean;
  onDone: (
    orderId: string,
    payLater: boolean,
    placed: { orderId: string; orderNumber: string; total: number; kind: string },
    print: boolean
  ) => void;
}) {
  const [search, setSearch] = useState("");
  const [hits, setHits] = useState<CustomerHit[]>([]);
  const [picked, setPicked] = useState<CustomerHit | null>(null);
  const [name, setName] = useState("");
  /*
   * A guest unless a number is typed.
   *
   * Most people at the counter want their food, not an account, and asking
   * every one of them for a number is what actually slows the queue. The box
   * is still right there: the first digit turns the bill into that customer's,
   * and emptying it goes back to a guest.
   */
  const [guest, setGuest] = useState(true);
  // LATER: the customer waits for the parcel and pays when they collect it.
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "ONLINE" | "KHATA" | "LATER">("CASH");
  const payLater = paymentMethod === "LATER";
  // Khata: anything paid towards the bill now; the rest goes on the account.
  const [paidNow, setPaidNow] = useState("");
  const [paidNowMethod, setPaidNowMethod] = useState<PayMethod>("CASH");
  const [instructions, setInstructions] = useState("");
  const [tableNo, setTableNo] = useState("");
  // A discount the counter gives by hand, off the food before tax.
  const [discountType, setDiscountType] = useState<DiscountType>("FLAT");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
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

  const place = async (print: boolean) => {
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
          ...(guest
            ? { guest: true }
            : picked
              ? { userId: picked.id }
              : { name: name.trim() || null, phone: search }),
          orderType: mode,
          tableNo: mode === "DINE_IN" ? tableNo.trim() || null : null,
          paymentMethod: payLater ? "CASH" : paymentMethod,
          paid: !payLater,
          ...(paymentMethod === "KHATA" ? { paidNow: +paidNow || 0, paidNowMethod } : {}),
          ...(mode === "PARCEL" && +discountValue > 0
            ? { discount: { type: discountType, value: +discountValue, reason: discountReason.trim() || null } }
            : {}),
          instructions: instructions.trim() || null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      playTone("success");
      /*
       * What just happened, for the banner across the top of the counter.
       * This used to be an alert(): a blocking dialog between the cashier and
       * the next customer, dismissed without being read. The banner says the
       * same thing, keeps the order number on screen, and has the bill on it.
       */
      const kind =
        mode === "DINE_IN"
          ? "Table open"
          : +discountValue > 0 && d.discount > 0
            ? `Paid · ${inr(d.discount)} off`
            : paymentMethod === "KHATA"
              ? `${inr(Math.max(d.total - (+paidNow || 0), 0))} on khata`
              : payLater
                ? "To collect"
                : "Paid";
      onDone(
        d.orderId,
        mode !== "DINE_IN" && payLater,
        { orderId: d.orderId, orderNumber: d.orderNumber, total: d.total, kind },
        print
      );
    } catch (e) {
      playTone("error");
      setError(e instanceof Error ? e.message : "Could not place the order");
      setBusy(false);
    }
  };

  // The number alone is enough to bill: a name is optional. A guest needs
  // neither — that is the point of them.
  const ready = guest || picked !== null || search.length === 10;

  return (
      <div className="space-y-4">
        {/* One box, not two. The cashier types the number; if we already know
            it the customer appears to be tapped, and if we do not, that same
            number is the new customer. Nothing else is required to bill. */}
        <div>
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <label className="label !mb-0" htmlFor="c-search">Customer mobile</label>
            {/* The queue behind them is the reason this exists: a walk-in who
                will not give a number must not be able to hold up the till. */}
            <button
              type="button"
              aria-pressed={guest}
              onClick={() => {
                setGuest(true);
                setPicked(null);
                setSearch("");
                setName("");
                setHits([]);
                setPaymentMethod((m) => (m === "KHATA" ? "CASH" : m));
              }}
              className={`chip ${guest ? "chip-active" : ""}`}
            >
              🚶 Guest — no number
            </button>
          </div>
          <div className="flex mt-1.5">
            <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-cream-300 bg-cream-100 text-sm font-semibold">
              +91
            </span>
            <input
              id="c-search"
              className="input !rounded-l-none"
              autoFocus={autoFocusPhone}
              inputMode="numeric"
              maxLength={10}
              placeholder={guest ? "Guest — tap to add a number" : "98XXXXXXXX"}
              value={search}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                setSearch(digits);
                setPicked(null);
                // The box decides: a number in it is a customer, an empty one
                // is a guest. Nothing else has to be tapped either way.
                setGuest(digits.length === 0);
              }}
            />
          </div>
          {guest && (
            <p className="mt-1.5 text-xs text-maroon-800/60">
              No number — billed as <strong>Guest</strong>. No points, no SMS, and it cannot go on
              khata. Start typing a number to bill a customer instead.
            </p>
          )}
          {!guest && hits.length > 0 && !picked && (
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
                      {(h.khataDue ?? 0) > 0 && <span className="text-red-700 font-semibold"> · khata due {inr(h.khataDue!)}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {picked && (
            <p className="mt-2 rounded-xl bg-leaf-50 border border-leaf-500/30 px-3 py-2 text-sm">
              ✓ <strong>{picked.name}</strong> · {picked.phone}
              {(picked.khataDue ?? 0) > 0 && (
                <span className="ml-2 rounded-full bg-red-100 text-red-700 px-2 py-0.5 text-xs font-bold">
                  📒 Khata due {inr(picked.khataDue!)}
                </span>
              )}
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
        {!guest && !picked && search.length === 10 && (
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
          <div className="flex flex-wrap gap-2">
            {(["CASH", "ONLINE", "KHATA", "LATER"] as const)
              .filter((m) => !(guest && m === "KHATA"))
              .map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={`chip ${paymentMethod === m ? "chip-active" : ""}`}
              >
                {m === "CASH" ? "💵 Cash" : m === "ONLINE" ? "📱 UPI / Card" : m === "KHATA" ? "📒 Khata (pay later)" : "⏳ Pay at pickup"}
              </button>
            ))}
          </div>
          {payLater && (
            <p className="mt-2 text-xs text-maroon-800/60">
              The parcel waits under <strong>Parcels waiting</strong>. When they collect it, tap it and take
              cash, UPI or card — or put it on their khata.
            </p>
          )}
          {paymentMethod === "KHATA" && (
            <KhataPaidNow
              who={picked?.name ?? (name.trim() || null)}
              due={picked?.khataDue ?? 0}
              paidNow={paidNow}
              setPaidNow={setPaidNow}
              method={paidNowMethod}
              setMethod={setPaidNowMethod}
            />
          )}
        </div>

        {/* A table's discount is given when it is billed, not when the tab
            opens — otherwise it would be entered twice and only the later one
            would count. */}
        {mode === "PARCEL" && (
        <DiscountBox
          subtotal={lines.reduce((n, l) => n + l.unitPrice * l.qty, 0)}
          type={discountType}
          setType={setDiscountType}
          value={discountValue}
          setValue={setDiscountValue}
          reason={discountReason}
          setReason={setDiscountReason}
        />
        )}

        <div>
          <label className="label" htmlFor="c-notes">Note for the kitchen (optional)</label>
          <input id="c-notes" className="input" maxLength={500} value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="e.g. table 4, less spicy" />
        </div>

        <ErrorBox message={error} />
        {/* Two ways out, because a parcel usually wants a bill in the bag and
            a table does not. "Place & print" saves going and finding the order
            again afterwards just to print it. */}
        <div className="grid gap-2">
          <button onClick={() => place(false)} disabled={busy || !ready} className="btn-primary w-full !py-4">
            {busy ? "Placing…" : mode === "DINE_IN" ? "Open tab" : paymentMethod === "KHATA" ? "Place order on khata" : "Place order"}
          </button>
          <button
            onClick={() => place(true)}
            disabled={busy || !ready}
            className="btn-secondary w-full !min-h-[46px]"
          >
            🧾 {mode === "DINE_IN" ? "Open tab & print" : "Place & print bill"}
          </button>
        </div>
      </div>
  );
}

/** The same form in a sheet, for a phone, where the cart has no room beside it. */
function CheckoutModal({
  onClose,
  ...rest
}: {
  branchId: string;
  lines: Line[];
  mode: "PARCEL" | "DINE_IN";
  onClose: () => void;
  onDone: (
    orderId: string,
    payLater: boolean,
    placed: { orderId: string; orderNumber: string; total: number; kind: string },
    print: boolean
  ) => void;
}) {
  return (
    <Modal open onClose={onClose} title="Customer & payment" wide>
      <CheckoutForm {...rest} autoFocusPhone />
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

/**
 * The heading of a waiting list, with the control that folds it away.
 *
 * Closed, it is one line: ☰, what is waiting, and how many — enough to know
 * there is something there, small enough to leave the menu on screen.
 */
function ListHead({
  title,
  count,
  open,
  onToggle,
  closedLabel,
}: {
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  closedLabel: string;
}) {
  if (!open)
    return (
      <button
        onClick={onToggle}
        aria-expanded={false}
        className="mb-3 flex w-full items-center gap-2 rounded-xl border border-cream-300 bg-white px-3 py-2.5 text-left font-semibold text-maroon-700 hover:border-mustard-400 hover:bg-mustard-100"
      >
        <span aria-hidden className="text-lg leading-none">☰</span>
        {closedLabel}
        <span className="rounded-full bg-cream-200 px-2 py-0.5 text-xs font-bold">{count}</span>
        <span className="ml-auto text-sm underline">Show</span>
      </button>
    );

  return (
    <div className="mb-2 flex items-center gap-2">
      <h2 className="font-semibold text-maroon-700">
        {title} <span className="text-maroon-800/50">· {count}</span>
      </h2>
      <button
        onClick={onToggle}
        aria-expanded
        title="Hide this list"
        className="ml-auto inline-flex items-center gap-1.5 rounded-xl border border-cream-300 bg-white px-3 py-1.5 text-sm font-semibold text-maroon-700 hover:border-mustard-400 hover:bg-mustard-100"
      >
        <span aria-hidden>✕</span> Close
      </button>
    </div>
  );
}

/** Open dine-in tabs for this branch: add another round, or settle and bill. */
function OpenTabs({
  tabs,
  onAdd,
  onSettle,
  onBill,
  open,
  onToggle,
}: {
  tabs: OpenTab[] | null;
  onAdd: (t: OpenTab) => void;
  onSettle: (t: OpenTab) => void;
  /** Print what the table has run up so far — it is not settled by looking. */
  onBill: (orderId: string) => void;
  open: boolean;
  onToggle: () => void;
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
      <ListHead
        title="Open tables"
        closedLabel="Open tables"
        count={tabs.length}
        open={open}
        onToggle={onToggle}
      />
      {open && (
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {tabs.map((t) => (
          <div key={t.id} className="card p-3 sm:p-4 border-l-4 border-l-mustard-400">
            <div className="flex items-start justify-between gap-2">
              <span className="font-bold text-lg">
                {t.tableNo ? `🪑 Table ${t.tableNo}` : "🍽️"}
                <span className="block font-mono text-xs font-bold text-maroon-800/60">{t.orderNumber}</span>
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
                💳 Bill & settle
              </button>
            </div>
            <button onClick={() => onBill(t.id)} className="btn-ghost w-full !min-h-[40px] mt-2 text-sm">
              🧾 Print running bill
            </button>
          </div>
        ))}
      </div>
      )}
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
  /** What was actually settled — the discount is applied by the server. */
  onDone: (settled: { orderId: string; orderNumber: string; total: number }) => void;
}) {
  const [paymentMethod, setPaymentMethod] = useState<"CASH" | "ONLINE" | "KHATA">("CASH");
  const [paidNow, setPaidNow] = useState("");
  const [paidNowMethod, setPaidNowMethod] = useState<PayMethod>("CASH");
  const [discountType, setDiscountType] = useState<DiscountType>("FLAT");
  const [discountValue, setDiscountValue] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const khata = paymentMethod === "KHATA";
  // The bill on screen, less any discount being given: the tax on it is
  // recomputed by the server, so this is what is shown, not what is charged.
  const itemsTotal = tab.items.reduce((n, i) => n + i.lineTotal, 0);
  const off = discountAmount(discountType, discountValue, itemsTotal);
  const payable = Math.max(tab.total - off, 0);
  const toKhata = Math.max(payable - (+paidNow || 0), 0);

  const settle = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/counter/tabs/${tab.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod,
          ...(khata ? { paidNow: +paidNow || 0, paidNowMethod } : {}),
          ...(off > 0 ? { discount: { type: discountType, value: +discountValue, reason: discountReason.trim() || null } } : {}),
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      playTone("success");
      onDone({ orderId: tab.id, orderNumber: d.orderNumber ?? tab.orderNumber, total: d.total ?? tab.total });
    } catch (e) {
      playTone("error");
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
          <span className="font-bold text-3xl text-maroon-700">
            {off > 0 && <span className="text-base font-normal text-maroon-800/40 line-through mr-2">{inr(tab.total)}</span>}
            {inr(payable)}
          </span>
        </div>
        <p className="text-xs text-maroon-800/50 -mt-2">
          Includes taxes and packaging.{off > 0 && ` Discount ${inr(off)} applied — tax is recalculated on saving.`}
        </p>

        <DiscountBox
          subtotal={itemsTotal}
          type={discountType}
          setType={setDiscountType}
          value={discountValue}
          setValue={setDiscountValue}
          reason={discountReason}
          setReason={setDiscountReason}
        />

        <div>
          <span className="label">Paid by</span>
          <div className="flex flex-wrap gap-2">
            {(["CASH", "ONLINE", "KHATA"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setPaymentMethod(m)}
                className={`chip ${paymentMethod === m ? "chip-active" : ""}`}
              >
                {m === "CASH" ? "💵 Cash" : m === "ONLINE" ? "📱 UPI / Card" : "📒 Khata (pay later)"}
              </button>
            ))}
          </div>
          {khata && (
            <KhataPaidNow
              who={tab.customer.name}
              due={null}
              paidNow={paidNow}
              setPaidNow={setPaidNow}
              method={paidNowMethod}
              setMethod={setPaidNowMethod}
              max={payable}
            />
          )}
        </div>

        <ErrorBox message={error} />
        <button onClick={settle} disabled={busy || (khata && +paidNow > payable)} className="btn-primary w-full !py-4 !text-lg">
          {busy
            ? "Settling…"
            : khata
              ? +paidNow > 0
                ? `Take ${inr(+paidNow)} · ${inr(toKhata)} on khata`
                : `Put ${inr(payable)} on khata`
              : `Settle ${inr(payable)}`}
        </button>
      </div>
    </Modal>
  );
}

type PayMethod = "CASH" | "UPI" | "CARD";

/**
 * Under "Khata": whose account the bill goes on, what they already owe, and
 * anything they pay towards it now — the rest waits on the khata.
 */
function KhataPaidNow({
  who, due, paidNow, setPaidNow, method, setMethod, max,
}: {
  who: string | null;
  due: number | null;
  paidNow: string;
  setPaidNow: (v: string) => void;
  method: PayMethod;
  setMethod: (m: PayMethod) => void;
  max?: number;
}) {
  return (
    <div className="mt-3 rounded-xl border border-mustard-400 bg-mustard-100 p-3 space-y-2 text-sm">
      <p>
        The bill goes on <strong>{who ?? "this customer"}</strong>&apos;s khata — they pay later.
        {due != null && due > 0 && <> Already due: <strong className="text-red-700">{inr(due)}</strong>.</>}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor="k-now" className="font-semibold">Paying some now?</label>
        <span className="font-bold">₹</span>
        <input
          id="k-now"
          className="input !w-28 !min-h-[36px]"
          type="number"
          inputMode="decimal"
          min={0}
          max={max}
          placeholder="0"
          value={paidNow}
          onChange={(e) => setPaidNow(e.target.value)}
        />
        {+paidNow > 0 &&
          (["CASH", "UPI", "CARD"] as const).map((m) => (
            <button key={m} onClick={() => setMethod(m)} className={`chip ${method === m ? "chip-active" : ""}`}>
              {m === "CASH" ? "💵 Cash" : m === "UPI" ? "📱 UPI" : "💳 Card"}
            </button>
          ))}
      </div>
      {max != null && +paidNow > max && <p className="text-red-700">That is more than the bill ({inr(max)}).</p>}
    </div>
  );
}

/**
 * The counter's way into the khata: everyone who owes, most first, and the
 * total outstanding. Pick a customer to take their payment.
 */
function KhataFinder({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [data, setData] = useState<{
    customers: { id: string; name: string | null; phone: string | null; due: number; band: "green" | "yellow" | "red" }[];
    totalDue: number;
    count: number;
    limits: { yellowAbove: number; redAbove: number };
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/khata?q=${encodeURIComponent(q.trim())}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load khata"));
  }, [q]);
  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  if (open) return <KhataModal userId={open} onClose={() => { setOpen(null); load(); }} onChanged={load} />;

  return (
    <Modal open onClose={onClose} title="📒 Khata" wide>
      <div className="space-y-3">
        {data && (
          <p className="text-sm">
            {data.count > 0 ? (
              <>
                <strong className="text-red-700 text-lg">{inr(data.totalDue)}</strong> due from{" "}
                <strong>{data.count}</strong> customer{data.count === 1 ? "" : "s"}
              </>
            ) : (
              "Nobody owes anything right now ✓"
            )}
          </p>
        )}
        <input
          className="input"
          autoFocus
          type="search"
          placeholder="Search by name or mobile"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search khata"
        />
        <ErrorBox message={error} />
        {!data ? (
          <Spinner label="Loading…" />
        ) : data.customers.length === 0 ? (
          <p className="text-sm text-maroon-800/50">{q ? "No one with dues matches that." : ""}</p>
        ) : (
          <ul className="divide-y divide-cream-200 border border-cream-300 rounded-xl overflow-hidden">
            {data.customers.map((c) => (
              <li key={c.id}>
                <button
                  onClick={() => setOpen(c.id)}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-3 text-left border-l-4 hover:brightness-95 ${
                    c.band === "red" ? "bg-red-50 border-l-red-500" : c.band === "yellow" ? "bg-mustard-100/60 border-l-mustard-400" : "bg-leaf-50/60 border-l-leaf-500"
                  }`}
                >
                  <span>
                    <span className="font-semibold">{c.name ?? "No name"}</span>
                    <span className="block text-xs text-maroon-800/60">{c.phone}</span>
                  </span>
                  <span className={`font-bold ${c.band === "red" ? "text-red-700" : c.band === "yellow" ? "text-mustard-600" : "text-leaf-600"}`}>
                    {c.band === "red" ? "🔴" : c.band === "yellow" ? "🟡" : "🟢"} {inr(c.due)} ›
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

const PICKUP_STAGE: Record<string, { label: string; tone: string }> = {
  ACCEPTED: { label: "🧾 Ordered", tone: "bg-cream-200 text-maroon-700" },
  PREPARING: { label: "🍳 Preparing", tone: "bg-mustard-100 text-mustard-600" },
  READY: { label: "✅ Ready", tone: "bg-leaf-50 text-leaf-600" },
};

/** What is still owed on a waiting parcel, in words. */
function pickupPayment(p: Pickup): { label: string; due: boolean } {
  if (p.paymentStatus === "PAID") return { label: "Paid ✓", due: false };
  if (p.paymentMethod === "KHATA") return { label: "📒 On khata", due: false };
  return { label: `${inr(p.total)} to collect`, due: true };
}

/**
 * Parcels ordered and waiting to be collected. Ready ones first — someone is
 * standing at the counter for those.
 */
function WaitingParcels({
  pickups,
  onCollect,
  onBill,
  open,
  onToggle,
}: {
  pickups: Pickup[] | null;
  onCollect: (p: Pickup) => void;
  onBill: (orderId: string) => void;
  open: boolean;
  onToggle: () => void;
}) {
  if (!pickups || pickups.length === 0) return null;
  const sorted = [...pickups].sort((a, b) => (a.status === "READY" ? 0 : 1) - (b.status === "READY" ? 0 : 1));
  return (
    <section className="mb-4" aria-label="Parcels waiting">
      <ListHead
        title="Parcels waiting"
        closedLabel="Parcels to hand over"
        count={pickups.length}
        open={open}
        onToggle={onToggle}
      />
      {open && (
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {sorted.map((p) => {
          const stage = PICKUP_STAGE[p.status] ?? PICKUP_STAGE.ACCEPTED;
          const pay = pickupPayment(p);
          return (
            <div
              key={p.id}
              className={`card p-3 sm:p-4 border-l-4 ${p.status === "READY" ? "border-l-leaf-500" : "border-l-mustard-400"}`}
            >
              <div className="flex items-start justify-between gap-2">
                <span className="font-mono font-bold text-lg">🛍️ {p.orderNumber}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-bold whitespace-nowrap ${stage.tone}`}>{stage.label}</span>
              </div>
              <p className="text-sm text-maroon-800/70 mt-0.5">
                {p.customer.name ?? "Walk-in"}
                {p.customer.phone && ` · ${p.customer.phone.replace(/^\+91/, "")}`}
              </p>
              <p className="text-xs text-maroon-800/50 truncate mt-1">
                {p.items.map((i) => `${i.qty}×${i.name}`).join(", ")}
              </p>
              <p className={`mt-2 text-xl font-bold ${pay.due ? "text-maroon-700" : "text-leaf-600"}`}>{pay.label}</p>
              <button onClick={() => onCollect(p)} className="btn-primary w-full !min-h-[46px] mt-3">
                {pay.due ? "💰 Collect & hand over" : "📦 Hand over"}
              </button>
              <button onClick={() => onBill(p.id)} className="btn-ghost w-full !min-h-[40px] mt-2 text-sm">
                🧾 Bill / print
              </button>
            </div>
          );
        })}
      </div>
      )}
    </section>
  );
}

/**
 * The customer has come for their parcel: take the money — cash, UPI, card
 * or khata — and hand it over. Payment can also be taken before the food is
 * ready, leaving the parcel on the list until it goes out.
 */
function CollectModal({
  parcel,
  onClose,
  onDone,
  onAddItems,
}: {
  parcel: Pickup;
  onClose: () => void;
  onDone: (settled: { orderId: string; orderNumber: string; total: number }) => void;
  /** They want one more thing while they are standing here. */
  onAddItems: () => void;
}) {
  const pay = pickupPayment(parcel);
  const [method, setMethod] = useState<"CASH" | "ONLINE" | "KHATA">("CASH");
  const [paidNow, setPaidNow] = useState("");
  const [paidNowMethod, setPaidNowMethod] = useState<PayMethod>("CASH");
  const [handOver, setHandOver] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/counter/pickups/${parcel.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(pay.due ? { paymentMethod: method, ...(method === "KHATA" ? { paidNow: +paidNow || 0, paidNowMethod } : {}) } : {}),
          handOver: pay.due ? handOver : true,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      playTone("success");
      onDone({ orderId: parcel.id, orderNumber: d.orderNumber ?? parcel.orderNumber, total: d.total ?? parcel.total });
    } catch (e) {
      playTone("error");
      setError(e instanceof Error ? e.message : "Could not save");
      setBusy(false);
    }
  };

  const label = !pay.due
    ? "📦 Hand over"
    : method === "KHATA"
      ? +paidNow > 0
        ? `Take ${inr(+paidNow)} · ${inr(Math.max(parcel.total - +paidNow, 0))} on khata`
        : `Put ${inr(parcel.total)} on khata`
      : `Take ${inr(parcel.total)} by ${method === "CASH" ? "cash" : "UPI / card"}`;

  return (
    <Modal open onClose={onClose} title={`Parcel · ${parcel.orderNumber}`} wide>
      <div className="space-y-4">
        <p className="text-sm text-maroon-800/70">
          {parcel.customer.name ?? "Walk-in"}
          {parcel.customer.phone && ` · ${parcel.customer.phone}`} · {(PICKUP_STAGE[parcel.status] ?? PICKUP_STAGE.ACCEPTED).label}
        </p>
        <ul className="divide-y divide-cream-200 text-sm">
          {parcel.items.map((i) => (
            <li key={i.id} className="py-1.5 flex justify-between gap-3">
              <span>
                {i.qty} × {i.name}
                {i.variantName && <span className="text-maroon-800/60"> ({i.variantName})</span>}
              </span>
              <span className="font-medium shrink-0">{inr(i.lineTotal)}</span>
            </li>
          ))}
        </ul>
        <div className="flex justify-between items-baseline border-t-2 border-cream-200 pt-3">
          <span className="font-bold text-lg">{pay.due ? "To collect" : "Total"}</span>
          <span className="font-bold text-3xl text-maroon-700">{inr(parcel.total)}</span>
        </div>

        {pay.due ? (
          <div>
            <span className="label">Paid by</span>
            <div className="flex flex-wrap gap-2">
              {(["CASH", "ONLINE", "KHATA"] as const).map((m) => (
                <button key={m} onClick={() => setMethod(m)} className={`chip ${method === m ? "chip-active" : ""}`}>
                  {m === "CASH" ? "💵 Cash" : m === "ONLINE" ? "📱 UPI / Card" : "📒 Khata (pay later)"}
                </button>
              ))}
            </div>
            {method === "KHATA" && (
              <KhataPaidNow
                who={parcel.customer.name}
                due={null}
                paidNow={paidNow}
                setPaidNow={setPaidNow}
                method={paidNowMethod}
                setMethod={setPaidNowMethod}
                max={parcel.total}
              />
            )}
            <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={handOver} onChange={(e) => setHandOver(e.target.checked)} />
              Parcel handed over to the customer now
            </label>
            {!handOver && (
              <p className="text-xs text-maroon-800/60 mt-1">
                Payment is taken; the parcel stays under Parcels waiting until you hand it over.
              </p>
            )}
          </div>
        ) : (
          <p className="text-sm text-leaf-600 font-semibold">{pay.label} — nothing to collect.</p>
        )}

        <ErrorBox message={error} />
        <button
          onClick={submit}
          disabled={busy || (pay.due && method === "KHATA" && +paidNow > parcel.total)}
          className="btn-primary w-full !py-4 !text-lg"
        >
          {busy ? "Saving…" : label}
        </button>
        {/* Asked for at the last moment, which is when it usually is. The
            items join this bill rather than starting a second order, and if
            the parcel is already paid for only the new ones are charged. */}
        <button onClick={onAddItems} disabled={busy} className="btn-secondary w-full !min-h-[46px]">
          ➕ Add more items{parcel.paymentStatus === "PAID" ? " (charge the extra only)" : ""}
        </button>
      </div>
    </Modal>
  );
}

type DiscountType = "FLAT" | "PERCENT";

/** What a discount takes off a bill of this size — for showing before it is given. */
function discountAmount(type: DiscountType, value: string, subtotal: number): number {
  const v = +value || 0;
  if (v <= 0) return 0;
  return Math.min(type === "PERCENT" ? (subtotal * Math.min(v, 100)) / 100 : v, subtotal);
}

/**
 * A discount given at the counter — ₹50 off, or 10% — with the reason it was
 * given. Shown with the money it takes off, so nobody has to do the sum in
 * their head with a queue waiting.
 */
function DiscountBox({
  subtotal, type, setType, value, setValue, reason, setReason,
}: {
  subtotal: number;
  type: DiscountType;
  setType: (t: DiscountType) => void;
  value: string;
  setValue: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
}) {
  const off = discountAmount(type, value, subtotal);
  return (
    <div className="border-t border-cream-200 pt-3">
      <span className="label">Discount (optional)</span>
      <div className="flex flex-wrap items-center gap-2">
        {(["FLAT", "PERCENT"] as const).map((t) => (
          <button key={t} onClick={() => setType(t)} className={`chip ${type === t ? "chip-active" : ""}`}>
            {t === "FLAT" ? "₹ off" : "% off"}
          </button>
        ))}
        <input
          className="input !w-24 !min-h-[36px]"
          type="number"
          inputMode="decimal"
          min={0}
          max={type === "PERCENT" ? 100 : undefined}
          placeholder="0"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-label="Discount amount"
        />
        {off > 0 && (
          <span className="text-sm font-semibold text-leaf-600">
            −{inr(off)}{type === "PERCENT" && ` of ${inr(subtotal)}`}
          </span>
        )}
      </div>
      {off > 0 && (
        <input
          className="input !min-h-[36px] mt-2"
          maxLength={120}
          placeholder="Reason (optional) — e.g. regular customer, late order"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-label="Discount reason"
        />
      )}
    </div>
  );
}
