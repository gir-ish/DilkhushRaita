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
  // Needed to prefill the edit form; the list API returns the whole row.
  minCompletedOrders: number | null; inactiveDays: number | null;
  orderTypesJson: string;
  redemptionCount: number; totalSaved: number;
}

/** ISO → the "YYYY-MM-DDTHH:mm" a datetime-local input expects, in local time. */
function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
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
  const [editing, setEditing] = useState<CouponRow | null>(null);

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
                    <td className="p-3 whitespace-nowrap">
                      <button
                        className="underline text-maroon-600"
                        onClick={() => setEditing(c)}
                      >
                        Edit
                      </button>
                      <span className="text-maroon-800/30 px-2">·</span>
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

      <PointValueEditor />
      {tiers && <TierEditor tiers={tiers} onSaved={load} />}
      {showNew && <CouponModal onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); load(); }} />}
      {editing && (
        // Keyed so switching straight from one coupon to another refills the
        // form instead of keeping the first one's state.
        <CouponModal
          key={editing.id}
          coupon={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}

/** Create a coupon, or edit an existing one — same rules, same preview. */
function CouponModal({
  coupon,
  onClose,
  onSaved,
}: {
  coupon?: CouponRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!coupon;
  const [f, setF] = useState({
    code: coupon?.code ?? "",
    name: coupon?.name ?? "",
    description: coupon?.description ?? "",
    rewardType: coupon?.rewardType ?? "PERCENT",
    value: coupon?.value ?? 10,
    maxDiscount: (coupon?.maxDiscount ?? "") as string | number,
    minCartValue: (coupon?.minCartValue ?? "") as string | number,
    firstOrderOnly: coupon?.firstOrderOnly ?? false,
    inactiveDays: (coupon?.inactiveDays ?? "") as string | number,
    minCompletedOrders: (coupon?.minCompletedOrders ?? "") as string | number,
    totalLimit: (coupon?.totalLimit ?? "") as string | number,
    perCustomerLimit: coupon?.perCustomerLimit ?? 1,
    autoApply: coupon?.autoApply ?? false,
    startAt: toLocalInput(coupon?.startAt ?? null),
    endAt: toLocalInput(coupon?.endAt ?? null),
    orderTypes: (coupon
      ? (JSON.parse(coupon.orderTypesJson || '["DELIVERY","PICKUP"]') as string[])
      : ["DELIVERY", "PICKUP"]) as string[],
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
      const r = await fetch(
        editing ? `/api/admin/coupons/${coupon!.id}` : "/api/admin/coupons",
        {
        method: editing ? "PATCH" : "POST",
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
      }
      );
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={editing ? `Edit ${coupon!.code}` : "New coupon"} wide>
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
        {editing && coupon!.redemptionCount > 0 && (
          <p className="text-xs text-maroon-800/60">
            ⚠️ Already redeemed {coupon!.redemptionCount}× — edits apply to future
            orders only, and past redemptions keep the terms they were given.
          </p>
        )}
        <button onClick={save} disabled={busy || !f.code || !f.name} className="btn-primary w-full">
          {busy ? "Saving…" : editing ? "Save changes" : "Create coupon"}
        </button>
      </div>
    </Modal>
  );
}

/**
 * What a DilKhush point is worth. These three numbers multiply into every
 * order, so the editor shows the resulting cashback rate before you save —
 * "0.5" on its own does not read as "we give away 5% of revenue".
 */
function PointValueEditor() {
  const [f, setF] = useState<{ pointsPer10Rupees: number; pointValueRupees: number; minPointsToRedeem: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/loyalty-settings")
      .then((r) => r.json())
      .then((d) => d.settings && setF({
        pointsPer10Rupees: d.settings.pointsPer10Rupees,
        pointValueRupees: d.settings.pointValueRupees,
        minPointsToRedeem: d.settings.minPointsToRedeem,
      }))
      .catch(() => setError("Could not load point settings"));
  }, []);
  useEffect(load, [load]);

  if (!f) return null;

  const cashback = (f.pointsPer10Rupees * f.pointValueRupees) / 10;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/loyalty-settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card p-4" aria-label="Point value">
      <h2 className="font-display text-xl font-bold text-maroon-700 mb-1">DilKhush points</h2>
      <p className="text-sm text-maroon-800/60 mb-3">
        Applies to every branch, immediately. Point <em>balances</em> are stored as
        counts, so changing the value also changes what customers&apos; existing
        points are worth.
      </p>
      <div className="grid gap-3 sm:grid-cols-3 text-sm">
        <div>
          <label className="label" htmlFor="lp-earn">Points earned per ₹10 spent</label>
          <input id="lp-earn" type="number" step="0.1" min={0} className="input"
            value={f.pointsPer10Rupees}
            onChange={(e) => setF({ ...f, pointsPer10Rupees: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="lp-value">One point is worth (₹)</label>
          <input id="lp-value" type="number" step="0.05" min={0.01} className="input"
            value={f.pointValueRupees}
            onChange={(e) => setF({ ...f, pointValueRupees: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor="lp-min">Minimum points before redeeming</label>
          <input id="lp-min" type="number" step="10" min={1} className="input"
            value={f.minPointsToRedeem}
            onChange={(e) => setF({ ...f, minPointsToRedeem: +e.target.value })} />
        </div>
      </div>

      <div className="mt-3 rounded-xl bg-cream-100 p-3 text-sm">
        <p>
          💸 That is <strong>{(cashback * 100).toFixed(1)}% back</strong> on every order
          at the base tier — and <strong>{(cashback * 200).toFixed(1)}%</strong> for a
          2× tier. {f.minPointsToRedeem} points = {inr(f.minPointsToRedeem * f.pointValueRupees)}.
        </p>
        {cashback > 0.05 && (
          <p className="text-red-700 mt-1">
            ⚠️ Above 5% back before tier multipliers — check this against your margin.
          </p>
        )}
      </div>

      <ErrorBox message={error} />
      <button onClick={save} disabled={busy} className="btn-primary mt-3">
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save point value"}
      </button>
    </section>
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
