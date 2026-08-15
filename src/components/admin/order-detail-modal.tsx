"use client";

import { useEffect, useState } from "react";
import { ErrorBox, Modal } from "@/components/ui";
import { inr, istDateTime, parseJson } from "@/lib/utils";
import { REJECTION_REASONS, nextStatusesFor } from "@/lib/constants";
import { playTone } from "@/lib/sound";
import { PrintSheet } from "./print-sheet";

export interface AdminOrder {
  id: string; orderNumber: string; status: string; type: string; total: number;
  subtotal: number; discount: number; deliveryFee: number; packagingFee: number; tax: number;
  loyaltyCredit: number;
  paymentMethod: string; paymentStatus: string; placedAt: string; scheduledFor: string | null;
  instructions: string | null; cutlery: boolean; contactless: boolean;
  addressText: string | null; staffNotes: string | null; prepTimeMins: number;
  tableNo: string | null;
  contactName: string | null; contactPhone: string | null;
  couponCode: string | null;
  items: { id: string; nameSnapshot: string; variantName: string | null; addOnsJson: string; qty: number; unitPrice: number; lineTotal: number; instructions: string | null }[];
  user: { name: string | null; phone: string | null };
  // address/pincode/phone/taxPercent print the bill header. Optional because a
  // PATCH response echoes the order without its branch relation.
  branch: { name: string; slug: string; address?: string; pincode?: string; phone?: string; taxPercent?: number };
  deliveryAgent: { user: { name: string | null } } | null;
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
  const [showSettle, setShowSettle] = useState(false);
  const [printing, setPrinting] = useState<"bill" | "kot" | null>(null);

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
      // Audible confirmation matters on a tablet held at arm's length, where
      // the row you just changed may already have scrolled out of sight.
      playTone((body as { status?: string }).status === "READY" ? "ready" : "success");
      onChanged({ ...order, ...d.order });
    } catch (e) {
      playTone("error");
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
          {/* A different receiver at the address — call this number, not the
              account holder, who may not be there. */}
          {order.contactPhone && (
            <p className="rounded-lg bg-mustard-100 px-3 py-2 font-semibold">
              📞 Deliver to {order.contactName ?? "contact"}:{" "}
              <a className="underline" href={`tel:${order.contactPhone}`}>{order.contactPhone}</a>
            </p>
          )}
          <p>
            {order.type === "DINE_IN"
              ? "🍽️ Dine-in (counter)"
              : order.type === "PICKUP"
                ? "🛍️ Self-pickup"
                : `🛵 ${order.addressText ?? "Delivery"}`}
            {order.contactless && " · Contactless"}
          </p>
          <p>💳 {order.paymentMethod} · {order.paymentStatus} {order.couponCode && `· 🎟️ ${order.couponCode}`}</p>
          {/* The exact stamp, not "12 min ago" — this is the figure that has to
              match the bill when a customer queries a charge. */}
          <p className="text-maroon-800/70">🕒 Placed {istDateTime(order.placedAt)} IST</p>
          {order.scheduledFor && <p>⏰ Scheduled: {istDateTime(order.scheduledFor)}</p>}
          {order.instructions && <p className="rounded-lg bg-mustard-100 px-3 py-2">📣 “{order.instructions}”</p>}
          <p className="text-maroon-800/50">Cutlery: {order.cutlery ? "yes" : "no"}</p>
        </section>

        {/* On-screen item list. Printing goes through PrintSheet, which renders
            its own bill and kitchen ticket. */}
        <section className={kitchenMode ? "text-lg" : "text-sm"}>
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

        {/* An unpaid dine-in tab is still open even after it is marked served,
            so billing and adding another round must be reachable from here —
            not only from the Counter screen. */}
        {!kitchenMode && order.type === "DINE_IN" && order.paymentStatus !== "PAID" && (
          <div className="rounded-xl border border-mustard-400 bg-mustard-100 p-3 no-print">
            <p className="text-sm font-bold text-maroon-700">
              🍽️ Open tab{order.tableNo ? ` · Table ${order.tableNo}` : ""} — {inr(order.total)} unpaid
            </p>
            <div className="grid grid-cols-2 gap-2 mt-2">
              <a
                href={`/admin/counter?tab=${order.id}`}
                className="btn-secondary !min-h-[40px] text-center"
              >
                ➕ Add items
              </a>
              <button
                disabled={busy}
                onClick={() => setShowSettle(true)}
                className="btn-primary !min-h-[40px]"
              >
                💳 Bill &amp; settle
              </button>
            </div>
            {showSettle && (
              <div className="mt-3 border-t border-mustard-400/60 pt-3">
                <span className="label">Paid by</span>
                <div className="flex gap-2">
                  {(["CASH", "ONLINE"] as const).map((m) => (
                    <button
                      key={m}
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        setError(null);
                        try {
                          const r = await fetch(`/api/admin/counter/tabs/${order.id}`, {
                            method: "PATCH",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ paymentMethod: m }),
                          });
                          const d = await r.json();
                          if (!r.ok) throw new Error(d.error);
                          onChanged({ ...order, paymentStatus: "PAID", status: "DELIVERED" });
                        } catch (e) {
                          setError(e instanceof Error ? e.message : "Could not settle the tab");
                        } finally {
                          setBusy(false);
                          setShowSettle(false);
                        }
                      }}
                      className="chip"
                    >
                      {m === "CASH" ? "💵 Cash" : "📱 UPI / Card"}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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
            <button onClick={() => setPrinting("bill")} className="btn-secondary text-sm">🧾 Bill</button>
            <button onClick={() => setPrinting("kot")} className="btn-ghost text-sm">👨‍🍳 KOT</button>
            {order.user.phone && <a href={`tel:${order.user.phone}`} className="btn-ghost text-sm">📞 Call customer</a>}
            <button onClick={() => setShowRefund((v) => !v)} className="btn-ghost text-sm">💰 Refund</button>
          </div>
        )}

        {printing && (
          // Keyed: PrintSheet keeps the chosen variant in its own state, so
          // without this, re-opening it as a KOT would show the last bill.
          <PrintSheet key={printing} order={order} variant={printing} onClose={() => setPrinting(null)} />
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
