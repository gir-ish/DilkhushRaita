"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr, timeAgo } from "@/lib/utils";

interface CustomerRow {
  id: string; name: string | null; phone: string | null;
  blocked: boolean; codOnlyBlock: boolean; joined: string;
  completedOrders: number; cancelledOrders: number;
  lifetimeSpend: number; avgOrderValue: number;
  lastOrderAt: string | null; loyaltyPoints: number; tier: string;
}

export default function AdminCustomersPage() {
  const [rows, setRows] = useState<CustomerRow[] | null>(null);
  const [q, setQ] = useState("");
  const [segment, setSegment] = useState("all");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q);
    if (segment !== "all") p.set("segment", segment);
    fetch(`/api/admin/customers?${p}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setRows(d.customers);
      })
      .catch((e) => setError(e.message));
  }, [q, segment]);
  useEffect(() => {
    const t = setTimeout(load, 300);
    return () => clearTimeout(t);
  }, [load]);

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
        </select>
      </div>
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[820px]">
            <thead>
              <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                <th className="p-3">Customer</th><th className="p-3">Tier</th><th className="p-3">Orders</th>
                <th className="p-3">Lifetime</th><th className="p-3">AOV</th><th className="p-3">Points</th>
                <th className="p-3">Last order</th><th className="p-3">Flags</th><th className="p-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-cream-100">
                  <td className="p-3">
                    <span className="font-semibold">{c.name ?? "—"}</span>
                    <span className="block text-xs text-maroon-800/50">{c.phone}</span>
                  </td>
                  <td className="p-3">{c.tier}</td>
                  <td className="p-3">{c.completedOrders} <span className="text-xs text-red-700">({c.cancelledOrders}✕)</span></td>
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
    </div>
  );
}
