"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal, Spinner } from "@/components/ui";
import { inr } from "@/lib/utils";

interface CouponRow {
  id: string; code: string; name: string; description: string; rewardType: string;
  value: number; maxDiscount: number | null; minCartValue: number | null;
  firstOrderOnly: boolean; autoApply: boolean; active: boolean;
  perCustomerLimit: number; totalLimit: number | null;
  startAt: string | null; endAt: string | null;
  redemptionCount: number; totalSaved: number;
}
interface Tier {
  id?: string; name: string; minCompletedOrders: number; minLifetimeSpend: number;
  pointMultiplier: number; freeDelivery: boolean; discountPercent: number;
  benefitsText: string; sortOrder: number;
}

export default function MarketingPage() {
  const [coupons, setCoupons] = useState<CouponRow[] | null>(null);
  const [tiers, setTiers] = useState<Tier[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(() => {
    fetch("/api/admin/coupons")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setCoupons(d.coupons);
      })
      .catch((e) => setError(e.message));
    fetch("/api/admin/loyalty-tiers").then((r) => r.json()).then((d) => setTiers(d.tiers ?? []));
  }, []);
  useEffect(load, [load]);

  return (
    <div className="space-y-6">
      <section aria-label="Coupons">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-display text-2xl font-bold text-maroon-700">Coupons & campaigns</h1>
          <button onClick={() => setShowNew(true)} className="btn-primary !min-h-[38px]">+ New coupon</button>
        </div>
        <ErrorBox message={error} />
        {!coupons ? (
          <Spinner />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-maroon-800/50 border-b border-cream-200">
                  <th className="p-3">Code</th><th className="p-3">Offer</th><th className="p-3">Rules</th>
                  <th className="p-3">Used</th><th className="p-3">Discount given</th><th className="p-3">Status</th><th className="p-3"></th>
                </tr>
              </thead>
              <tbody>
                {coupons.map((c) => (
                  <tr key={c.id} className={`border-b border-cream-100 ${!c.active ? "opacity-50" : ""}`}>
                    <td className="p-3 font-mono font-bold">{c.code}</td>
                    <td className="p-3">
                      <span className="font-semibold">{c.name}</span>
                      <span className="block text-xs text-maroon-800/60">
                        {c.rewardType === "PERCENT" && `${c.value}% off${c.maxDiscount ? ` up to ${inr(c.maxDiscount)}` : ""}`}
                        {c.rewardType === "FLAT" && `${inr(c.value)} off`}
                        {c.rewardType === "FREE_DELIVERY" && "Free delivery"}
                        {c.rewardType === "FREE_ITEM" && "Free item"}
                      </span>
                    </td>
                    <td className="p-3 text-xs text-maroon-800/60">
                      {c.minCartValue ? `Min cart ${inr(c.minCartValue)} · ` : ""}
                      {c.firstOrderOnly ? "First order · " : ""}
                      {c.autoApply ? "Auto-applies · " : "Code required · "}
                      {c.perCustomerLimit}/customer{c.totalLimit ? ` · ${c.totalLimit} total` : ""}
                    </td>
                    <td className="p-3">{c.redemptionCount}×</td>
                    <td className="p-3">{inr(c.totalSaved)}</td>
                    <td className="p-3">
                      <span className={`text-xs font-bold ${c.active ? "text-leaf-600" : "text-red-700"}`}>
                        {c.active ? "ACTIVE" : "OFF"}
                      </span>
                    </td>
                    <td className="p-3">
                      <button
                        className="underline text-maroon-600"
                        onClick={async () => {
                          await fetch(`/api/admin/coupons/${c.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ active: !c.active }),
                          });
                          load();
                        }}
                      >
                        {c.active ? "Disable" : "Enable"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {tiers && <TierEditor tiers={tiers} onSaved={load} />}
      {showNew && <NewCouponModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
    </div>
  );
}

function NewCouponModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({
    code: "", name: "", description: "", rewardType: "PERCENT",
    value: 10, maxDiscount: "" as string | number, minCartValue: "" as string | number,
    firstOrderOnly: false, inactiveDays: "" as string | number,
    minCompletedOrders: "" as string | number,
    totalLimit: "" as string | number, perCustomerLimit: 1,
    autoApply: false, startAt: "", endAt: "",
    orderTypes: ["DELIVERY", "PICKUP"] as string[],
  });
  const [preview, setPreview] = useState<{ eligibleCustomers: number | string; exampleCart: number; exampleDiscount: number; maxLiability: number | null; warning: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadPreview = async () => {
    const p = new URLSearchParams({
      rewardType: f.rewardType,
      value: String(f.value || 0),
      ...(f.maxDiscount !== "" ? { maxDiscount: String(f.maxDiscount) } : {}),
      ...(f.minCartValue !== "" ? { minCartValue: String(f.minCartValue) } : {}),
      ...(f.firstOrderOnly ? { firstOrderOnly: "true" } : {}),
      ...(f.minCompletedOrders !== "" ? { minCompletedOrders: String(f.minCompletedOrders) } : {}),
      ...(f.inactiveDays !== "" ? { inactiveDays: String(f.inactiveDays) } : {}),
      ...(f.totalLimit !== "" ? { totalLimit: String(f.totalLimit) } : {}),
    });
    const r = await fetch(`/api/admin/coupons/preview?${p}`);
    if (r.ok) setPreview(await r.json());
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/coupons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: f.code, name: f.name, description: f.description,
          rewardType: f.rewardType, value: +f.value,
          maxDiscount: f.maxDiscount === "" ? null : +f.maxDiscount,
          minCartValue: f.minCartValue === "" ? null : +f.minCartValue,
          firstOrderOnly: f.firstOrderOnly,
          minCompletedOrders: f.minCompletedOrders === "" ? null : +f.minCompletedOrders,
          inactiveDays: f.inactiveDays === "" ? null : +f.inactiveDays,
          totalLimit: f.totalLimit === "" ? null : +f.totalLimit,
          perCustomerLimit: +f.perCustomerLimit,
          autoApply: f.autoApply,
          orderTypes: f.orderTypes,
          startAt: f.startAt ? new Date(f.startAt).toISOString() : null,
          endAt: f.endAt ? new Date(f.endAt).toISOString() : null,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="New coupon" wide>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <label className="label" htmlFor="c-code">Code *</label>
          <input id="c-code" className="input uppercase font-mono" maxLength={20} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
        </div>
        <div>
          <label className="label" htmlFor="c-name">Campaign name *</label>
          <input id="c-name" className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor="c-desc">Customer-facing description</label>
          <input id="c-desc" className="input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-type">Reward</label>
          <select id="c-type" className="input" value={f.rewardType} onChange={(e) => setF({ ...f, rewardType: e.target.value })}>
            <option value="PERCENT">Percentage off</option>
            <option value="FLAT">Flat ₹ off</option>
            <option value="FREE_DELIVERY">Free delivery</option>
          </select>
        </div>
        {f.rewardType !== "FREE_DELIVERY" && (
          <div>
            <label className="label" htmlFor="c-value">{f.rewardType === "PERCENT" ? "% off" : "₹ off"}</label>
            <input id="c-value" type="number" min={0} className="input" value={f.value} onChange={(e) => setF({ ...f, value: +e.target.value })} />
          </div>
        )}
        {f.rewardType === "PERCENT" && (
          <div>
            <label className="label" htmlFor="c-max">Max discount (₹)</label>
            <input id="c-max" type="number" className="input" value={f.maxDiscount} onChange={(e) => setF({ ...f, maxDiscount: e.target.value })} />
          </div>
        )}
        <div>
          <label className="label" htmlFor="c-mincart">Min cart value (₹)</label>
          <input id="c-mincart" type="number" className="input" value={f.minCartValue} onChange={(e) => setF({ ...f, minCartValue: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-total">Total redemption limit</label>
          <input id="c-total" type="number" className="input" placeholder="unlimited" value={f.totalLimit} onChange={(e) => setF({ ...f, totalLimit: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-per">Per-customer limit</label>
          <input id="c-per" type="number" min={1} className="input" value={f.perCustomerLimit} onChange={(e) => setF({ ...f, perCustomerLimit: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-minorders">Min completed orders</label>
          <input id="c-minorders" type="number" className="input" placeholder="any" value={f.minCompletedOrders} onChange={(e) => setF({ ...f, minCompletedOrders: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-inactive">Inactive for N days (win-back)</label>
          <input id="c-inactive" type="number" className="input" placeholder="—" value={f.inactiveDays} onChange={(e) => setF({ ...f, inactiveDays: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-start">Starts</label>
          <input id="c-start" type="datetime-local" className="input" value={f.startAt} onChange={(e) => setF({ ...f, startAt: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="c-end">Ends</label>
          <input id="c-end" type="datetime-local" className="input" value={f.endAt} onChange={(e) => setF({ ...f, endAt: e.target.value })} />
        </div>
        <div className="col-span-2 flex flex-wrap gap-4">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={f.firstOrderOnly} onChange={(e) => setF({ ...f, firstOrderOnly: e.target.checked })} />
            First order only
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={f.autoApply} onChange={(e) => setF({ ...f, autoApply: e.target.checked })} />
            Auto-apply (no code needed)
          </label>
          {(["DELIVERY", "PICKUP"] as const).map((t) => (
            <label key={t} className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                className="h-4 w-4 accent-maroon-600"
                checked={f.orderTypes.includes(t)}
                onChange={(e) =>
                  setF({ ...f, orderTypes: e.target.checked ? [...f.orderTypes, t] : f.orderTypes.filter((x) => x !== t) })
                }
              />
              {t.toLowerCase()}
            </label>
          ))}
        </div>
      </div>

      <div className="mt-4 space-y-3">
        <button onClick={loadPreview} className="btn-outline w-full">🔍 Preview impact</button>
        {preview && (
          <div className="rounded-xl bg-cream-100 p-3 text-sm space-y-1">
            <p>👥 Estimated eligible customers: <strong>{preview.eligibleCustomers}</strong></p>
            <p>🧾 Example: {inr(preview.exampleCart)} cart → <strong>{inr(preview.exampleDiscount)}</strong> off</p>
            <p>💸 Max campaign liability: <strong>{preview.maxLiability != null ? inr(preview.maxLiability) : "UNLIMITED"}</strong></p>
            {preview.warning && <p className="text-red-700">⚠️ {preview.warning}</p>}
          </div>
        )}
        <ErrorBox message={error} />
        <button onClick={save} disabled={busy || !f.code || !f.name} className="btn-primary w-full">
          {busy ? "Creating…" : "Create coupon"}
        </button>
      </div>
    </Modal>
  );
}

function TierEditor({ tiers: initial, onSaved }: { tiers: Tier[]; onSaved: () => void }) {
  const [tiers, setTiers] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setTiers(initial), [initial]);

  const set = (i: number, patch: Partial<Tier>) =>
    setTiers(tiers.map((t, j) => (j === i ? { ...t, ...patch } : t)));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/loyalty-tiers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tiers }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4" aria-label="Loyalty tiers">
      <h2 className="font-display text-xl font-bold text-maroon-700 mb-3">Loyalty tiers</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-maroon-800/50">
              <th className="p-2">Tier</th><th className="p-2">Min orders</th><th className="p-2">Min spend (₹)</th>
              <th className="p-2">Points ×</th><th className="p-2">Free delivery</th><th className="p-2">Auto-discount %</th><th className="p-2">Benefits text</th>
            </tr>
          </thead>
          <tbody>
            {tiers.map((t, i) => (
              <tr key={t.id ?? i} className="border-t border-cream-200">
                <td className="p-2"><input className="input !min-h-[36px]" value={t.name} onChange={(e) => set(i, { name: e.target.value })} aria-label="Tier name" /></td>
                <td className="p-2"><input type="number" className="input !min-h-[36px] !w-20" value={t.minCompletedOrders} onChange={(e) => set(i, { minCompletedOrders: +e.target.value })} aria-label="Minimum orders" /></td>
                <td className="p-2"><input type="number" className="input !min-h-[36px] !w-24" value={t.minLifetimeSpend} onChange={(e) => set(i, { minLifetimeSpend: +e.target.value })} aria-label="Minimum spend" /></td>
                <td className="p-2"><input type="number" step="0.5" className="input !min-h-[36px] !w-20" value={t.pointMultiplier} onChange={(e) => set(i, { pointMultiplier: +e.target.value })} aria-label="Point multiplier" /></td>
                <td className="p-2 text-center"><input type="checkbox" className="h-5 w-5 accent-maroon-600" checked={t.freeDelivery} onChange={(e) => set(i, { freeDelivery: e.target.checked })} aria-label="Free delivery benefit" /></td>
                <td className="p-2"><input type="number" className="input !min-h-[36px] !w-20" value={t.discountPercent} onChange={(e) => set(i, { discountPercent: +e.target.value })} aria-label="Automatic discount percent" /></td>
                <td className="p-2"><input className="input !min-h-[36px]" value={t.benefitsText} onChange={(e) => set(i, { benefitsText: e.target.value })} aria-label="Benefits description" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorBox message={error} />
      <button onClick={save} disabled={busy} className="btn-primary mt-3">
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save tiers"}
      </button>
    </section>
  );
}
