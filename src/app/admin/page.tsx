"use client";

import { useEffect, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr } from "@/lib/utils";

interface Summary {
  revenue: number; totalOrders: number; completedOrders: number; cancelledOrders: number;
  activeOrders: number; newCustomers: number; uniqueCustomers: number;
  avgOrderValue: number; discountCost: number; couponUse: number; avgDeliveryMins: number | null;
  byBranch: { id: string; name: string; orders: number; delivered: number; revenue: number; cancelled: number }[];
  byHour: Record<string, number>;
  paymentBreakdown: Record<string, { count: number; amount: number }>;
  bestsellers: { name: string; qty: number; revenue: number }[];
}

export default function AdminOverview() {
  const [range, setRange] = useState("today");
  const [branchId, setBranchId] = useState("all");
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([]);
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/branches").then((r) => r.json()).then((d) => setBranches(d.branches ?? []));
  }, []);

  useEffect(() => {
    setData(null);
    fetch(`/api/admin/summary?range=${range}&branchId=${branchId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setData(d);
      })
      .catch((e) => setError(e.message));
  }, [range, branchId]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Overview</h1>
        <select className="input !w-auto" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Date range">
          <option value="today">Today</option>
          <option value="yesterday">Yesterday</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>
        <select className="input !w-auto" value={branchId} onChange={(e) => setBranchId(e.target.value)} aria-label="Branch">
          <option value="all">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
      </div>

      <ErrorBox message={error} />
      {!data ? (
        <Spinner label="Crunching numbers…" />
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <Stat label="Revenue (delivered)" value={inr(data.revenue)} />
            <Stat label="Completed orders" value={String(data.completedOrders)} />
            <Stat label="Active right now" value={String(data.activeOrders)} highlight />
            <Stat label="Cancelled / rejected" value={String(data.cancelledOrders)} />
            <Stat label="Avg order value" value={inr(data.avgOrderValue)} />
            <Stat label="New customers" value={String(data.newCustomers)} />
            <Stat label="Discounts given" value={inr(data.discountCost)} />
            <Stat label="Avg delivery time" value={data.avgDeliveryMins ? `${data.avgDeliveryMins} min` : "—"} />
          </div>

          <div className="grid md:grid-cols-2 gap-4 mt-4">
            <section className="card p-4" aria-label="Branch performance">
              <h2 className="font-semibold mb-2">Branch comparison</h2>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-maroon-800/50">
                    <th className="py-1">Branch</th><th>Orders</th><th>Delivered</th><th>Revenue</th><th>Cancelled</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byBranch.map((b) => (
                    <tr key={b.id} className="border-t border-cream-200">
                      <td className="py-2 font-semibold">{b.name}</td>
                      <td>{b.orders}</td><td>{b.delivered}</td>
                      <td>{inr(b.revenue)}</td><td>{b.cancelled}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section className="card p-4" aria-label="Bestsellers">
              <h2 className="font-semibold mb-2">Bestselling items</h2>
              {data.bestsellers.length === 0 ? (
                <p className="text-sm text-maroon-800/50">No sales in this period.</p>
              ) : (
                <ol className="text-sm space-y-1">
                  {data.bestsellers.map((b, i) => (
                    <li key={b.name} className="flex justify-between border-t border-cream-200 py-1.5 first:border-0">
                      <span>{i + 1}. {b.name}</span>
                      <span className="text-maroon-800/60">{b.qty} sold · {inr(b.revenue)}</span>
                    </li>
                  ))}
                </ol>
              )}
            </section>

            <section className="card p-4" aria-label="Orders by hour">
              <h2 className="font-semibold mb-2">Orders by hour</h2>
              <div className="flex items-end gap-1 h-24" role="img" aria-label="Bar chart of orders by hour">
                {Array.from({ length: 24 }, (_, h) => {
                  const v = data.byHour[h] ?? 0;
                  const max = Math.max(1, ...Object.values(data.byHour));
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center gap-0.5" title={`${h}:00 — ${v} orders`}>
                      <div className="w-full bg-maroon-500 rounded-t" style={{ height: `${(v / max) * 80}px` }} />
                      {h % 6 === 0 && <span className="text-[9px] text-maroon-800/40">{h}</span>}
                    </div>
                  );
                })}
              </div>
            </section>

            <section className="card p-4" aria-label="Payments">
              <h2 className="font-semibold mb-2">Payment methods · Coupons</h2>
              {Object.entries(data.paymentBreakdown).map(([k, v]) => (
                <p key={k} className="text-sm flex justify-between border-t border-cream-200 py-1.5 first:border-0">
                  <span>{k === "COD" ? "💵 Cash on Delivery" : "💳 Online"}</span>
                  <span>{v.count} orders · {inr(v.amount)}</span>
                </p>
              ))}
              <p className="text-sm flex justify-between border-t border-cream-200 py-1.5">
                <span>🎟️ Orders with coupons</span><span>{data.couponUse}</span>
              </p>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`card p-4 ${highlight ? "!bg-maroon-600 !text-cream-50" : ""}`}>
      <p className={`text-xs font-semibold ${highlight ? "opacity-80" : "text-maroon-800/50"}`}>{label}</p>
      <p className="text-xl font-bold font-display mt-1">{value}</p>
    </div>
  );
}
