"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useCart } from "@/components/cart-context";
import { ErrorBox, Modal, Spinner } from "@/components/ui";
import { inr } from "@/lib/utils";

interface AddressDto {
  id: string; label: string; line1: string; line2: string | null;
  landmark: string | null; pincode: string; isDefault: boolean;
  contactName: string | null; contactPhone: string | null;
  lat: number | null; lng: number | null;
}
interface QuoteDto {
  totals: { subtotal: number; discount: number; deliveryFee: number; packagingFee: number; tax: number; loyaltyCredit: number; total: number };
  warnings: string[];
  serviceable: boolean;
  serviceReason?: string;
  etaMins: number | null;
  distanceKm: number | null;
  minOrderValue: number;
  meetsMinOrder: boolean;
  pointsBalance: number;
  pointsRedeemed: number;
  tierName: string | null;
  freeDelivery: boolean;
  coupon: {
    applied: { code: string; name: string; savings: number } | null;
    rejectedReason: string | null;
    autoSuggestion: { code: string; name: string; savings: number } | null;
  };
}
interface OfferDto {
  code: string; name: string; description: string;
  eligible: boolean; reason: string | null; estimatedSavings: number;
}
interface PlaceOrderResponse {
  orderId: string;
  orderNumber: string;
  payment?: {
    provider: string;
    keyId: string;
    gatewayOrderId: string;
    amount: number; // paise
    currency: string;
    customerName: string;
    customerPhone: string;
  };
}

// Mirrors PAYMENT_PROVIDER on the server. The server is the one that actually
// refuses ONLINE when it is not configured — this only controls whether the
// option is offered.
const ONLINE_ENABLED = process.env.NEXT_PUBLIC_PAYMENT_PROVIDER === "razorpay";

interface RazorpayInstance {
  open(): void;
  on(event: string, cb: (resp: unknown) => void): void;
}
declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => RazorpayInstance;
  }
}

/** Loads Razorpay Checkout on demand — no cost to customers paying by COD. */
function loadRazorpayScript(): Promise<boolean> {
  return new Promise((resolve) => {
    if (window.Razorpay) return resolve(true);
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

export default function CheckoutPage() {
  const cart = useCart();
  const router = useRouter();

  const [orderType, setOrderType] = useState<"DELIVERY" | "PICKUP">("DELIVERY");
  const [addresses, setAddresses] = useState<AddressDto[] | null>(null);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [couponCode, setCouponCode] = useState("");
  const [appliedCode, setAppliedCode] = useState<string | null>(null);
  const [redeemPoints, setRedeemPoints] = useState(false);
  const [scheduled, setScheduled] = useState(""); // datetime-local or ""
  const [instructions, setInstructions] = useState("");
  const [cutlery, setCutlery] = useState(true);
  const [contactless, setContactless] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<"COD" | "ONLINE">("COD");
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [offers, setOffers] = useState<OfferDto[] | null>(null);
  const [showOffers, setShowOffers] = useState(false);
  const [showAddAddress, setShowAddAddress] = useState(false);
  const [editingAddress, setEditingAddress] = useState<AddressDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [placing, setPlacing] = useState(false);

  const loadAddresses = useCallback(() => {
    fetch("/api/me/addresses")
      .then((r) => r.json())
      .then((d) => {
        setAddresses(d.addresses ?? []);
        const def = (d.addresses ?? []).find((a: AddressDto) => a.isDefault) ?? d.addresses?.[0];
        setAddressId((cur) => cur ?? def?.id ?? null);
      })
      .catch(() => setAddresses([]));
  }, []);

  useEffect(loadAddresses, [loadAddresses]);

  useEffect(() => {
    if (!cart.branchId || cart.lines.length === 0) return;
    const t = setTimeout(() => {
      fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: cart.branchId,
          orderType,
          items: cart.lines.map((l) => ({
            menuItemId: l.menuItemId, variantId: l.variantId,
            addOnIds: l.addOnIds, qty: l.qty, instructions: l.instructions,
          })),
          addressId: orderType === "DELIVERY" ? addressId : null,
          couponCode: appliedCode,
          redeemPoints,
          paymentMethod: "COD",
          scheduledFor: scheduled ? new Date(scheduled).toISOString() : null,
        }),
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setQuote(d.quote);
          setError(null);
          if (d.quote.coupon.rejectedReason) setError(`Coupon: ${d.quote.coupon.rejectedReason}`);
        })
        .catch((e) => setError(e.message));
    }, 300);
    return () => clearTimeout(t);
  }, [cart.branchId, cart.lines, orderType, addressId, appliedCode, redeemPoints, scheduled]);

  const openOffers = () => {
    setShowOffers(true);
    fetch(
      `/api/coupons/available?branchId=${cart.branchId}&subtotal=${quote?.totals.subtotal ?? 0}&orderType=${orderType}`
    )
      .then((r) => r.json())
      .then((d) => setOffers([...(d.eligible ?? []), ...(d.ineligible ?? [])]))
      .catch(() => setOffers([]));
  };

  /**
   * Opens Razorpay Checkout, then hands the result to the server to verify.
   * The browser's own "success" callback is never treated as proof of payment —
   * /api/payments/verify re-checks the signature and amount server-side.
   */
  const payWithRazorpay = async (d: PlaceOrderResponse) => {
    const pay = d.payment!;
    if (!(await loadRazorpayScript()) || !window.Razorpay) {
      setError(
        "Could not open the payment window. Check your connection and retry from My Orders — your order is saved as unpaid."
      );
      setPlacing(false);
      return;
    }

    const rzp = new window.Razorpay({
      key: pay.keyId,
      order_id: pay.gatewayOrderId,
      amount: pay.amount,
      currency: pay.currency,
      name: "DilKhush Dhaba – Raita Wala",
      description: `Order ${d.orderNumber}`,
      prefill: { name: pay.customerName, contact: pay.customerPhone },
      theme: { color: "#7B1E1E" },
      handler: async (resp: {
        razorpay_order_id: string;
        razorpay_payment_id: string;
        razorpay_signature: string;
      }) => {
        try {
          const vr = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              orderId: d.orderId,
              razorpayOrderId: resp.razorpay_order_id,
              razorpayPaymentId: resp.razorpay_payment_id,
              signature: resp.razorpay_signature,
            }),
          });
          const vd = await vr.json();
          if (!vr.ok) throw new Error(vd.error);
          cart.clear();
          router.push(`/orders/${d.orderId}`);
        } catch (e) {
          // Money may well have left the customer's account here, so never say
          // "payment failed" — the webhook will still settle it server-side.
          setError(
            e instanceof Error
              ? `${e.message} Check My Orders in a minute before paying again.`
              : "We could not confirm the payment. Check My Orders in a minute before paying again."
          );
          setPlacing(false);
        }
      },
      modal: {
        ondismiss: () => {
          setPlacing(false);
          // Close the order out rather than leaving it in the kitchen queue as
          // an unpaid PLACED order. The server re-checks with Razorpay first,
          // so a payment that actually went through is never voided here.
          fetch("/api/payments/abandon", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ orderId: d.orderId }),
            keepalive: true, // must survive the customer navigating away
          }).catch(() => {});
          setError("Payment cancelled — the order was not placed. Your cart is still here if you want to try again.");
        },
      },
    } as Record<string, unknown>);

    rzp.on("payment.failed", () => {
      setPlacing(false);
      setError("Payment failed. Nothing was charged — please try again or choose Cash on Delivery.");
    });
    rzp.open();
  };

  const placeOrder = async () => {
    setPlacing(true);
    setError(null);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: cart.branchId,
          orderType,
          items: cart.lines.map((l) => ({
            menuItemId: l.menuItemId, variantId: l.variantId,
            addOnIds: l.addOnIds, qty: l.qty, instructions: l.instructions,
          })),
          addressId: orderType === "DELIVERY" ? addressId : null,
          couponCode: appliedCode,
          redeemPoints,
          paymentMethod,
          scheduledFor: scheduled ? new Date(scheduled).toISOString() : null,
          instructions: instructions || null,
          cutlery,
          contactless,
        }),
      });
      const d: PlaceOrderResponse & { error?: string } = await res.json();
      if (!res.ok) throw new Error(d.error);

      if (d.payment) {
        await payWithRazorpay(d);
        return; // cart is cleared only once payment verifies
      }
      cart.clear();
      router.push(`/orders/${d.orderId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not place order");
      setPlacing(false);
    }
  };

  if (cart.lines.length === 0)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <h1 className="font-display text-2xl font-bold text-maroon-700">Nothing to checkout</h1>
          <Link href="/" className="btn-primary mt-6 inline-flex">Browse the menu</Link>
        </main>
      </>
    );

  const canPlace =
    !!quote &&
    quote.warnings.length === 0 &&
    quote.meetsMinOrder &&
    (orderType === "PICKUP" || (addressId && quote.serviceable));

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-6 pb-36">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mb-4">Checkout</h1>

        <section className="card p-4 mb-4" aria-label="Order type">
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Delivery or pickup">
            {(["DELIVERY", "PICKUP"] as const).map((t) => (
              <button
                key={t}
                role="radio"
                aria-checked={orderType === t}
                onClick={() => setOrderType(t)}
                className={`btn ${orderType === t ? "btn-primary" : "btn-outline"}`}
              >
                {t === "DELIVERY" ? "🛵 Delivery" : "🛍️ Self-pickup"}
              </button>
            ))}
          </div>
          <div className="mt-3">
            <label htmlFor="schedule" className="label">Schedule for later (optional)</label>
            <input
              id="schedule"
              type="datetime-local"
              className="input"
              value={scheduled}
              onChange={(e) => setScheduled(e.target.value)}
            />
            {scheduled && (
              <button className="text-xs underline mt-1" onClick={() => setScheduled("")}>
                Deliver ASAP instead
              </button>
            )}
          </div>
        </section>

        {orderType === "DELIVERY" && (
          <section className="card p-4 mb-4" aria-label="Delivery address">
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">Delivery address</h2>
              <button className="text-sm underline text-maroon-600" onClick={() => setShowAddAddress(true)}>
                + Add new
              </button>
            </div>
            {!addresses ? (
              <Spinner />
            ) : addresses.length === 0 ? (
              <p className="text-sm text-maroon-800/60">No saved addresses yet — add one to continue.</p>
            ) : (
              <div className="space-y-2">
                {addresses.map((a) => (
                  <div
                    key={a.id}
                    className={`flex items-start gap-3 rounded-xl border p-3 transition ${
                      addressId === a.id ? "border-maroon-400 bg-maroon-50" : "border-cream-200"
                    }`}
                  >
                    {/* The row is a label so tapping anywhere selects it, but
                        Edit/Delete sit outside it — nested buttons inside a
                        label would toggle the radio when clicked. */}
                    <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-0">
                      <input
                        type="radio"
                        name="address"
                        className="mt-1 h-4 w-4 accent-maroon-600 shrink-0"
                        checked={addressId === a.id}
                        onChange={() => setAddressId(a.id)}
                      />
                      <span className="text-sm min-w-0">
                        <strong>{a.label}</strong> — {a.line1}
                        {a.line2 ? `, ${a.line2}` : ""}
                        {a.landmark ? ` (near ${a.landmark})` : ""}, {a.pincode}
                        {a.contactPhone && (
                          <span className="block text-xs text-maroon-800/60 mt-0.5">
                            📞 {a.contactName ? `${a.contactName} · ` : ""}{a.contactPhone}
                          </span>
                        )}
                      </span>
                    </label>
                    <span className="flex flex-col gap-1 shrink-0 text-xs">
                      <button
                        type="button"
                        className="underline text-maroon-600"
                        onClick={() => setEditingAddress(a)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="underline text-red-700"
                        onClick={async () => {
                          if (!confirm(`Delete this ${a.label} address?`)) return;
                          const r = await fetch(`/api/me/addresses/${a.id}`, { method: "DELETE" });
                          if (r.ok) {
                            if (addressId === a.id) setAddressId(null);
                            loadAddresses();
                          } else setError((await r.json()).error);
                        }}
                      >
                        Delete
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
            {quote && !quote.serviceable && addressId && (
              <p className="form-error mt-2">{quote.serviceReason ?? "This address is outside the delivery area."}</p>
            )}
            <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={contactless} onChange={(e) => setContactless(e.target.checked)} />
              Contactless delivery — leave at the door
            </label>
          </section>
        )}

        <section className="card p-4 mb-4" aria-label="Coupons and rewards">
          <h2 className="font-semibold mb-2">Offers & rewards</h2>
          {quote?.coupon.applied ? (
            <div className="flex items-center justify-between rounded-xl bg-green-50 border border-green-200 px-3 py-2 text-sm">
              <span>
                ✅ <strong>{quote.coupon.applied.code}</strong> applied — you save {inr(quote.coupon.applied.savings)}
              </span>
              {appliedCode && (
                <button className="underline" onClick={() => { setAppliedCode(null); setCouponCode(""); }}>
                  Remove
                </button>
              )}
            </div>
          ) : (
            <div className="flex gap-2">
              <input
                className="input uppercase"
                placeholder="Coupon code"
                value={couponCode}
                onChange={(e) => setCouponCode(e.target.value.toUpperCase())}
                aria-label="Coupon code"
              />
              <button className="btn-secondary shrink-0" onClick={() => setAppliedCode(couponCode || null)} disabled={!couponCode}>
                Apply
              </button>
            </div>
          )}
          <button className="text-sm underline text-maroon-600 mt-2" onClick={openOffers}>
            View all offers
          </button>
          {quote && quote.pointsBalance >= 100 && (
            <label className="flex items-center gap-2 mt-3 text-sm cursor-pointer">
              <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={redeemPoints} onChange={(e) => setRedeemPoints(e.target.checked)} />
              Redeem {quote.pointsRedeemed > 0 ? quote.pointsRedeemed : ""} DilKhush points
              (balance: {quote.pointsBalance} = {inr(quote.pointsBalance * 0.5)})
            </label>
          )}
          {quote?.tierName && (
            <p className="text-xs text-mustard-600 font-semibold mt-2">
              🏆 {quote.tierName} benefits applied{quote.freeDelivery ? " — free delivery!" : ""}
            </p>
          )}
        </section>

        <section className="card p-4 mb-4" aria-label="Instructions">
          <label htmlFor="rest-instructions" className="label">Instructions for the restaurant (optional)</label>
          <textarea
            id="rest-instructions"
            className="input"
            rows={2}
            maxLength={500}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g. ring the bell twice"
          />
          <label className="flex items-center gap-2 mt-2 text-sm cursor-pointer">
            <input type="checkbox" className="h-4 w-4 accent-maroon-600" checked={cutlery} onChange={(e) => setCutlery(e.target.checked)} />
            Include disposable cutlery
          </label>
        </section>

        <section className="card p-4 mb-4" aria-label="Payment method">
          <h2 className="font-semibold mb-2">Payment</h2>
          {ONLINE_ENABLED ? (
            <div className="space-y-2" role="radiogroup" aria-label="Payment method">
              <label
                className={`flex items-start gap-3 rounded-xl border p-3 text-sm cursor-pointer transition ${
                  paymentMethod === "ONLINE"
                    ? "border-maroon-400 bg-maroon-50"
                    : "border-cream-200 hover:border-cream-400"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  className="mt-0.5 h-4 w-4 accent-maroon-600"
                  checked={paymentMethod === "ONLINE"}
                  onChange={() => setPaymentMethod("ONLINE")}
                />
                <span>
                  <span className="font-semibold">📱 Pay online</span>
                  <span className="block text-xs text-maroon-800/60 mt-0.5">
                    UPI (GPay, PhonePe, Paytm), cards, netbanking &amp; wallets
                  </span>
                </span>
              </label>
              <label
                className={`flex items-start gap-3 rounded-xl border p-3 text-sm cursor-pointer transition ${
                  paymentMethod === "COD"
                    ? "border-maroon-400 bg-maroon-50"
                    : "border-cream-200 hover:border-cream-400"
                }`}
              >
                <input
                  type="radio"
                  name="paymentMethod"
                  className="mt-0.5 h-4 w-4 accent-maroon-600"
                  checked={paymentMethod === "COD"}
                  onChange={() => setPaymentMethod("COD")}
                />
                <span>
                  <span className="font-semibold">💵 Cash on Delivery</span>
                  <span className="block text-xs text-maroon-800/60 mt-0.5">
                    Pay the delivery agent when your order arrives
                  </span>
                </span>
              </label>
            </div>
          ) : (
            <>
              <label className="flex items-center gap-3 rounded-xl border border-maroon-200 bg-maroon-50 p-3 text-sm">
                <input type="radio" checked readOnly className="h-4 w-4 accent-maroon-600" />
                💵 Cash on Delivery
              </label>
              <p className="text-xs text-maroon-800/50 mt-2">
                UPI &amp; card payments are coming soon.
              </p>
            </>
          )}
        </section>

        <section className="card p-4" aria-label="Bill summary">
          <h2 className="font-semibold mb-2">Bill summary</h2>
          {!quote ? (
            <Spinner label="Calculating…" />
          ) : (
            <dl className="space-y-1 text-sm">
              <Row l="Item subtotal" v={inr(quote.totals.subtotal)} />
              {quote.totals.discount > 0 && <Row l="Discount" v={`−${inr(quote.totals.discount)}`} accent />}
              {orderType === "DELIVERY" && (
                <Row
                  l={`Delivery fee${quote.distanceKm ? ` (≈${quote.distanceKm} km)` : ""}`}
                  v={quote.totals.deliveryFee === 0 ? "FREE" : inr(quote.totals.deliveryFee)}
                  accent={quote.totals.deliveryFee === 0}
                />
              )}
              <Row l="Packaging" v={inr(quote.totals.packagingFee)} />
              <Row l="Taxes" v={inr(quote.totals.tax)} />
              {quote.totals.loyaltyCredit > 0 && (
                <Row l={`Points redeemed (${quote.pointsRedeemed})`} v={`−${inr(quote.totals.loyaltyCredit)}`} accent />
              )}
              <div className="border-t border-cream-200 pt-2 mt-2 flex justify-between font-bold text-base">
                <dt>{paymentMethod === "ONLINE" ? "To pay now" : "To pay (COD)"}</dt>
                <dd>{inr(quote.totals.total)}</dd>
              </div>
              {quote.etaMins && !scheduled && (
                <p className="text-xs text-maroon-800/60 pt-1">
                  ⏱ Estimated {orderType === "DELIVERY" ? "delivery" : "pickup"} in ~{quote.etaMins} min
                </p>
              )}
            </dl>
          )}
        </section>

        <div className="mt-4 space-y-2">
          <ErrorBox message={error} />
          {quote?.warnings.map((w, i) => (
            <div key={i} role="alert" className="rounded-xl bg-mustard-100 border border-mustard-300 px-4 py-3 text-sm">
              ⚠️ {w}
            </div>
          ))}
        </div>

        <div className="fixed bottom-0 left-0 right-0 bg-cream-50 border-t border-cream-200 p-4">
          <div className="mx-auto max-w-lg">
            <button onClick={placeOrder} disabled={!canPlace || placing} className="btn-primary w-full !py-4">
              {placing
                ? paymentMethod === "ONLINE"
                  ? "Opening payment…"
                  : "Placing order…"
                : `${paymentMethod === "ONLINE" ? "Pay" : "Place order ·"} ${quote ? inr(quote.totals.total) : ""}`}
            </button>
          </div>
        </div>

        <Modal open={showOffers} onClose={() => setShowOffers(false)} title="Available offers">
          {!offers ? (
            <Spinner />
          ) : offers.length === 0 ? (
            <p className="text-sm text-maroon-800/60">No offers right now — check back soon!</p>
          ) : (
            <div className="space-y-3">
              {offers.map((o) => (
                <div key={o.code} className={`rounded-xl border p-3 ${o.eligible ? "border-mustard-300" : "border-cream-200 opacity-70"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold font-mono">{o.code}</span>
                    {o.eligible ? (
                      <button
                        className="btn-secondary !min-h-[34px] !px-3 text-sm"
                        onClick={() => { setAppliedCode(o.code); setCouponCode(o.code); setShowOffers(false); }}
                      >
                        Apply
                      </button>
                    ) : (
                      <span className="text-xs text-red-700">{o.reason}</span>
                    )}
                  </div>
                  <p className="text-sm font-semibold">{o.name}</p>
                  <p className="text-xs text-maroon-800/60">{o.description}</p>
                  {o.eligible && o.estimatedSavings > 0 && (
                    <p className="text-xs text-leaf-600 font-semibold mt-1">Save ~{inr(o.estimatedSavings)}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Modal>

        <AddressModal
          open={showAddAddress || editingAddress !== null}
          existing={editingAddress}
          onClose={() => { setShowAddAddress(false); setEditingAddress(null); }}
          onSaved={(id) => {
            setShowAddAddress(false);
            setEditingAddress(null);
            loadAddresses();
            setAddressId(id);
          }}
        />
      </main>
    </>
  );
}

function Row({ l, v, accent }: { l: string; v: string; accent?: boolean }) {
  return (
    <div className={`flex justify-between ${accent ? "text-leaf-600 font-semibold" : ""}`}>
      <dt>{l}</dt>
      <dd>{v}</dd>
    </div>
  );
}

/** Add a new address, or edit an existing one when `existing` is passed. */
function AddressModal({
  open,
  existing,
  onClose,
  onSaved,
}: {
  open: boolean;
  existing: AddressDto | null;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [form, setForm] = useState({
    label: "Home", line1: "", line2: "", landmark: "", pincode: "", instructions: "",
    contactName: "", contactPhone: "",
  });
  const [useGps, setUseGps] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Reset on every open so a previous edit never leaks into a new address.
  useEffect(() => {
    if (!open) return;
    setError(null);
    setCoords(existing?.lat != null && existing?.lng != null ? { lat: existing.lat, lng: existing.lng } : null);
    setForm({
      label: existing?.label ?? "Home",
      line1: existing?.line1 ?? "",
      line2: existing?.line2 ?? "",
      landmark: existing?.landmark ?? "",
      pincode: existing?.pincode ?? "",
      instructions: "",
      contactName: existing?.contactName ?? "",
      // Stored as +91XXXXXXXXXX; the field edits the 10 digits.
      contactPhone: (existing?.contactPhone ?? "").replace(/^\+91/, ""),
    });
  }, [open, existing]);

  const grabLocation = () => {
    setUseGps(true);
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { setUseGps(false); setError("Could not read location — the PIN code will be used instead."); }
    );
  };

  const save = async () => {
    if (form.contactPhone && form.contactPhone.length !== 10) {
      setError("The contact mobile must be 10 digits, or leave it blank.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        existing ? `/api/me/addresses/${existing.id}` : "/api/me/addresses",
        {
        method: existing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          line2: form.line2 || null,
          landmark: form.landmark || null,
          instructions: form.instructions || null,
          contactName: form.contactName.trim() || null,
          contactPhone: form.contactPhone || null,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          isDefault: true,
        }),
      }
      );
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      onSaved(d.address.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save address");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={existing ? "Edit delivery address" : "Add delivery address"}>
      <form onSubmit={(e) => { e.preventDefault(); save(); }} className="space-y-3">
        <div>
          <span className="label">Save as</span>
          <div className="flex gap-2">
            {["Home", "Work", "Other"].map((l) => (
              <button
                type="button"
                key={l}
                className={`chip ${form.label === l ? "chip-active" : ""}`}
                onClick={() => setForm({ ...form, label: l })}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label htmlFor="a-line1" className="label">House / flat / building no. &amp; street *</label>
          <input
            id="a-line1"
            required
            className="input"
            maxLength={150}
            placeholder="e.g. B-42, 2nd floor, Sector 7"
            value={form.line1}
            onChange={(e) => setForm({ ...form, line1: e.target.value })}
          />
          <p className="text-xs text-maroon-800/50 mt-1">
            Include the flat or house number — riders lose the most time on this.
          </p>
        </div>
        <div>
          <label htmlFor="a-line2" className="label">Locality / area</label>
          <input
            id="a-line2"
            className="input"
            maxLength={150}
            placeholder="e.g. Rohini West"
            value={form.line2}
            onChange={(e) => setForm({ ...form, line2: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="a-landmark" className="label">Landmark</label>
            <input id="a-landmark" className="input" maxLength={100} value={form.landmark} onChange={(e) => setForm({ ...form, landmark: e.target.value })} />
          </div>
          <div>
            <label htmlFor="a-pin" className="label">PIN code *</label>
            <input id="a-pin" required className="input" inputMode="numeric" maxLength={6} pattern="\d{6}" value={form.pincode} onChange={(e) => setForm({ ...form, pincode: e.target.value.replace(/\D/g, "") })} />
          </div>
        </div>
        <div>
          <label htmlFor="a-instr" className="label">Delivery instructions</label>
          <input id="a-instr" className="input" maxLength={300} placeholder="e.g. ring the bell twice, gate code 1234" value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </div>

        {/* Ordering for someone else is common — a parent, a colleague, a
            hostel room. Without this the rider only has the account holder's
            number, who may not even be at the address. */}
        <fieldset className="rounded-xl border border-cream-300 p-3">
          <legend className="px-1 text-sm font-semibold text-maroon-700">
            Who receives it? (optional)
          </legend>
          <p className="text-xs text-maroon-800/50 mb-2">
            Leave blank if it&apos;s you — we&apos;ll use your own name and number.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="a-cname" className="label">Name</label>
              <input
                id="a-cname"
                className="input"
                maxLength={60}
                placeholder="e.g. Mummy"
                value={form.contactName}
                onChange={(e) => setForm({ ...form, contactName: e.target.value })}
              />
            </div>
            <div>
              <label htmlFor="a-cphone" className="label">Mobile</label>
              <div className="flex">
                <span className="inline-flex items-center px-2 rounded-l-xl border border-r-0 border-cream-300 bg-cream-100 text-sm font-semibold">
                  +91
                </span>
                <input
                  id="a-cphone"
                  className="input !rounded-l-none"
                  inputMode="numeric"
                  maxLength={10}
                  placeholder="98XXXXXXXX"
                  value={form.contactPhone}
                  onChange={(e) => setForm({ ...form, contactPhone: e.target.value.replace(/\D/g, "") })}
                />
              </div>
            </div>
          </div>
        </fieldset>
        <button type="button" onClick={grabLocation} className="btn-outline w-full">
          {coords ? "📍 Location pinned ✓" : useGps ? "Locating…" : "📍 Pin my exact location (recommended)"}
        </button>
        <ErrorBox message={error} />
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : existing ? "Save changes" : "Save address"}
        </button>
      </form>
    </Modal>
  );
}
