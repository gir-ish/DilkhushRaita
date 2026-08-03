"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { parseJson } from "@/lib/utils";
import {
  AdminOrder,
  OrderDetailModal,
  beep,
} from "@/components/admin/order-detail-modal";

/** Kitchen Display System — large text, simple controls, oldest first. */
export default function KitchenPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const [, forceTick] = useState(0);
  const prevIds = useRef<Set<string> | null>(null);

  const load = useCallback(() => {
    fetch("/api/admin/orders?active=1")
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        const list: AdminOrder[] = d.orders
          .filter((o: AdminOrder) => ["PLACED", "ACCEPTED", "PREPARING", "READY"].includes(o.status))
          .sort((a: AdminOrder, b: AdminOrder) => +new Date(a.placedAt) - +new Date(b.placedAt));
        const ids = new Set<string>(list.map((o) => o.id));
        if (prevIds.current && [...ids].some((id) => !prevIds.current!.has(id))) beep();
        prevIds.current = ids;
        setOrders(list);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000);
    const tick = setInterval(() => forceTick((n) => n + 1), 30000); // refresh elapsed times
    return () => { clearInterval(t); clearInterval(tick); };
  }, [load]);

  const quickAct = async (o: AdminOrder, status: string) => {
    await fetch(`/api/admin/orders/${o.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "status", status }),
    });
    load();
  };

  return (
    <div>
      <h1 className="font-display text-3xl font-bold text-maroon-700 mb-4">👨‍🍳 Kitchen</h1>
      <ErrorBox message={error} />
      {!orders ? (
        <Spinner label="Loading queue…" />
      ) : orders.length === 0 ? (
        <p className="text-center py-20 text-2xl text-maroon-800/40">All caught up! 🎉</p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
          {orders.map((o) => {
            const mins = Math.floor((Date.now() - +new Date(o.placedAt)) / 60000);
            const late = mins > o.prepTimeMins;
            return (
              <article
                key={o.id}
                className={`card p-4 border-t-8 ${
                  o.status === "PLACED" ? "border-t-red-600" :
                  o.status === "READY" ? "border-t-leaf-500" :
                  late ? "border-t-red-600" : "border-t-mustard-400"
                }`}
              >
                <div className="flex justify-between items-center">
                  <button onClick={() => setSelected(o)} className="text-2xl font-bold underline decoration-dotted">
                    {o.orderNumber.slice(-6)}
                  </button>
                  <span className={`text-xl font-bold ${late ? "text-red-600" : "text-maroon-800/60"}`}>
                    ⏱ {mins}m {late && "· LATE!"}
                  </span>
                </div>
                <p className="text-sm font-semibold text-maroon-800/60 mt-0.5">
                  {o.type === "PICKUP" ? "🛍️ PICKUP" : "🛵 DELIVERY"} · {o.status.replace(/_/g, " ")}
                  {o.scheduledFor && <span className="text-red-600"> · ⏰ {new Date(o.scheduledFor).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span>}
                </p>
                <ul className="mt-3 space-y-2 text-xl leading-snug">
                  {o.items.map((it) => {
                    const addOns = parseJson<{ name: string }[]>(it.addOnsJson, []);
                    return (
                      <li key={it.id}>
                        <strong>{it.qty} ×</strong> {it.nameSnapshot}
                        {it.variantName && ` (${it.variantName})`}
                        {addOns.length > 0 && (
                          <span className="block text-base text-maroon-800/70">+ {addOns.map((a) => a.name).join(", ")}</span>
                        )}
                        {it.instructions && (
                          <span className="block text-base text-red-700 font-semibold">“{it.instructions}”</span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {o.instructions && (
                  <p className="mt-2 text-base bg-mustard-100 rounded-lg px-3 py-2">📣 {o.instructions}</p>
                )}
                <div className="mt-4">
                  {o.status === "ACCEPTED" && (
                    <button onClick={() => quickAct(o, "PREPARING")} className="btn-primary w-full !py-4 !text-xl">
                      🍳 Start preparing
                    </button>
                  )}
                  {o.status === "PREPARING" && (
                    <button onClick={() => quickAct(o, "READY")} className="btn-primary w-full !py-4 !text-xl !bg-leaf-600">
                      ✅ Ready
                    </button>
                  )}
                  {o.status === "PLACED" && (
                    <p className="text-center text-base text-maroon-800/50">Waiting for acceptance…</p>
                  )}
                  {o.status === "READY" && (
                    <p className="text-center text-base font-bold text-leaf-600">Waiting for handover 🛍️</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
      {selected && (
        <OrderDetailModal order={selected} kitchenMode onClose={() => setSelected(null)} onChanged={() => { setSelected(null); load(); }} />
      )}
    </div>
  );
}
