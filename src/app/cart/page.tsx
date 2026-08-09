"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { useCart } from "@/components/cart-context";
import { ErrorBox, Spinner, VegMark } from "@/components/ui";
import { inr } from "@/lib/utils";

interface QuoteTotals {
  subtotal: number; discount: number; deliveryFee: number;
  packagingFee: number; tax: number; loyaltyCredit: number; total: number;
}

export default function CartPage() {
  const cart = useCart();
  const [quote, setQuote] = useState<{
    totals: QuoteTotals;
    warnings: string[];
    coupon: { applied: { code: string; savings: number } | null; autoSuggestion: { code: string; savings: number } | null };
    minOrderValue: number;
    meetsMinOrder: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!cart.branchId || cart.lines.length === 0) {
      setQuote(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branchId: cart.branchId,
          orderType: "DELIVERY",
          items: cart.lines.map((l) => ({
            menuItemId: l.menuItemId,
            variantId: l.variantId,
            addOnIds: l.addOnIds,
            qty: l.qty,
            instructions: l.instructions,
          })),
        }),
      })
        .then(async (r) => {
          const d = await r.json();
          if (!r.ok) throw new Error(d.error);
          setQuote(d.quote);
          setError(null);
        })
        .catch((e) => setError(e.message))
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [cart.branchId, cart.lines]);

  if (cart.lines.length === 0)
    return (
      <>
        <SiteHeader />
        <main className="mx-auto max-w-lg px-4 py-16 text-center">
          <p className="text-5xl mb-3" aria-hidden>🛒</p>
          <h1 className="font-display text-2xl font-bold text-maroon-700">Your cart is empty</h1>
          <p className="text-maroon-800/60 mt-2 mb-6">Hot dal makhani is only a few taps away.</p>
          <Link href="/" className="btn-primary">Browse the menu</Link>
        </main>
      </>
    );

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-lg px-4 py-6 pb-32">
        <h1 className="font-display text-2xl font-bold text-maroon-700 mb-1">Your cart</h1>
        <p className="text-sm text-maroon-800/60 mb-4">
          Ordering from <strong>{cart.branchName}</strong> ·{" "}
          <Link className="link-classic font-semibold text-maroon-700" href={`/menu/${cart.branchSlug}`}>
            add more items
          </Link>
        </p>

        <div className="card divide-y divide-cream-200">
          {cart.lines.map((l) => (
            <div key={l.key} className="p-4 flex gap-3">
              <span className="text-2xl" aria-hidden>{l.imageEmoji}</span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <VegMark veg={l.veg} />
                  <span className="font-semibold truncate">{l.name}</span>
                </div>
                {(l.variantName || l.addOnNames.length > 0) && (
                  <p className="text-xs text-maroon-800/60">
                    {[l.variantName, ...l.addOnNames].filter(Boolean).join(" · ")}
                  </p>
                )}
                {l.instructions && (
                  <p className="text-xs italic text-maroon-800/50">“{l.instructions}”</p>
                )}
                <div className="flex items-center justify-between mt-2">
                  <div className="flex items-center border border-cream-300 rounded-lg" role="group" aria-label={`Quantity for ${l.name}`}>
                    <button className="px-3 py-1 text-lg" onClick={() => cart.setQty(l.key, l.qty - 1)} aria-label="Decrease">−</button>
                    <span className="w-6 text-center text-sm font-bold">{l.qty}</span>
                    <button className="px-3 py-1 text-lg" onClick={() => cart.setQty(l.key, l.qty + 1)} aria-label="Increase">+</button>
                  </div>
                  <span className="font-semibold">{inr(l.displayPrice * l.qty)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-3">
          <ErrorBox message={error} />
          {quote?.warnings.map((w, i) => (
            <div key={i} role="alert" className="rounded-xl bg-mustard-100 border border-mustard-300 text-maroon-800 px-4 py-3 text-sm">
              ⚠️ {w}
            </div>
          ))}
          {quote?.coupon.autoSuggestion && (
            <div className="rounded-xl bg-green-50 border border-green-200 px-4 py-3 text-sm">
              💡 Use code <strong>{quote.coupon.autoSuggestion.code}</strong> at checkout to save ~
              {inr(quote.coupon.autoSuggestion.savings)}
            </div>
          )}
        </div>

        <div className="card p-4 mt-4" aria-label="Bill details">
          <h2 className="font-semibold mb-2">Bill details</h2>
          {loading && !quote ? (
            <Spinner label="Calculating…" />
          ) : quote ? (
            <dl className="space-y-1 text-sm">
              <Row label="Item subtotal" value={inr(quote.totals.subtotal)} />
              {quote.totals.discount > 0 && (
                <Row label={`Discount${quote.coupon.applied ? ` (${quote.coupon.applied.code})` : ""}`} value={`−${inr(quote.totals.discount)}`} accent />
              )}
              <Row label="Delivery fee (estimated)" value={inr(quote.totals.deliveryFee)} />
              <Row label="Packaging" value={inr(quote.totals.packagingFee)} />
              <Row label="Taxes" value={inr(quote.totals.tax)} />
              {/* Double rule above the total, as a printed bill sets it. */}
              <div className="mt-3 pt-3 border-t-[3px] border-double border-maroon-800/25 flex justify-between items-baseline">
                <dt className="font-display text-fluid-lg font-semibold text-maroon-700">To pay</dt>
                <dd className="font-display text-fluid-lg font-semibold text-maroon-700 money">
                  {inr(quote.totals.total)}
                </dd>
              </div>
              <p className="text-xs text-maroon-800/50 pt-1">
                Delivery fee is finalised at checkout from your address. Coupons and loyalty points
                are applied there too — no hidden charges.
              </p>
            </dl>
          ) : null}
        </div>

        <div className="fixed bottom-0 left-0 right-0 z-40 no-print
          bg-cream-50/92 backdrop-blur-md border-t border-maroon-800/10
          shadow-[0_-2px_16px_-4px_rgba(61,18,17,0.12)]
          p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-lg flex gap-3">
            <button onClick={() => { if (confirm("Clear the cart?")) cart.clear(); }} className="btn-outline">
              Clear
            </button>
            <Link
              href="/checkout"
              className={`btn-primary flex-1 ${quote && !quote.meetsMinOrder ? "pointer-events-none opacity-50" : ""}`}
              aria-disabled={quote ? !quote.meetsMinOrder : false}
            >
              Checkout →
            </Link>
          </div>
        </div>
      </main>
    </>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 ${accent ? "text-leaf-600 font-semibold" : ""}`}>
      <dt className={accent ? "" : "text-maroon-800/70"}>{label}</dt>
      <dd className="money font-medium tabular-nums">{value}</dd>
    </div>
  );
}
