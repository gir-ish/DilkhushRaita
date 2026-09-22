"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr, istInputDate } from "@/lib/utils";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { AdminOrder, OrderDetailModal } from "@/components/admin/order-detail-modal";
import { OrderCard } from "@/components/admin/order-card";
import { BranchTabs, type BranchTab } from "@/components/admin/branch-tabs";

/**
 * Orders that came in from the website, on their own screen.
 *
 * The counter is now a closed loop — an order taken at the till is accepted
 * the moment it is taken and never leaves that screen — so the order queue's
 * real job is the orders nobody has said yes to yet. Those all arrive from
 * the website, which is why they get a page of their own, with the count that
 * matters printed large enough to see from across the room.
 */
export default function OnlineOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [branches, setBranches] = useState<BranchTab[]>([]);
  const [branchId, setBranchId] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  // One day at a time by default — today's website orders are the day's work.
  const [date, setDate] = useState(() => istInputDate());
  const [openOnly, setOpenOnly] = useState(false);
  const [selected, setSelected] = useState<AdminOrder | null>(null);

  useEffect(() => {
    fetch("/api/admin/branches")
      .then((r) => (r.ok ? r.json() : { branches: [] }))
      .then((d) => setBranches(d.branches ?? []))
      .catch(() => setBranches([]));
  }, []);

  const load = useCallback(() => {
    const params = new URLSearchParams({ channel: "ONLINE" });
    if (q) params.set("q", q);
    if (date) params.set("date", date);
    fetch(`/api/admin/orders?${params}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setOrders(d.orders);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [q, date]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // live queue via polling
    return () => clearInterval(t);
  }, [load]);

  const selectedSlug = branches.find((b) => b.id === branchId)?.slug;
  const forBranch = useMemo(
    () => (orders ?? []).filter((o) => branchId === "all" || o.branch.slug === selectedSlug),
    [orders, branchId, selectedSlug]
  );

  /**
   * The day's shape in four numbers. Cancelled and rejected orders are counted
   * as what happened but never as money — nobody paid for them.
   */
  const stats = useMemo(() => {
    const dead = ["CANCELLED", "REJECTED"];
    const waiting = forBranch.filter((o) => o.status === "PLACED").length;
    const working = forBranch.filter(
      (o) => o.status !== "PLACED" && (ACTIVE_STATUSES as readonly string[]).includes(o.status)
    ).length;
    const done = forBranch.filter((o) => o.status === "DELIVERED").length;
    const takings = forBranch
      .filter((o) => !dead.includes(o.status))
      .reduce((n, o) => n + o.total, 0);
    return { waiting, working, done, takings, total: forBranch.length };
  }, [forBranch]);

  const branchCounts = (orders ?? []).reduce<Record<string, number>>((acc, o) => {
    const b = branches.find((x) => x.slug === o.branch.slug);
    if (b) acc[b.id] = (acc[b.id] ?? 0) + 1;
    return acc;
  }, {});

  const visible = openOnly
    ? forBranch.filter((o) => (ACTIVE_STATUSES as readonly string[]).includes(o.status))
    : forBranch;

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-3 no-print">
        <h1 className="font-display text-2xl sm:text-3xl font-bold text-maroon-700 w-full sm:w-auto sm:mr-auto">
          🌐 Online orders
        </h1>
        <input
          type="search"
          className="input !w-full sm:!w-56"
          placeholder="0001 / name / phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search online orders"
        />
        <input
          type="date"
          className="input !w-auto"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Online orders on this date"
          title="Show one day's website orders"
        />
        {date && (
          <button onClick={() => setDate("")} className="text-sm underline text-maroon-600">
            All dates
          </button>
        )}
        <label className="flex items-center gap-2 text-sm font-semibold whitespace-nowrap">
          <input
            type="checkbox"
            className="h-4 w-4 accent-maroon-600"
            checked={openOnly}
            onChange={(e) => setOpenOnly(e.target.checked)}
          />
          Still open
        </label>
      </div>

      {/* The numbers, large. "Waiting to accept" is the one that should never
          sit above zero for long, so it shouts when it is not. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
        <Stat
          label="Waiting to accept"
          value={stats.waiting}
          tone={stats.waiting > 0 ? "alarm" : "calm"}
          hint={stats.waiting > 0 ? "Accept these now" : "Nothing waiting"}
        />
        <Stat label="Being made" value={stats.working} tone="busy" hint="Accepted, not yet delivered" />
        <Stat
          label={date ? "Orders that day" : "Orders (latest 100)"}
          value={stats.total}
          tone="calm"
          hint={`${stats.done} delivered`}
        />
        <Stat label="Order value" value={inr(stats.takings)} tone="calm" hint="Cancelled orders excluded" />
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
        <Spinner label="Loading online orders…" />
      ) : visible.length === 0 ? (
        <p className="text-center py-16 text-maroon-800/50">
          No website orders{date ? " on this date" : ""}
          {branchId !== "all" ? " for this branch" : ""}. Orders taken at the till are on the{" "}
          <strong>Counter</strong> screen.
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

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number | string;
  hint: string;
  tone: "alarm" | "busy" | "calm";
}) {
  const tones = {
    alarm: "border-red-600 bg-red-50 text-red-700",
    busy: "border-mustard-400 bg-mustard-100 text-maroon-700",
    calm: "border-cream-300 bg-white text-maroon-700",
  };
  return (
    <div className={`card border-l-4 p-3 sm:p-4 ${tones[tone]}`}>
      <span className="block text-xs font-bold uppercase tracking-wide opacity-70">{label}</span>
      <span className="block font-display text-3xl sm:text-4xl font-bold leading-tight">{value}</span>
      <span className="block text-xs opacity-60">{hint}</span>
    </div>
  );
}
