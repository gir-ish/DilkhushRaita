"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";

const TYPES = [
  ["sales", "Daily sales"],
  ["items", "Menu performance"],
  ["coupons", "Coupon performance"],
  ["customers", "Customer retention"],
  ["cod", "COD reconciliation"],
] as const;

export default function ReportsPage() {
  const [type, setType] = useState("sales");
  const [from, setFrom] = useState(() => new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10));
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const params = useCallback(
    () => new URLSearchParams({ type, from, to }),
    [type, from, to]
  );

  useEffect(() => {
    setRows(null);
    fetch(`/api/admin/reports?${params()}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setRows(d.rows);
      })
      .catch((e) => setError(e.message));
  }, [params]);

  const headers = rows && rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Reports</h1>
        <select className="input !w-auto" value={type} onChange={(e) => setType(e.target.value)} aria-label="Report type">
          {TYPES.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
        </select>
        <label className="text-sm" htmlFor="r-from">From</label>
        <input id="r-from" type="date" className="input !w-auto" value={from} onChange={(e) => setFrom(e.target.value)} />
        <label className="text-sm" htmlFor="r-to">To</label>
        <input id="r-to" type="date" className="input !w-auto" value={to} onChange={(e) => setTo(e.target.value)} />
        <a href={`/api/admin/reports?${params()}&format=csv`} className="btn-secondary !min-h-[38px]">
          ⬇️ Export CSV
        </a>
      </div>
      <ErrorBox message={error} />
      {!rows ? (
        <Spinner label="Building report…" />
      ) : rows.length === 0 ? (
        <p className="text-center py-16 text-maroon-800/50">No data for this period.</p>
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                {headers.map((h) => <th key={h} className="p-3 capitalize">{h.replace(/([A-Z])/g, " $1")}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i} className="border-b border-cream-100">
                  {headers.map((h) => <td key={h} className="p-3">{String(r[h] ?? "")}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
