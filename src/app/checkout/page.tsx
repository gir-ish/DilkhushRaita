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
  const [quote, setQuote] = useState<QuoteDto | null>(null);
  const [offers, setOffers] = useState<OfferDto[] | null>(null);
  const [showOffers, setShowOffers] = useState(false);
  const [showAddAddress, setShowAddAddress] = useState(false);
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
          paymentMethod: "COD",
          scheduledFor: scheduled ? new Date(scheduled).toISOString() : null,
          instructions: instructions || null,
          cutlery,
          contactless,
        }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
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
                  <label key={a.id} className="flex items-start gap-3 cursor-pointer rounded-xl border border-cream-200 p-3">
                    <input
                      type="radio"
                      name="address"
                      className="mt-1 h-4 w-4 accent-maroon-600"
                      checked={addressId === a.id}
                      onChange={() => setAddressId(a.id)}
                    />
                    <span className="text-sm">
                      <strong>{a.label}</strong> — {a.line1}
                      {a.line2 ? `, ${a.line2}` : ""}
                      {a.landmark ? ` (near ${a.landmark})` : ""}, {a.pincode}
                    </span>
                  </label>
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
          <label className="flex items-center gap-3 rounded-xl border border-maroon-200 bg-maroon-50 p-3 text-sm">
            <input type="radio" checked readOnly className="h-4 w-4 accent-maroon-600" />
            💵 Cash on Delivery
          </label>
          <p className="text-xs text-maroon-800/50 mt-2">
            UPI & card payments are coming soon.
          </p>
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
                <dt>To pay (COD)</dt>
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
              {placing ? "Placing order…" : `Place order · ${quote ? inr(quote.totals.total) : ""}`}
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

        <AddAddressModal
          open={showAddAddress}
          onClose={() => setShowAddAddress(false)}
          onSaved={(id) => { setShowAddAddress(false); loadAddresses(); setAddressId(id); }}
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

function AddAddressModal({
  open,
  onClose,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [form, setForm] = useState({
    label: "Home", line1: "", line2: "", landmark: "", pincode: "", instructions: "",
  });
  const [useGps, setUseGps] = useState(false);
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const grabLocation = () => {
    setUseGps(true);
    navigator.geolocation?.getCurrentPosition(
      (p) => setCoords({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => { setUseGps(false); setError("Could not read location — the PIN code will be used instead."); }
    );
  };

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/me/addresses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          line2: form.line2 || null,
          landmark: form.landmark || null,
          instructions: form.instructions || null,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
          isDefault: true,
        }),
      });
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
    <Modal open={open} onClose={onClose} title="Add delivery address">
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
          <label htmlFor="a-line1" className="label">House / flat no. & street *</label>
          <input id="a-line1" required className="input" maxLength={150} value={form.line1} onChange={(e) => setForm({ ...form, line1: e.target.value })} />
        </div>
        <div>
          <label htmlFor="a-line2" className="label">Locality / area</label>
          <input id="a-line2" className="input" maxLength={150} value={form.line2} onChange={(e) => setForm({ ...form, line2: e.target.value })} />
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
          <input id="a-instr" className="input" maxLength={300} value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })} />
        </div>
        <button type="button" onClick={grabLocation} className="btn-outline w-full">
          {coords ? "📍 Location pinned ✓" : useGps ? "Locating…" : "📍 Pin my exact location (recommended)"}
        </button>
        <ErrorBox message={error} />
        <button type="submit" disabled={busy} className="btn-primary w-full">
          {busy ? "Saving…" : "Save address"}
        </button>
      </form>
    </Modal>
  );
}
