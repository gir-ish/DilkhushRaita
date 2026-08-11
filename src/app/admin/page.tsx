"use client";

import { useCallback, useEffect, useState } from "react";
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

          <PairedDevices />
        </>
      )}
    </div>
  );
}

interface DeviceRow {
  id: string; label: string; lastUsedAt: string; createdAt: string; current: boolean;
}

/**
 * Browsers that can unlock the dashboard with the PIN.
 *
 * The PIN is only as private as the devices holding it, so losing a phone has
 * to be undoable without changing the password. Renders nothing for staff who
 * are not the owner — the endpoint refuses them anyway.
 */
function PairedDevices() {
  const [devices, setDevices] = useState<DeviceRow[] | null>(null);
  const [hasPin, setHasPin] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/devices")
      .then((r) => (r.ok ? r.json() : { devices: null }))
      .then((d) => { setDevices(d.devices); setHasPin(!!d.hasPin); })
      .catch(() => setDevices(null));
  }, []);
  useEffect(load, [load]);

  if (!devices) return null;

  const act = async (label: string, url: string, confirmText: string) => {
    if (!confirm(confirmText)) return;
    setBusy(label);
    setError(null);
    try {
      const r = await fetch(url, { method: "DELETE" });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not remove");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove");
    } finally {
      setBusy(null);
    }
  };

  const when = (iso: string) => {
    const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins} min ago`;
    if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
    return `${Math.round(mins / 1440)} d ago`;
  };

  return (
    <section className="card p-4 mt-4" aria-label="Paired devices">
      <h2 className="font-semibold mb-1">🔐 Devices that can use your PIN</h2>
      <p className="text-sm text-maroon-800/60 mb-3">
        Each of these has signed in with your password once. Remove any you do not
        recognise — they will need the password again.
      </p>
      <ErrorBox message={error} />

      <PinEditor hasPin={hasPin} onSaved={load} />

      {devices.length === 0 ? (
        <p className="text-sm text-maroon-800/50">No devices paired yet.</p>
      ) : (
        <ul className="divide-y divide-cream-200">
          {devices.map((d) => (
            <li key={d.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="flex-1 min-w-0">
                <span className="font-semibold">{d.label}</span>
                {d.current && (
                  <span className="ml-2 rounded-full bg-leaf-50 border border-leaf-500/30 px-2 py-0.5 text-[11px] font-bold text-leaf-600">
                    this device
                  </span>
                )}
                <span className="block text-xs text-maroon-800/50">Last used {when(d.lastUsedAt)}</span>
              </span>
              <button
                onClick={() => act(d.id, `/api/admin/devices/${d.id}`,
                  d.current
                    ? "Remove this device? You will need your password to sign in here again."
                    : `Remove ${d.label}? It will need your password to sign in again.`)}
                disabled={busy === d.id}
                className="underline text-red-700 shrink-0"
              >
                {busy === d.id ? "Removing…" : "Remove"}
              </button>
            </li>
          ))}
        </ul>
      )}
      {devices.length > 0 && (
        <button
          onClick={() => act("all", "/api/admin/devices",
            "Remove every paired device, including this one? Everyone will need the password again.")}
          disabled={busy === "all"}
          className="btn-outline !min-h-[36px] mt-3 text-sm"
        >
          {busy === "all" ? "Removing…" : "Remove all devices"}
        </button>
      )}
    </section>
  );
}

/**
 * Set a PIN, or change one you already have.
 *
 * Also the way back for anyone who tapped "Skip for now" at sign-in — without
 * this the only route to a PIN was a screen you see once.
 */
function PinEditor({ hasPin, onSaved }: { hasPin: boolean; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const reset = () => { setCurrentPin(""); setPin(""); setPin2(""); setError(null); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (pin !== pin2) throw new Error("The two PINs do not match");
      const r = await fetch("/api/auth/staff/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(hasPin ? { pin, currentPin } : { pin }),
      });
      if (!r.ok) throw new Error((await r.json()).error ?? "Could not save the PIN");
      reset();
      setOpen(false);
      setDone(true);
      setTimeout(() => setDone(false), 2500);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save the PIN");
    } finally {
      setBusy(false);
    }
  };

  const digits = (id: string, label: string, value: string, set: (v: string) => void) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        className="input !min-h-[38px] text-center tracking-[0.35em] font-bold"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </div>
  );

  if (!open)
    return (
      <div className="flex items-center gap-3 mb-3 pb-3 border-b border-cream-200">
        <span className="text-sm text-maroon-800/70 flex-1">
          {hasPin ? "A PIN is set for this account." : "No PIN yet — set one to skip the password on paired devices."}
        </span>
        {done && <span className="text-sm font-semibold text-leaf-600">Saved ✓</span>}
        <button onClick={() => { reset(); setOpen(true); }} className="btn-outline !min-h-[36px] text-sm shrink-0">
          {hasPin ? "Change PIN" : "Set a PIN"}
        </button>
      </div>
    );

  return (
    <form onSubmit={save} className="mb-3 pb-3 border-b border-cream-200 space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {/* Required when replacing a PIN, so walking up to an unlocked
            dashboard is not enough to change it. */}
        {hasPin && digits("curPin", "Current PIN", currentPin, setCurrentPin)}
        {digits("chgPin", hasPin ? "New PIN (4–6)" : "PIN (4–6 digits)", pin, setPin)}
        {digits("chgPin2", "Confirm", pin2, setPin2)}
      </div>
      <ErrorBox message={error} />
      <div className="flex gap-2">
        <button type="submit" disabled={busy || pin.length < 4 || (hasPin && currentPin.length < 4)} className="btn-primary !min-h-[36px] text-sm">
          {busy ? "Saving…" : hasPin ? "Save new PIN" : "Save PIN"}
        </button>
        <button type="button" onClick={() => { reset(); setOpen(false); }} className="btn-ghost !min-h-[36px] text-sm">
          Cancel
        </button>
      </div>
    </form>
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
