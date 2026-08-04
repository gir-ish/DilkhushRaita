"use client";

import { use, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { ErrorBox, Modal, Spinner } from "@/components/ui";
import { inr, parseJson, timeAgo } from "@/lib/utils";
import { useCart } from "@/components/cart-context";
import { useRouter } from "next/navigation";

const FLOW = ["PLACED", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"];
// Pickup and dine-in never leave the restaurant, so no delivery leg.
const PICKUP_FLOW = ["PLACED", "ACCEPTED", "PREPARING", "READY", "DELIVERED"];
const DEAD = ["REJECTED", "CANCELLED", "REFUND_INITIATED", "REFUNDED"];

interface OrderDto {
  id: string; orderNumber: string; status: string; statusLabel: string; type: string;
  placedAt: string; deliveredAt: string | null;
  etaMins: number | null; scheduledFor: string | null;
  addressText: string | null; instructions: string | null; contactless: boolean;
  contactName: string | null; contactPhone: string | null;
  subtotal: number; discount: number; deliveryFee: number; packagingFee: number;
  tax: number; loyaltyCredit: number; total: number; paymentMethod: string;
  paymentStatus: string; couponCode: string | null; rejectionReason: string | null;
  cancelReason: string | null; pointsEarned: number;
  items: { id: string; nameSnapshot: string; variantName: string | null; addOnsJson: string; qty: number; unitPrice: number; lineTotal: number }[];
  branch: { name: string; slug: string; phone: string; address: string };
  deliveryAgent: { user: { name: string | null; phone: string | null } } | null;
  refunds: { id: string; amount: number; mode: string; status: string }[];
  review: { overallRating: number } | null;
}

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const cart = useCart();
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/orders/${id}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setOrder(d.order);
      })
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 8000); // live status via polling
    return () => clearInterval(t);
  }, [load]);

  if (error) return (<><SiteHeader /><main className="max-w-lg mx-auto p-6"><ErrorBox message={error} /></main></>);
  if (!order) return (<><SiteHeader /><Spinner label="Loading order…" /></>);

  const flow = order.type === "DELIVERY" ? FLOW : PICKUP_FLOW;
  const dead = DEAD.includes(order.status);
  const stepIndex = flow.indexOf(order.status);
  // DELIVERED is the end of the flow, not a step still in progress — without
  // this the last step would pulse forever showing its number instead of a tick.
  const completed = order.status === "DELIVERED";

  const repeatOrder = () => {
    router.push(`/menu/${order.branch.slug}`);
  };

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-6 pb-16">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="font-display text-2xl font-bold text-maroon-700">
              Order {order.orderNumber}
            </h1>
            <p className="text-sm text-maroon-800/60">
              {order.branch.name} · placed {timeAgo(order.placedAt)}
            </p>
          </div>
          <button onClick={() => window.print()} className="btn-outline !min-h-[38px] !px-3 text-sm no-print">
            🧾 Invoice
          </button>
        </div>

        {/* Status */}
        <section className="card p-4 mt-4" aria-label="Order status" aria-live="polite">
          {dead ? (
            <div>
              <p className="font-bold text-red-700 text-lg">{order.statusLabel}</p>
              {(order.rejectionReason || order.cancelReason) && (
                <p className="text-sm text-maroon-800/70 mt-1">
                  {order.rejectionReason ?? order.cancelReason}
                </p>
              )}
              {order.refunds.length > 0 && (
                <p className="text-sm mt-2">
                  💰 Refund: {order.refunds.map((r) => `${inr(r.amount)} (${r.mode.replace("_", " ").toLowerCase()}, ${r.status.toLowerCase()})`).join(", ")}
                </p>
              )}
            </div>
          ) : (
            <ol className="space-y-3">
              {flow.map((s, i) => {
                const done = i < stepIndex || (completed && i === stepIndex);
                const current = i === stepIndex && !completed;
                return (
                  <li key={s} className="flex items-center gap-3">
                    <span
                      aria-hidden
                      className={`h-6 w-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0
                        ${done ? "bg-leaf-500 text-white" : current ? "bg-maroon-600 text-white animate-pulse" : "bg-cream-200 text-maroon-800/40"}`}
                    >
                      {done ? "✓" : i + 1}
                    </span>
                    <span className={i <= stepIndex ? "font-semibold" : "text-maroon-800/40"}>
                      {labelFor(s, order.type)}
                      {current && order.etaMins && (
                        <span className="text-sm font-normal text-maroon-800/60"> · ~{order.etaMins} min total</span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {completed && (
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-leaf-500/30 bg-leaf-50 px-4 py-3">
              <span
                aria-hidden
                className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-leaf-500 text-xl font-bold text-white"
              >
                ✓
              </span>
              <div>
                <p className="font-bold text-leaf-600">
                  {order.type === "DINE_IN" ? "Served" : order.type === "PICKUP" ? "Picked up" : "Delivered"}
                  {order.deliveredAt && (
                    <span className="font-normal text-maroon-800/60"> · {timeAgo(order.deliveredAt)}</span>
                  )}
                </p>
                <p className="text-sm text-maroon-800/70">
                  Thank you for ordering from {order.branch.name}!
                </p>
              </div>
            </div>
          )}
          {order.status === "DELIVERED" && order.pointsEarned > 0 && (
            <p className="mt-3 rounded-xl bg-mustard-100 px-3 py-2 text-sm font-semibold">
              🎉 You earned {order.pointsEarned} DilKhush points!
            </p>
          )}
        </section>

        {order.deliveryAgent && !dead && (
          <section className="card p-4 mt-4 flex items-center justify-between" aria-label="Delivery partner">
            <div>
              <p className="font-semibold">🛵 {order.deliveryAgent.user.name ?? "Delivery partner"}</p>
              <p className="text-sm text-maroon-800/60">is handling your order</p>
            </div>
            {order.deliveryAgent.user.phone && (
              <a href={`tel:${order.deliveryAgent.user.phone}`} className="btn-secondary !min-h-[38px]">Call</a>
            )}
          </section>
        )}

        {/* Items & bill (also serves as printable invoice) */}
        <section className="card p-4 mt-4" aria-label="Order details">
          <h2 className="font-semibold mb-2">Items</h2>
          <ul className="divide-y divide-cream-200 text-sm">
            {order.items.map((it) => {
              const addOns = parseJson<{ name: string }[]>(it.addOnsJson, []);
              return (
                <li key={it.id} className="py-2 flex justify-between gap-3">
                  <span>
                    {it.qty} × {it.nameSnapshot}
                    {it.variantName && <span className="text-maroon-800/60"> ({it.variantName})</span>}
                    {addOns.length > 0 && (
                      <span className="block text-xs text-maroon-800/50">
                        + {addOns.map((a) => a.name).join(", ")}
                      </span>
                    )}
                  </span>
                  <span className="font-medium shrink-0">{inr(it.lineTotal)}</span>
                </li>
              );
            })}
          </ul>
          <dl className="mt-3 space-y-1 text-sm border-t border-cream-200 pt-3">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{inr(order.subtotal)}</dd></div>
            {order.discount > 0 && (
              <div className="flex justify-between text-leaf-600"><dt>Discount {order.couponCode && `(${order.couponCode})`}</dt><dd>−{inr(order.discount)}</dd></div>
            )}
            {order.type === "DELIVERY" && <div className="flex justify-between"><dt>Delivery</dt><dd>{inr(order.deliveryFee)}</dd></div>}
            <div className="flex justify-between"><dt>Packaging</dt><dd>{inr(order.packagingFee)}</dd></div>
            <div className="flex justify-between"><dt>Taxes</dt><dd>{inr(order.tax)}</dd></div>
            {order.loyaltyCredit > 0 && (
              <div className="flex justify-between text-leaf-600"><dt>Points credit</dt><dd>−{inr(order.loyaltyCredit)}</dd></div>
            )}
            <div className="flex justify-between font-bold text-base border-t border-cream-200 pt-2">
              <dt>Total ({order.paymentMethod})</dt><dd>{inr(order.total)}</dd>
            </div>
            <div className="flex justify-between text-xs text-maroon-800/50">
              <dt>Payment status</dt><dd>{order.paymentStatus}</dd>
            </div>
          </dl>
          {order.addressText && (
            <p className="text-sm mt-3">
              <strong>Deliver to:</strong> {order.addressText}
              {order.contactless && " · 🚪 Contactless"}
              {order.contactPhone && (
                <span className="block text-maroon-800/70 mt-0.5">
                  📞 {order.contactName ?? "Contact"}: {order.contactPhone}
                </span>
              )}
            </p>
          )}
        </section>

        {/* Actions */}
        <section className="mt-4 grid grid-cols-2 gap-2 no-print">
          <a href={`tel:${order.branch.phone}`} className="btn-outline">📞 Call restaurant</a>
          <Link href={`/account?tab=support&order=${order.id}`} className="btn-outline">🆘 Get help</Link>
          {["PLACED", "ACCEPTED"].includes(order.status) && (
            <button
              className="btn-outline col-span-2 !text-red-700 !border-red-700"
              onClick={async () => {
                if (!confirm("Cancel this order?")) return;
                const r = await fetch(`/api/orders/${order.id}/cancel`, { method: "POST" });
                if (r.ok) load();
                else alert((await r.json()).error);
              }}
            >
              Cancel order
            </button>
          )}
          {order.status === "DELIVERED" && (
            <>
              <button className="btn-primary" onClick={repeatOrder}>🔁 Order again</button>
              {!order.review ? (
                <button className="btn-secondary" onClick={() => setShowReview(true)}>⭐ Rate order</button>
              ) : (
                <span className="btn-ghost pointer-events-none">Rated {order.review.overallRating}★</span>
              )}
            </>
          )}
        </section>

        <ReviewModal open={showReview} onClose={() => setShowReview(false)} orderId={order.id} onDone={load} />
      </main>
    </>
  );
}

function labelFor(s: string, type: string) {
  const map: Record<string, string> = {
    PLACED: "Order placed",
    ACCEPTED: "Accepted by restaurant",
    PREPARING: "Being freshly prepared",
    READY:
      type === "DINE_IN" ? "Ready to serve" : type === "PICKUP" ? "Ready for pickup" : "Packed & ready",
    OUT_FOR_DELIVERY: "Out for delivery",
    DELIVERED: type === "DINE_IN" ? "Served" : type === "PICKUP" ? "Picked up" : "Delivered",
  };
  return map[s] ?? s;
}

function ReviewModal({ open, onClose, orderId, onDone }: { open: boolean; onClose: () => void; orderId: string; onDone: () => void }) {
  const [food, setFood] = useState(5);
  const [packaging, setPackaging] = useState(5);
  const [delivery, setDelivery] = useState(5);
  const [overall, setOverall] = useState(5);
  const [comment, setComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const r = await fetch(`/api/orders/${orderId}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ foodRating: food, packagingRating: packaging, deliveryRating: delivery, overallRating: overall, comment: comment || undefined }),
    });
    if (r.ok) { onClose(); onDone(); }
    else setError((await r.json()).error);
  };

  return (
    <Modal open={open} onClose={onClose} title="Rate your order">
      <div className="space-y-4">
        <Stars label="Food quality" value={food} onChange={setFood} />
        <Stars label="Packaging" value={packaging} onChange={setPackaging} />
        <Stars label="Delivery speed" value={delivery} onChange={setDelivery} />
        <Stars label="Overall experience" value={overall} onChange={setOverall} />
        <textarea className="input" rows={3} placeholder="Tell us more (optional)" maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} aria-label="Review comment" />
        <ErrorBox message={error} />
        <button onClick={submit} className="btn-primary w-full">Submit review</button>
      </div>
    </Modal>
  );
}

function Stars({ label, value, onChange }: { label: string; value: number; onChange: (n: number) => void }) {
  return (
    <div>
      <span className="label">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            role="radio"
            aria-checked={value === n}
            aria-label={`${n} star${n > 1 ? "s" : ""}`}
            onClick={() => onChange(n)}
            className={`text-2xl ${n <= value ? "" : "grayscale opacity-40"}`}
          >
            ⭐
          </button>
        ))}
      </div>
    </div>
  );
}
