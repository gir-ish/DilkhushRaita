"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr, istDateTime, timeAgo } from "@/lib/utils";
import { STATUS_TRANSITIONS } from "@/lib/constants";
import { AdminOrder, OrderDetailModal } from "@/components/admin/order-detail-modal";
import { BranchTabs, type BranchTab } from "@/components/admin/branch-tabs";
import { notify, playTone } from "@/lib/sound";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [branches, setBranches] = useState<BranchTab[]>([]);
  const [branchId, setBranchId] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const prevPlacedIds = useRef<Set<string> | null>(null);

  useEffect(() => {
    // Scoped endpoint — a branch manager only ever sees their own branches.
    fetch("/api/admin/branches")
      .then((r) => (r.ok ? r.json() : { branches: [] }))
      .then((d) => setBranches(d.branches ?? []))
      .catch(() => setBranches([]));
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status === "__unpaid") params.set("unpaid", "1");
    else if (status !== "all") params.set("status", status);
    if (activeOnly && status === "all") params.set("active", "1");
    fetch(`/api/admin/orders?${params}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        const list: AdminOrder[] = d.orders;
        const placedNow = new Set(list.filter((o) => o.status === "PLACED").map((o) => o.id));
        if (prevPlacedIds.current) {
          const fresh = [...placedNow].filter((id) => !prevPlacedIds.current!.has(id));
          if (fresh.length > 0) {
            playTone("newOrder");
            notify(
              "🆕 New order!",
              `${fresh.length} new order${fresh.length === 1 ? "" : "s"} waiting for acceptance`,
              "dk-new-order"
            );
          }
        }
        prevPlacedIds.current = placedNow;
        setOrders(list);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [q, status, activeOnly]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // live queue via polling
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default")
      Notification.requestPermission();
  }, []);

  // Matched on slug, not display name — names are editable in the dashboard
  // and two branches could be renamed to collide.
  // Counts come from the unfiltered list so each tab keeps its own total even
  // while a different branch is selected.
  const branchCounts = (orders ?? []).reduce<Record<string, number>>((acc, o) => {
    const b = branches.find((x) => x.slug === o.branch.slug);
    if (b) acc[b.id] = (acc[b.id] ?? 0) + 1;
    return acc;
  }, {});
  const selectedSlug = branches.find((b) => b.id === branchId)?.slug;
  const visible = (orders ?? []).filter(
    (o) => branchId === "all" || o.branch.slug === selectedSlug
  );

  return (
    <div>
      {/* Nothing in this page may be wider than the viewport: the admin header
          is `sticky`, which pins it vertically only, so any horizontal overflow
          drags the header sideways along with the page. */}
      <div className="flex flex-wrap gap-2 items-center mb-3 no-print">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-maroon-700 w-full sm:w-auto sm:mr-auto">
          Orders
        </h1>
        <input
          type="search"
          className="input !w-full sm:!w-56"
          placeholder="Order no / name / phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search orders"
        />
        {/* min-w-0 lets the select shrink past its longest option ("REFUND
            INITIATED") instead of pushing the row off the screen. */}
        <select
          className="input !w-auto min-w-0 flex-1 sm:flex-none"
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          aria-label="Status filter"
        >
          <option value="all">All statuses</option>
          {/* Unpaid online orders are hidden from every other view — this is how
              you go and look at them. */}
          <option value="__unpaid">UNPAID ONLINE</option>
          {Object.keys(STATUS_TRANSITIONS).concat("DELIVERED").map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
          <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
      </div>

      <BranchTabs
        branches={branches}
        value={branchId}
        onChange={setBranchId}
        counts={branchCounts}
        className="mb-4 no-print"
      />

      <ErrorBox message={error} />
      {!orders ? (
        <Spinner label="Loading orders…" />
      ) : visible.length === 0 ? (
        <p className="text-center py-16 text-maroon-800/50">
          No orders match{branchId !== "all" ? " for this branch" : ""}.
        </p>
      ) : (
        <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
          {visible.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o)}
              /* min-w-0: a grid item defaults to min-width:auto, so without it
                 the card refuses to shrink below the un-truncated width of the
                 item summary line and spills off a narrow screen. */
              className={`card min-w-0 p-3.5 sm:p-4 text-left hover:shadow-lift transition border-l-4 ${
                o.status === "PLACED" ? "border-l-red-600 animate-pulse" :
                ["PREPARING", "ACCEPTED"].includes(o.status) ? "border-l-mustard-400" :
                o.status === "DELIVERED" ? "border-l-leaf-500" : "border-l-cream-300"
              }`}
            >
              <div className="flex justify-between items-start gap-2">
                <span className="font-bold text-base sm:text-lg truncate">{o.orderNumber}</span>
                <span className="text-[10px] sm:text-xs font-bold px-2 py-1 rounded-full bg-cream-200 whitespace-nowrap shrink-0">{o.status.replace(/_/g, " ")}</span>
              </div>
              {/* Branch up front and colour-coded: with two queues side by side
                  the branch is the easiest thing to misread. */}
              <span
                className={`inline-block mt-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
                  o.branch.slug === "rohini"
                    ? "bg-maroon-100 text-maroon-700"
                    : "bg-mustard-100 text-mustard-600"
                }`}
              >
                🏪 {o.branch.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
              </span>
              <p className="text-sm sm:text-[15px] mt-1.5">
                {o.user.name ?? "Customer"} · {o.type === "DINE_IN" ? "🍽️ Dine-in" : o.type === "PICKUP" ? "🛍️ Pickup" : "🛵 Delivery"} · <strong>{inr(o.total)}</strong> ({o.paymentMethod})
              </p>
              <p className="text-xs text-maroon-800/60 truncate mt-1">
                {o.items.map((i) => `${i.qty}×${i.nameSnapshot}`).join(", ")}
              </p>
              {/* Exact stamp first, "8 min ago" second: the relative time is what
                  you scan while working, but the absolute one is what you quote
                  back to a customer, so both have to be on the card. */}
              <p className="text-xs text-maroon-800/50 mt-1">
                🕒 {istDateTime(o.placedAt)}{" "}
                <span className="text-maroon-800/40">· {timeAgo(o.placedAt)}</span>
              </p>
              {o.scheduledFor && (
                <p className="text-xs font-semibold text-maroon-800/60">
                  ⏰ Scheduled {istDateTime(o.scheduledFor)}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {selected && (
        <OrderDetailModal
          order={selected}
          onClose={() => setSelected(null)}
          onChanged={(o) => { setSelected(o); load(); }}
        />
      )}
    </div>
  );
}
