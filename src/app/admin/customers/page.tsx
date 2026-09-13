"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr, timeAgo } from "@/lib/utils";
import { KhataModal } from "@/components/admin/khata-modal";

interface CustomerRow {
  id: string; name: string | null; phone: string | null;
  blocked: boolean; codOnlyBlock: boolean; joined: string;
  completedOrders: number; cancelledOrders: number;
  lifetimeSpend: number; avgOrderValue: number;
  lastOrderAt: string | null; loyaltyPoints: number; tier: string;
  khataDue: number;
  khataBand: Band;
}

type Band = "green" | "yellow" | "red";
interface KhataInfo {
  totalDue: number;
  customers: number;
  limits: { yellowAbove: number; redAbove: number };
  counts: Record<Band, number>;
}

/** Row tint and the colour of the khata amount, per band. */
const BAND_STYLE: Record<Band, { row: string; edge: string; text: string; chip: string; label: string }> = {
  green: { row: "bg-leaf-50/60", edge: "border-l-leaf-500", text: "text-leaf-600", chip: "🟢", label: "No dues" },
  yellow: { row: "bg-mustard-100/60", edge: "border-l-mustard-400", text: "text-mustard-600", chip: "🟡", label: "Some due" },
  red: { row: "bg-red-50", edge: "border-l-red-500", text: "text-red-700", chip: "🔴", label: "High due" },
};

export default function AdminCustomersPage() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [khata, setKhata] = useState<KhataInfo | null>(null);
  const [khataFor, setKhataFor] = useState<string | null>(null);
  const [band, setBand] = useState<Band | "all">("all");
  // The owner's colour limits, being edited.
  const [limitsDraft, setLimitsDraft] = useState<{ yellowAbove: string; redAbove: string } | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (segment !== "all") p.set("segment", segment);
    if (band !== "all") p.set("band", band);
    fetch(`/api/admin/customers?${p}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setRows(d.customers);
        setKhata(d.khata ?? null);
      })
      .catch((e) => setError(e.message));
  }, [q, segment, band]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

  const saveLimits = async () => {
    if (!limitsDraft) return;
    setError(null);
    const r = await fetch("/api/admin/khata-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yellowAbove: +limitsDraft.yellowAbove || 0, redAbove: +limitsDraft.redAbove || 0 }),
    });
    if (!r.ok) return setError((await r.json()).error ?? "Could not save the colours");
    setLimitsDraft(null);
    load();
  };

  const patch = async (id: string, body: object) => {
    const r = await fetch(`/api/admin/customers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (r.ok) load();
    else setError((await r.json()).error);
  };

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Customers</h1>
        <input type="search" className="input !w-56" placeholder="Name or phone" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search customers" />
        <select className="input !w-auto" value={segment} onChange={(e) => setSegment(e.target.value)} aria-label="Segment">
          <option value="all">All customers</option>
          <option value="new">New (0 orders)</option>
          <option value="frequent">Frequent (5+ orders)</option>
          <option value="high-spend">High spend (₹3000+)</option>
          <option value="inactive-30">Inactive 30+ days</option>
          <option value="khata">📒 Khata due</option>
        </select>
      </div>
      {khata && khata.customers > 0 && (
        <button
          onClick={() => setSegment("khata")}
          className="mb-3 w-full sm:w-auto text-left rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-sm"
        >
          📒 <strong className="text-red-700">{inr(khata.totalDue)}</strong> due on khata from{" "}
          <strong>{khata.customers}</strong> customer{khata.customers === 1 ? "" : "s"}
          {segment !== "khata" && <span className="underline ml-2">Show them</span>}
        </button>
      )}
      {khata && (
        <div className="flex flex-wrap items-center gap-2 mb-3" role="group" aria-label="Khata colour">
          <button onClick={() => setBand("all")} className={`chip ${band === "all" ? "chip-active" : ""}`}>All</button>
          {(["green", "yellow", "red"] as const).map((b) => (
            <button key={b} onClick={() => setBand(b)} className={`chip ${band === b ? "chip-active" : ""}`}>
              {BAND_STYLE[b].chip} {BAND_STYLE[b].label} ({khata.counts[b]})
            </button>
          ))}
          <span className="text-xs text-maroon-800/60">
            🟡 above {inr(khata.limits.yellowAbove)} · 🔴 above {inr(khata.limits.redAbove)}
          </span>
          <button
            onClick={() => setLimitsDraft({ yellowAbove: String(khata.limits.yellowAbove), redAbove: String(khata.limits.redAbove) })}
            className="text-xs underline"
          >
            ⚙️ Change
          </button>
        </div>
      )}
      {limitsDraft && (
        <div className="card p-3 mb-3 flex flex-wrap items-center gap-3 text-sm" aria-label="Khata colour limits">
          <label className="flex items-center gap-1">
            🟡 Yellow when due is above ₹
            <input className="input !w-24 !min-h-[36px]" type="number" min={0} value={limitsDraft.yellowAbove} onChange={(e) => setLimitsDraft({ ...limitsDraft, yellowAbove: e.target.value })} />
          </label>
          <label className="flex items-center gap-1">
            🔴 Red when due is above ₹
            <input className="input !w-28 !min-h-[36px]" type="number" min={0} value={limitsDraft.redAbove} onChange={(e) => setLimitsDraft({ ...limitsDraft, redAbove: e.target.value })} />
          </label>
          <span className="text-xs text-maroon-800/50">🟢 Green: at or below the yellow limit (₹0 = nothing pending).</span>
          <button onClick={saveLimits} className="btn-primary !min-h-[36px] !px-4">Save</button>
          <button onClick={() => setLimitsDraft(null)} className="btn-outline !min-h-[36px] !px-3">Cancel</button>
        </div>
      )}
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                <th className="p-3">Customer</th><th className="p-3">Tier</th><th className="p-3">Orders</th>
                <th className="p-3">Khata</th>
                <th className="p-3">Lifetime</th><th className="p-3">AOV</th><th className="p-3">Points</th>
                <th className="p-3">Last order</th><th className="p-3">Flags</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className={`border-b border-cream-100 ${BAND_STYLE[c.khataBand].row}`}>
                  <td className={`p-3 border-l-4 ${BAND_STYLE[c.khataBand].edge}`}>
                    <span className="font-semibold">{c.name ?? "—"}</span>
                    <span className="block text-xs text-maroon-800/50">{c.phone}</span>
                  </td>
                  <td className="p-3">{c.tier}</td>
                  <td className="p-3">{c.completedOrders} <span className="text-xs text-red-700">({c.cancelledOrders}✕)</span></td>
                  <td className="p-3">
                    <button
                      onClick={() => setKhataFor(c.id)}
                      className={`underline ${c.khataDue > 0 ? "font-bold" : "text-xs"} ${BAND_STYLE[c.khataBand].text}`}
                      aria-label={`Khata of ${c.name ?? c.phone}`}
                    >
                      {c.khataDue > 0 ? inr(c.khataDue) : "✓ clear"}
                    </button>
                  </td>
                  <td className="p-3">{inr(c.lifetimeSpend)}</td>
                  <td className="p-3">{inr(c.avgOrderValue)}</td>
                  <td className="p-3">{c.loyaltyPoints}</td>
                  <td className="p-3 text-xs">{c.lastOrderAt ? timeAgo(c.lastOrderAt) : "never"}</td>
                  <td className="p-3 text-xs">
                    {c.blocked && <span className="text-red-700 font-bold">BLOCKED </span>}
                    {c.codOnlyBlock && <span className="text-mustard-600 font-bold">NO-COD</span>}
                  </td>
                  <td className="p-3 space-x-2 whitespace-nowrap text-xs">
                    <button
                      className="underline"
                      onClick={() => {
                        if (confirm(`${c.blocked ? "Unblock" : "Block"} ${c.name ?? c.phone}? Confirm manually before blocking.`))
                          patch(c.id, { blocked: !c.blocked });
                      }}
                    >
                      {c.blocked ? "Unblock" : "Block"}
                    </button>
                    <button className="underline" onClick={() => patch(c.id, { codOnlyBlock: !c.codOnlyBlock })}>
                      {c.codOnlyBlock ? "Allow COD" : "Restrict COD"}
                    </button>
                    <button
                      className="underline"
                      onClick={() => {
                        const pts = prompt("Adjust points by (+/-):");
                        if (pts && !isNaN(+pts)) patch(c.id, { adjustPoints: Math.trunc(+pts), note: "Manual adjustment" });
                      }}
                    >
                      ± Points
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {khataFor && <KhataModal userId={khataFor} onClose={() => setKhataFor(null)} onChanged={load} />}
    </div>
  );
}
