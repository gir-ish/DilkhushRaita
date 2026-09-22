"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { STATUS_TRANSITIONS } from "@/lib/constants";
import { AdminOrder, OrderDetailModal } from "@/components/admin/order-detail-modal";
import { BranchTabs, type BranchTab } from "@/components/admin/branch-tabs";
import { OrderCard } from "@/components/admin/order-card";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [branches, setBranches] = useState<BranchTab[]>([]);
  const [branchId, setBranchId] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // One day at a time, so the same 0001 from different days stays apart.
  const [date, setDate] = useState("");
  const [status, setStatus] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<AdminOrder | null>(null);

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
    if (date) params.set("date", date);
    fetch(`/api/admin/orders?${params}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        const list: AdminOrder[] = d.orders;
        // The new-order alarm lives in the dashboard shell, so it fires on
        // every screen and only ever chimes once.
        setOrders(list);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [q, status, activeOnly, date]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // live queue via polling
    return () => clearInterval(t);
  }, [load]);

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
          placeholder="0001 / name / phone"
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
        <input
          type="date"
          className="input !w-auto"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Orders on this date"
          title="Show one day's orders"
        />
        {date && (
          <button onClick={() => setDate("")} className="text-sm underline text-maroon-600">
            Clear date
          </button>
        )}
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
            <OrderCard key={o.id} order={o} onClick={() => setSelected(o)} />
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
