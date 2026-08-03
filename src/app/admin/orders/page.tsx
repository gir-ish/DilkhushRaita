"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr, timeAgo } from "@/lib/utils";
import { STATUS_TRANSITIONS } from "@/lib/constants";
import {
  AdminOrder,
  OrderDetailModal,
  beep,
} from "@/components/admin/order-detail-modal";

export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<AdminOrder[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [activeOnly, setActiveOnly] = useState(true);
  const [selected, setSelected] = useState<AdminOrder | null>(null);
  const prevPlacedIds = useRef<Set<string> | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (status !== "all") params.set("status", status);
    if (activeOnly && status === "all") params.set("active", "1");
    fetch(`/api/admin/orders?${params}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        const list: AdminOrder[] = d.orders;
        const placedNow = new Set(list.filter((o) => o.status === "PLACED").map((o) => o.id));
        if (prevPlacedIds.current) {
          const fresh = [...placedNow].filter((id) => !prevPlacedIds.current!.has(id));
          if (fresh.length > 0) {
            beep();
            if (typeof Notification !== "undefined" && Notification.permission === "granted")
              new Notification("🆕 New order!", { body: `${fresh.length} new order(s) waiting for acceptance` });
          }
        }
        prevPlacedIds.current = placedNow;
        setOrders(list);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [q, status, activeOnly]);

  useEffect(() => {
    load();
    const t = setInterval(load, 10000); // live queue via polling
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if ("Notification" in window && Notification.permission === "default")
      Notification.requestPermission();
  }, []);

  return (
    <div>
      <div className="flex flex-wrap gap-2 items-center mb-4 no-print">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mr-auto">Orders</h1>
        <input
          type="search"
          className="input !w-56"
          placeholder="Order no / name / phone"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search orders"
        />
        <select className="input !w-auto" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status filter">
          <option value="all">All statuses</option>
          {Object.keys(STATUS_TRANSITIONS).concat("DELIVERED").map((s) => (
            <option key={s} value={s}>{s.replace(/_/g, " ")}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} />
          Active only
        </label>
      </div>

      <ErrorBox message={error} />
      {!orders ? (
        <Spinner label="Loading orders…" />
      ) : orders.length === 0 ? (
        <p className="text-center py-16 text-maroon-800/50">No orders match.</p>
      ) : (
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
          {orders.map((o) => (
            <button
              key={o.id}
              onClick={() => setSelected(o)}
              className={`card p-4 text-left hover:shadow-lift transition border-l-4 ${
                o.status === "PLACED" ? "border-l-red-600 animate-pulse" :
                ["PREPARING", "ACCEPTED"].includes(o.status) ? "border-l-mustard-400" :
                o.status === "DELIVERED" ? "border-l-leaf-500" : "border-l-cream-300"
              }`}
            >
              <div className="flex justify-between items-start">
                <span className="font-bold">{o.orderNumber}</span>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-cream-200">{o.status.replace(/_/g, " ")}</span>
              </div>
              <p className="text-sm mt-1">
                {o.user.name ?? "Customer"} · {o.type === "PICKUP" ? "🛍️ Pickup" : "🛵 Delivery"} · <strong>{inr(o.total)}</strong> ({o.paymentMethod})
              </p>
              <p className="text-xs text-maroon-800/60 truncate mt-1">
                {o.items.map((i) => `${i.qty}×${i.nameSnapshot}`).join(", ")}
              </p>
              <p className="text-xs text-maroon-800/40 mt-1">
                {o.branch.name} · {timeAgo(o.placedAt)}
                {o.scheduledFor && ` · ⏰ ${new Date(o.scheduledFor).toLocaleString("en-IN", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}`}
              </p>
            </button>
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
