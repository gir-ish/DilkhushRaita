"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";

interface BranchFull {
  id: string; slug: string; name: string; address: string; pincode: string;
  lat: number; lng: number; phone: string; email: string | null;
  isOpenOverride: string; onlineOrderingEnabled: boolean;
  deliveryEnabled: boolean; pickupEnabled: boolean;
  deliveryRadiusKm: number; serviceablePincodes: string[];
  minOrderValue: number; baseDeliveryFee: number; perKmFee: number; freeKm: number;
  freeDeliveryAbove: number | null; packagingFee: number; taxPercent: number;
  prepTimeMins: number; busyMode: boolean; busyExtraMins: number;
  busyPauseDelivery: boolean; busyPauseScheduled: boolean; maxActiveOrders: number;
  hours: { dayOfWeek: number; openTime: string; closeTime: string; closed: boolean }[];
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default function AdminBranchesPage() {
  const [branches, setBranches] = useState<BranchFull[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/branches")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setBranches(d.branches);
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-maroon-700 mb-4">Branches</h1>
      <ErrorBox message={error} />
      {!branches ? (
        <Spinner label="Loading branches…" />
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          {branches.map((b) => (
            <BranchEditor key={b.id} branch={b} onSaved={load} />
          ))}
        </div>
      )}
    </div>
  );
}

function BranchEditor({ branch, onSaved }: { branch: BranchFull; onSaved: () => void }) {
  const [f, setF] = useState({ ...branch, pincodesText: branch.serviceablePincodes.join(", ") });
  const [hours, setHours] = useState(
    Array.from({ length: 7 }, (_, d) => {
      const h = branch.hours.find((x) => x.dayOfWeek === d);
      return h ?? { dayOfWeek: d, openTime: "11:00", closeTime: "23:00", closed: false };
    })
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/branches/${branch.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: f.name, address: f.address, pincode: f.pincode,
          lat: +f.lat, lng: +f.lng, phone: f.phone,
          isOpenOverride: f.isOpenOverride,
          onlineOrderingEnabled: f.onlineOrderingEnabled,
          deliveryEnabled: f.deliveryEnabled, pickupEnabled: f.pickupEnabled,
          deliveryRadiusKm: +f.deliveryRadiusKm,
          serviceablePincodes: f.pincodesText.split(/[,\s]+/).filter((p) => /^\d{6}$/.test(p)),
          minOrderValue: +f.minOrderValue, baseDeliveryFee: +f.baseDeliveryFee,
          perKmFee: +f.perKmFee, freeKm: +f.freeKm,
          freeDeliveryAbove: f.freeDeliveryAbove === null || (f.freeDeliveryAbove as unknown) === "" ? null : +f.freeDeliveryAbove,
          packagingFee: +f.packagingFee, taxPercent: +f.taxPercent,
          prepTimeMins: +f.prepTimeMins, busyMode: f.busyMode, busyExtraMins: +f.busyExtraMins,
          busyPauseDelivery: f.busyPauseDelivery, busyPauseScheduled: f.busyPauseScheduled,
          maxActiveOrders: +f.maxActiveOrders,
          hours,
        }),
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

  const id = (s: string) => `${branch.slug}-${s}`;

  return (
    <section className="card p-4 space-y-3" aria-label={`Settings for ${branch.name}`}>
      <div className="flex items-center justify-between">
        <h2 className="font-display text-xl font-bold text-maroon-700">{branch.name}</h2>
        <label className="flex items-center gap-2 text-sm font-semibold cursor-pointer">
          <input type="checkbox" className="h-5 w-5 accent-maroon-600" checked={f.busyMode} onChange={(e) => setF({ ...f, busyMode: e.target.checked })} />
          🔥 Busy mode
        </label>
      </div>

      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="col-span-2">
          <label className="label" htmlFor={id("name")}>Name</label>
          <input id={id("name")} className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor={id("addr")}>Address</label>
          <input id={id("addr")} className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("phone")}>Phone</label>
          <input id={id("phone")} className="input" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("pin")}>PIN code</label>
          <input id={id("pin")} className="input" value={f.pincode} onChange={(e) => setF({ ...f, pincode: e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("lat")}>Latitude</label>
          <input id={id("lat")} type="number" step="any" className="input" value={f.lat} onChange={(e) => setF({ ...f, lat: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("lng")}>Longitude</label>
          <input id={id("lng")} type="number" step="any" className="input" value={f.lng} onChange={(e) => setF({ ...f, lng: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("open")}>Open status</label>
          <select id={id("open")} className="input" value={f.isOpenOverride} onChange={(e) => setF({ ...f, isOpenOverride: e.target.value })}>
            <option value="AUTO">Follow opening hours</option>
            <option value="FORCE_OPEN">Force open</option>
            <option value="FORCE_CLOSED">Temporarily closed</option>
          </select>
        </div>
        <div>
          <label className="label" htmlFor={id("prep")}>Prep time (min)</label>
          <input id={id("prep")} type="number" className="input" value={f.prepTimeMins} onChange={(e) => setF({ ...f, prepTimeMins: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("minorder")}>Min order (₹)</label>
          <input id={id("minorder")} type="number" className="input" value={f.minOrderValue} onChange={(e) => setF({ ...f, minOrderValue: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("fee")}>Base delivery fee (₹)</label>
          <input id={id("fee")} type="number" className="input" value={f.baseDeliveryFee} onChange={(e) => setF({ ...f, baseDeliveryFee: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("perkm")}>Per-km fee after {f.freeKm} km (₹)</label>
          <input id={id("perkm")} type="number" className="input" value={f.perKmFee} onChange={(e) => setF({ ...f, perKmFee: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("freeabove")}>Free delivery above (₹, blank = never)</label>
          <input id={id("freeabove")} type="number" className="input" value={f.freeDeliveryAbove ?? ""} onChange={(e) => setF({ ...f, freeDeliveryAbove: e.target.value === "" ? null : +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("radius")}>Delivery radius (km)</label>
          <input id={id("radius")} type="number" step="0.5" className="input" value={f.deliveryRadiusKm} onChange={(e) => setF({ ...f, deliveryRadiusKm: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("pack")}>Packaging fee (₹)</label>
          <input id={id("pack")} type="number" className="input" value={f.packagingFee} onChange={(e) => setF({ ...f, packagingFee: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("tax")}>Tax %</label>
          <input id={id("tax")} type="number" step="0.5" className="input" value={f.taxPercent} onChange={(e) => setF({ ...f, taxPercent: +e.target.value })} />
        </div>
        <div>
          <label className="label" htmlFor={id("cap")}>Max active orders</label>
          <input id={id("cap")} type="number" className="input" value={f.maxActiveOrders} onChange={(e) => setF({ ...f, maxActiveOrders: +e.target.value })} />
        </div>
        <div className="col-span-2">
          <label className="label" htmlFor={id("pins")}>Serviceable PIN codes (comma-separated)</label>
          <input id={id("pins")} className="input" value={f.pincodesText} onChange={(e) => setF({ ...f, pincodesText: e.target.value })} />
        </div>
      </div>

      <div className="flex flex-wrap gap-4 text-sm">
        {([
          ["onlineOrderingEnabled", "Online ordering"],
          ["deliveryEnabled", "Delivery"],
          ["pickupEnabled", "Pickup"],
        ] as const).map(([k, label]) => (
          <label key={k} className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={f[k] as boolean} onChange={(e) => setF({ ...f, [k]: e.target.checked })} />
            {label}
          </label>
        ))}
      </div>

      {f.busyMode && (
        <div className="rounded-xl bg-mustard-100 p-3 space-y-2 text-sm">
          <p className="font-semibold">Busy-mode behaviour</p>
          <div className="flex items-center gap-2">
            <label htmlFor={id("busyextra")}>Extra prep minutes</label>
            <input id={id("busyextra")} type="number" className="input !w-24 !min-h-[36px]" value={f.busyExtraMins} onChange={(e) => setF({ ...f, busyExtraMins: +e.target.value })} />
          </div>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={f.busyPauseDelivery} onChange={(e) => setF({ ...f, busyPauseDelivery: e.target.checked })} />
            Pause delivery (pickup only)
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={f.busyPauseScheduled} onChange={(e) => setF({ ...f, busyPauseScheduled: e.target.checked })} />
            Pause scheduled orders
          </label>
        </div>
      )}

      <details>
        <summary className="cursor-pointer font-semibold text-sm">Opening hours</summary>
        <div className="mt-2 space-y-1">
          {hours.map((h, i) => (
            <div key={h.dayOfWeek} className="flex items-center gap-2 text-sm">
              <span className="w-10 font-semibold">{DAYS[h.dayOfWeek]}</span>
              <input type="time" className="input !min-h-[36px] !w-auto" value={h.openTime} disabled={h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, openTime: e.target.value } : x)))} aria-label={`${DAYS[h.dayOfWeek]} opening time`} />
              <span>–</span>
              <input type="time" className="input !min-h-[36px] !w-auto" value={h.closeTime} disabled={h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, closeTime: e.target.value } : x)))} aria-label={`${DAYS[h.dayOfWeek]} closing time`} />
              <label className="flex items-center gap-1 text-xs">
                <input type="checkbox" checked={h.closed} onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, closed: e.target.checked } : x)))} />
                closed
              </label>
            </div>
          ))}
        </div>
      </details>

      <ErrorBox message={error} />
      <button onClick={save} disabled={busy} className="btn-primary w-full">
        {busy ? "Saving…" : saved ? "Saved ✓" : "Save branch settings"}
      </button>
    </section>
  );
}
