"use client";

import { useEffect, useState } from "react";
import { ErrorBox, Modal } from "@/components/ui";
import { inr, parseJson } from "@/lib/utils";
import { REJECTION_REASONS, nextStatusesFor } from "@/lib/constants";

export interface AdminOrder {
  id: string; orderNumber: string; status: string; type: string; total: number;
  subtotal: number; discount: number; deliveryFee: number; packagingFee: number; tax: number;
  loyaltyCredit: number;
  paymentMethod: string; paymentStatus: string; placedAt: string; scheduledFor: string | null;
  instructions: string | null; cutlery: boolean; contactless: boolean;
  addressText: string | null; staffNotes: string | null; prepTimeMins: number;
  couponCode: string | null;
  items: { id: string; nameSnapshot: string; variantName: string | null; addOnsJson: string; qty: number; lineTotal: number; instructions: string | null }[];
  user: { name: string | null; phone: string | null };
  branch: { name: string; slug: string };
  deliveryAgent: { user: { name: string | null } } | null;
}

export function beep() {
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.connect(g);
    g.connect(ctx.destination);
    o.frequency.value = 880;
    g.gain.setValueAtTime(0.4, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.start();
    o.stop(ctx.currentTime + 0.6);
  } catch {}
}

export function OrderDetailModal({
  order, onClose, onChanged, kitchenMode,
}: {
  order: AdminOrder;
  onClose: () => void;
  onChanged: (o: AdminOrder) => void;
  kitchenMode?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prep, setPrep] = useState(order.prepTimeMins);
  const [rejectReason, setRejectReason] = useState<string>(REJECTION_REASONS[0]);
  const [agents, setAgents] = useState<{ id: string; name: string | null }[]>([]);
  const [refund, setRefund] = useState({ amount: 0, mode: "STORE_CREDIT", reason: "" });
  const [showRefund, setShowRefund] = useState(false);

  useEffect(() => {
    if (!kitchenMode)
      fetch("/api/admin/agents").then((r) => (r.ok ? r.json() : { agents: [] })).then((d) => setAgents(d.agents ?? []));
  }, [kitchenMode]);

  const act = async (body: object) => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/orders/${order.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      onChanged({ ...order, ...d.order });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(false);
    }
  };

  // Dine-in and pickup orders never go out for delivery, so those buttons are
  // not offered at all rather than shown and then rejected by the server.
  const next = nextStatusesFor(order.status, order.type);

  return (
    <Modal open onClose={onClose} title={`${order.orderNumber} · ${order.status.replace(/_/g, " ")}`} wide>
      <div className="space-y-4">
        <section className="text-sm space-y-1 no-print">
          <p><strong>{order.user.name ?? "Customer"}</strong> · {order.user.phone && <a className="underline" href={`tel:${order.user.phone}`}>{order.user.phone}</a>}</p>
          <p>
            {order.type === "DINE_IN"
              ? "🍽️ Dine-in (counter)"
              : order.type === "PICKUP"
                ? "🛍️ Self-pickup"
                : `🛵 ${order.addressText ?? "Delivery"}`}
            {order.contactless && " · Contactless"}
          </p>
          <p>💳 {order.paymentMethod} · {order.paymentStatus} {order.couponCode && `· 🎟️ ${order.couponCode}`}</p>
          {order.scheduledFor && <p>⏰ Scheduled: {new Date(order.scheduledFor).toLocaleString("en-IN")}</p>}
          {order.instructions && <p className="rounded-lg bg-mustard-100 px-3 py-2">📣 “{order.instructions}”</p>}
          <p className="text-maroon-800/50">Cutlery: {order.cutlery ? "yes" : "no"}</p>
        </section>

        {/* Kitchen ticket: order no, items, add-ons, instructions, type, time — no payment/customer details */}
        <section className={kitchenMode ? "text-lg" : "text-sm"}>
          <div className="hidden print:block text-sm font-bold mb-2">
            {order.orderNumber} · {order.type} · {new Date(order.placedAt).toLocaleTimeString("en-IN")}
            {order.scheduledFor && ` · SCHEDULED ${new Date(order.scheduledFor).toLocaleString("en-IN")}`}
          </div>
          <table className="w-full">
            <tbody>
              {order.items.map((it) => {
                const addOns = parseJson<{ name: string }[]>(it.addOnsJson, []);
                return (
                  <tr key={it.id} className="border-t border-cream-200">
                    <td className="py-2 pr-2 font-bold whitespace-nowrap align-top">{it.qty} ×</td>
                    <td className="py-2 w-full">
                      {it.nameSnapshot}
                      {it.variantName && <span className="text-maroon-800/60"> ({it.variantName})</span>}
                      {addOns.length > 0 && <span className="block text-xs text-maroon-800/60">+ {addOns.map((a) => a.name).join(", ")}</span>}
                      {it.instructions && <span className="block text-xs italic text-red-700">“{it.instructions}”</span>}
                    </td>
                    {!kitchenMode && <td className="py-2 text-right whitespace-nowrap no-print">{inr(it.lineTotal)}</td>}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!kitchenMode && (
            <p className="text-right font-bold border-t border-cream-200 pt-2 mt-1 no-print">
              Total {inr(order.total)}
              <span className="font-normal text-xs text-maroon-800/50"> (items {inr(order.subtotal)} − disc {inr(order.discount + order.loyaltyCredit)} + fees {inr(order.deliveryFee + order.packagingFee + order.tax)})</span>
            </p>
          )}
        </section>

        <ErrorBox message={error} />

        {order.status === "PLACED" && !kitchenMode && (
          <div className="space-y-3 no-print">
            <div className="flex items-center gap-2">
              <label htmlFor="prep" className="text-sm font-semibold">Prep time</label>
              <input id="prep" type="number" min={5} max={120} className="input !w-24" value={prep} onChange={(e) => setPrep(+e.target.value)} />
              <span className="text-sm">min</span>
              <button disabled={busy} onClick={() => act({ action: "accept", prepTimeMins: prep })} className="btn-primary flex-1">
                ✅ Accept
              </button>
            </div>
            <div className="flex items-center gap-2">
              <select className="input flex-1" value={rejectReason} onChange={(e) => setRejectReason(e.target.value)} aria-label="Rejection reason">
                {REJECTION_REASONS.map((r) => <option key={r}>{r}</option>)}
              </select>
              <button disabled={busy} onClick={() => act({ action: "reject", reason: rejectReason })} className="btn-outline !text-red-700 !border-red-700">
                Reject
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-2 no-print">
          {next
            .filter((s) => !["REJECTED", "CANCELLED", "ACCEPTED", "REFUND_INITIATED", "REFUNDED"].includes(s))
            .filter((s) => (kitchenMode ? ["PREPARING", "READY"].includes(s) : true))
            .map((s) => (
              <button
                key={s}
                disabled={busy}
                onClick={() => act({ action: "status", status: s })}
                className={kitchenMode ? "btn-primary flex-1 !py-5 !text-xl" : "btn-secondary"}
              >
                → {s.replace(/_/g, " ")}
              </button>
            ))}
          {!kitchenMode && next.includes("CANCELLED" as never) && order.status !== "PLACED" && (
            <button disabled={busy} onClick={() => { if (confirm("Cancel this order?")) act({ action: "status", status: "CANCELLED" }); }} className="btn-ghost !text-red-700">
              Cancel order
            </button>
          )}
          {!kitchenMode && ["REJECTED", "CANCELLED"].includes(order.status) && (
            <button disabled={busy} onClick={() => act({ action: "status", status: "REFUND_INITIATED" })} className="btn-secondary">
              → REFUND INITIATED
            </button>
          )}
          {!kitchenMode && order.status === "REFUND_INITIATED" && (
            <button disabled={busy} onClick={() => act({ action: "status", status: "REFUNDED" })} className="btn-secondary">
              → REFUNDED
            </button>
          )}
        </div>

        {!kitchenMode && order.type === "DELIVERY" && ["ACCEPTED", "PREPARING", "READY"].includes(order.status) && agents.length > 0 && (
          <div className="flex items-center gap-2 no-print">
            <label className="text-sm font-semibold shrink-0" htmlFor="agent">Assign agent</label>
            <select id="agent" className="input" defaultValue="" onChange={(e) => e.target.value && act({ action: "assign", agentId: e.target.value })}>
              <option value="" disabled>Choose…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        {!kitchenMode && (
          <div className="flex flex-wrap gap-2 border-t border-cream-200 pt-3 no-print">
            <button onClick={() => window.print()} className="btn-ghost text-sm">🖨️ Print ticket</button>
            {order.user.phone && <a href={`tel:${order.user.phone}`} className="btn-ghost text-sm">📞 Call customer</a>}
            <button onClick={() => setShowRefund((v) => !v)} className="btn-ghost text-sm">💰 Refund</button>
          </div>
        )}

        {showRefund && (
          <div className="rounded-xl border border-cream-300 p-3 space-y-2 no-print">
            <div className="grid grid-cols-2 gap-2">
              <input type="number" min={1} max={order.total} className="input" placeholder={`Amount (max ${order.total})`} value={refund.amount || ""} onChange={(e) => setRefund({ ...refund, amount: +e.target.value })} aria-label="Refund amount" />
              <select className="input" value={refund.mode} onChange={(e) => setRefund({ ...refund, mode: e.target.value })} aria-label="Refund mode">
                <option value="STORE_CREDIT">Store credit</option>
                <option value="LOYALTY_POINTS">Loyalty points</option>
                <option value="CASH">Cash</option>
                <option value="COUPON">Coupon</option>
                <option value="REPLACEMENT">Replacement</option>
              </select>
            </div>
            <input className="input" placeholder="Reason (required)" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} aria-label="Refund reason" />
            <button
              disabled={busy || refund.amount < 1 || refund.reason.length < 3}
              onClick={() => act({ action: "refund", ...refund })}
              className="btn-primary w-full"
            >
              Issue refund
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
