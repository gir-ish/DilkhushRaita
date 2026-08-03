"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { SiteHeader } from "@/components/site-header";
import { ErrorBox, Spinner } from "@/components/ui";
import { inr, timeAgo } from "@/lib/utils";

interface Me {
  id: string; name: string | null; phone: string | null;
  notifyPromos: boolean; referralCode: string | null;
  storeCredit: number; loyaltyPoints: number; pointsValue: number;
  completedOrders: number;
  tier: { name: string; benefits: string } | null;
  nextTier: { name: string; ordersNeeded: number } | null;
}
interface OrderRow {
  id: string; orderNumber: string; status: string; total: number; placedAt: string;
  branch: { name: string; slug: string };
  items: { nameSnapshot: string; qty: number }[];
}

function AccountInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTab] = useState(params.get("tab") ?? "orders");
  const [me, setMe] = useState<Me | null>(null);
  const [orders, setOrders] = useState<OrderRow[] | null>(null);
  const [favourites, setFavourites] = useState<{ id: string; name: string; imageEmoji: string }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/me").then((r) => r.json()).then((d) => {
      if (!d.user) router.push("/login?next=/account");
      else setMe(d.user);
    });
    fetch("/api/orders").then((r) => r.json()).then((d) => setOrders(d.orders ?? []));
    fetch("/api/me/favourites").then((r) => r.json()).then((d) => setFavourites(d.favourites ?? []));
  }, [router]);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  if (!me) return (<><SiteHeader /><Spinner label="Loading account…" /></>);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-6 pb-16">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-maroon-700">
              {me.name ?? "Your account"}
            </h1>
            <p className="text-sm text-maroon-800/60">{me.phone}</p>
          </div>
          <button onClick={logout} className="btn-outline !min-h-[38px]">Sign out</button>
        </div>

        {/* Loyalty card */}
        <section className="card p-4 mt-4 bg-gradient-to-br from-maroon-600 to-maroon-800 !text-cream-50" aria-label="Loyalty status">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-mustard-300 font-bold text-sm">🏆 {me.tier?.name ?? "New Customer"}</p>
              <p className="text-2xl font-display font-bold mt-1">{me.loyaltyPoints} points</p>
              <p className="text-sm opacity-80">worth {inr(me.pointsValue)} · {me.completedOrders} orders completed</p>
            </div>
            {me.storeCredit > 0 && (
              <div className="text-right">
                <p className="text-xs opacity-70">Store credit</p>
                <p className="font-bold">{inr(me.storeCredit)}</p>
              </div>
            )}
          </div>
          {me.tier?.benefits && <p className="text-xs mt-2 opacity-80">{me.tier.benefits}</p>}
          {me.nextTier && (
            <p className="text-xs mt-1 text-mustard-300">
              {me.nextTier.ordersNeeded} more orders to reach {me.nextTier.name}!
            </p>
          )}
          {me.referralCode && (
            <p className="text-xs mt-2 opacity-80">
              Refer friends with code <strong className="font-mono">{me.referralCode}</strong>
            </p>
          )}
        </section>

        <div className="flex gap-2 overflow-x-auto mt-5" role="tablist" aria-label="Account sections">
          {[
            ["orders", "Orders"],
            ["favourites", "Favourites"],
            ["settings", "Settings"],
            ["support", "Support"],
          ].map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={`chip ${tab === k ? "chip-active" : ""}`} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>

        <ErrorBox message={error} />

        {tab === "orders" && (
          <section className="mt-4 space-y-3" aria-label="Order history">
            {!orders ? <Spinner /> : orders.length === 0 ? (
              <p className="text-maroon-800/60 py-8 text-center">No orders yet — time for a thali! <Link className="underline" href="/">Browse menu</Link></p>
            ) : (
              orders.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="card p-4 block hover:shadow-lift transition">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold">{o.orderNumber} <span className="text-xs font-normal text-maroon-800/50">· {o.branch.name}</span></p>
                      <p className="text-sm text-maroon-800/60 truncate">
                        {o.items.map((i) => `${i.qty}× ${i.nameSnapshot}`).join(", ")}
                      </p>
                      <p className="text-xs text-maroon-800/40 mt-1">{timeAgo(o.placedAt)}</p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="font-bold">{inr(o.total)}</p>
                      <p className={`text-xs font-semibold ${o.status === "DELIVERED" ? "text-leaf-600" : ["CANCELLED", "REJECTED"].includes(o.status) ? "text-red-700" : "text-mustard-600"}`}>
                        {o.status.replace(/_/g, " ")}
                      </p>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </section>
        )}

        {tab === "favourites" && (
          <section className="mt-4" aria-label="Favourite dishes">
            {!favourites ? <Spinner /> : favourites.length === 0 ? (
              <p className="text-maroon-800/60 py-8 text-center">No favourites yet — tap ❤️ on any dish.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {favourites.map((f) => (
                  <div key={f.id} className="card p-3 text-center">
                    <span className="text-3xl" aria-hidden>{f.imageEmoji}</span>
                    <p className="font-semibold text-sm mt-1">{f.name}</p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "settings" && <SettingsTab me={me} onError={setError} />}
        {tab === "support" && <SupportTab orderId={params.get("order")} onError={setError} />}
      </main>
    </>
  );
}

function SettingsTab({ me, onError }: { me: Me; onError: (e: string | null) => void }) {
  const [name, setName] = useState(me.name ?? "");
  const [promos, setPromos] = useState(me.notifyPromos);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    onError(null);
    const r = await fetch("/api/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name || undefined, notifyPromos: promos }),
    });
    if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    else onError((await r.json()).error);
  };

  return (
    <section className="card p-4 mt-4 space-y-4" aria-label="Settings">
      <div>
        <label htmlFor="s-name" className="label">Name</label>
        <input id="s-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} />
      </div>
      <label className="flex items-center gap-3 cursor-pointer text-sm">
        <input type="checkbox" className="h-5 w-5 accent-maroon-600" checked={promos} onChange={(e) => setPromos(e.target.checked)} />
        <span>
          Send me offers & promotions
          <span className="block text-xs text-maroon-800/50">Order updates are always sent regardless of this setting.</span>
        </span>
      </label>
      <button onClick={save} className="btn-primary">{saved ? "Saved ✓" : "Save settings"}</button>
    </section>
  );
}

function SupportTab({ orderId, onError }: { orderId: string | null; onError: (e: string | null) => void }) {
  const [type, setType] = useState("QUALITY");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [tickets, setTickets] = useState<{ id: string; type: string; status: string; message: string; resolution: string | null; createdAt: string }[]>([]);

  useEffect(() => {
    fetch("/api/support").then((r) => r.json()).then((d) => setTickets(d.tickets ?? []));
  }, [sent]);

  const submit = async () => {
    onError(null);
    const r = await fetch("/api/support", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId, type, message }),
    });
    if (r.ok) { setSent(true); setMessage(""); }
    else onError((await r.json()).error);
  };

  return (
    <section className="mt-4 space-y-4" aria-label="Support">
      <div className="card p-4 space-y-3">
        <h2 className="font-semibold">Raise a complaint {orderId && <span className="text-xs font-normal">(for selected order)</span>}</h2>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)} aria-label="Issue type">
          <option value="MISSING_ITEM">Missing item</option>
          <option value="WRONG_ITEM">Wrong item</option>
          <option value="LATE">Late delivery</option>
          <option value="QUALITY">Food quality issue</option>
          <option value="PAYMENT">Payment issue</option>
          <option value="COUPON">Coupon issue</option>
          <option value="PACKAGING">Packaging issue</option>
          <option value="OTHER">Something else</option>
        </select>
        <textarea className="input" rows={3} minLength={5} maxLength={2000} placeholder="Describe the issue…" value={message} onChange={(e) => setMessage(e.target.value)} aria-label="Issue description" />
        <button onClick={submit} disabled={message.length < 5} className="btn-primary w-full">
          {sent ? "Submitted ✓ — we'll get back to you" : "Submit"}
        </button>
      </div>
      {tickets.length > 0 && (
        <div className="card p-4">
          <h2 className="font-semibold mb-2">Your tickets</h2>
          <ul className="divide-y divide-cream-200 text-sm">
            {tickets.map((t) => (
              <li key={t.id} className="py-2">
                <div className="flex justify-between">
                  <span className="font-semibold">{t.type.replace(/_/g, " ")}</span>
                  <span className={`text-xs font-bold ${t.status === "RESOLVED" ? "text-leaf-600" : "text-mustard-600"}`}>{t.status}</span>
                </div>
                <p className="text-maroon-800/60 text-xs">{t.message}</p>
                {t.resolution && <p className="text-xs text-leaf-600 mt-1">↳ {t.resolution}</p>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default function AccountPage() {
  return (
    <Suspense>
      <AccountInner />
    </Suspense>
  );
}
