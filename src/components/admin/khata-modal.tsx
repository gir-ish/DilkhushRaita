"use client";

import { useCallback, useEffect, useState } from "react";
import { ErrorBox, Modal, Spinner } from "@/components/ui";
import { inr } from "@/lib/utils";
import { playTone } from "@/lib/sound";

interface KhataView {
  customer: { id: string; name: string | null; phone: string | null };
  due: number;
  charged: number;
  paid: number;
  waived: number;
  canWaive: boolean;
  pending: {
    orderId: string | null; orderNumber: string | null; placedAt: string; branch: string | null;
    type: string | null; tableNo: string | null; charged: number; settled: number; pending: number;
  }[];
  history: {
    id: string; kind: "CHARGE" | "PAYMENT" | "WAIVE"; amount: number; method: string | null; note: string | null;
    staffName: string | null; createdAt: string; orderNumber: string | null; void: boolean; balanceAfter: number;
  }[];
}

const METHODS = [
  ["CASH", "💵 Cash"],
  ["UPI", "📱 UPI"],
  ["CARD", "💳 Card"],
] as const;
type Method = (typeof METHODS)[number][0] | "WAIVE";

const when = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const day = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const kindLabel = (t: string | null) => (t === "DINE_IN" ? "Dine-in" : t === "PICKUP" ? "Parcel" : t === "DELIVERY" ? "Delivery" : "");

/**
 * A customer's khata: what they owe bill by bill, the total, a place to take
 * all or part of it, and every entry since the account opened. Shared by the
 * Counter (where they pay) and Customers (where the owner reviews).
 */
export function KhataModal({ userId, onClose, onChanged }: { userId: string; onClose: () => void; onChanged?: () => void }) {
  const [k, setK] = useState<KhataView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<Method>("CASH");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/admin/khata/${userId}`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error);
        setK(d);
        setAmount(d.due > 0 ? String(d.due) : "");
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load the khata"));
  }, [userId]);
  useEffect(load, [load]);

  const receive = async () => {
    if (!k) return;
    const a = +amount;
    if (!(a > 0)) return setError("Enter the amount received");
    if (a > k.due) return setError(`Only ${inr(k.due)} is due`);
    const how = method === "WAIVE" ? "waive" : METHODS.find(([m]) => m === method)![1].replace(/^\S+\s/, "");
    if (method === "WAIVE" && !confirm(`Waive ${inr(a)} from ${k.customer.name ?? "this customer"}'s khata? It will not be collected.`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/khata/${userId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: a, method, note: note.trim() || null }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      playTone("success");
      setK(d);
      setAmount(d.due > 0 ? String(d.due) : "");
      setNote("");
      setMethod("CASH");
      setDone(
        (method === "WAIVE" ? `${inr(a)} waived` : `${inr(a)} received by ${how}`) +
          (d.due > 0 ? ` — ${inr(d.due)} still due.` : " — khata cleared ✓")
      );
      onChanged?.();
    } catch (e) {
      playTone("error");
      setError(e instanceof Error ? e.message : "Could not record the payment");
    } finally {
      setBusy(false);
    }
  };

  /** A plain-text statement to send the customer on WhatsApp or SMS. */
  const statement = () => {
    if (!k) return "";
    const lines = [
      `Dilkhush Raita Wala Dhaba — Khata`,
      `${k.customer.name ?? "Customer"}${k.customer.phone ? ` (${k.customer.phone})` : ""}`,
      "",
      ...k.pending.map((p) => `${day(p.placedAt)} · Order ${p.orderNumber ?? "—"} · ${inr(p.pending)} pending${p.settled > 0 ? ` (bill ${inr(p.charged)})` : ""}`),
      "",
      `Total due: ${inr(k.due)}`,
    ];
    return lines.join("\n");
  };
  const share = async () => {
    const text = statement();
    try {
      if (navigator.share) await navigator.share({ text });
      else {
        await navigator.clipboard.writeText(text);
        setDone("Statement copied — paste it into WhatsApp.");
      }
    } catch {
      /* the share sheet was dismissed */
    }
  };

  return (
    <Modal open onClose={onClose} title={`📒 Khata — ${k?.customer.name ?? k?.customer.phone ?? ""}`} wide>
      {!k ? (
        error ? <ErrorBox message={error} /> : <Spinner label="Loading khata…" />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-sm text-maroon-800/60">
                {k.customer.name ?? "No name"} · {k.customer.phone}
              </p>
              {k.due > 0 ? (
                <p className="text-3xl font-bold text-red-700">Due {inr(k.due)}</p>
              ) : k.due < 0 ? (
                <p className="text-2xl font-bold text-leaf-600">Paid ahead {inr(-k.due)}</p>
              ) : (
                <p className="text-2xl font-bold text-leaf-600">No dues ✓</p>
              )}
              <p className="text-xs text-maroon-800/50 mt-1">
                Billed {inr(k.charged)} · Paid {inr(k.paid)}{k.waived > 0 && ` · Waived ${inr(k.waived)}`}
              </p>
            </div>
            {k.pending.length > 0 && (
              <button onClick={share} className="btn-outline !min-h-[38px] text-sm">📤 Send statement</button>
            )}
          </div>

          {k.pending.length > 0 && (
            <section aria-label="Pending bills">
              <h3 className="font-semibold mb-1">Pending bills</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[420px]">
                  <thead>
                    <tr className="text-left text-xs text-maroon-800/50 border-b border-cream-200">
                      <th className="py-1.5 pr-2">Date</th><th className="py-1.5 pr-2">Order</th>
                      <th className="py-1.5 pr-2 text-right">Bill</th><th className="py-1.5 pr-2 text-right">Paid</th>
                      <th className="py-1.5 text-right">Pending</th>
                    </tr>
                  </thead>
                  <tbody>
                    {k.pending.map((p) => (
                      <tr key={p.orderId ?? p.placedAt} className="border-b border-cream-100">
                        <td className="py-1.5 pr-2 whitespace-nowrap">{day(p.placedAt)}</td>
                        <td className="py-1.5 pr-2">
                          <span className="font-semibold">{p.orderNumber ?? "—"}</span>
                          <span className="block text-xs text-maroon-800/50">
                            {[kindLabel(p.type), p.tableNo && `Table ${p.tableNo}`, p.branch?.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")].filter(Boolean).join(" · ")}
                          </span>
                        </td>
                        <td className="py-1.5 pr-2 text-right">{inr(p.charged)}</td>
                        <td className="py-1.5 pr-2 text-right text-leaf-600">{p.settled > 0 ? inr(p.settled) : "—"}</td>
                        <td className="py-1.5 text-right font-semibold text-red-700">{inr(p.pending)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td colSpan={4} className="pt-2 text-right font-bold">Total due</td>
                      <td className="pt-2 text-right font-bold text-red-700 text-lg">{inr(k.due)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </section>
          )}

          {k.due > 0 && (
            <section className="rounded-xl border-2 border-leaf-500/40 bg-leaf-50 p-3 space-y-3" aria-label="Receive payment">
              <h3 className="font-semibold">Receive payment</h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-lg font-bold">₹</span>
                <input
                  className="input !w-32 text-lg font-bold"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={k.due}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  aria-label="Amount received"
                />
                <button onClick={() => setAmount(String(k.due))} className={`chip ${+amount === k.due ? "chip-active" : ""}`}>
                  Full {inr(k.due)}
                </button>
                {[100, 500].filter((n) => n < k.due).map((n) => (
                  <button key={n} onClick={() => setAmount(String(n))} className={`chip ${+amount === n ? "chip-active" : ""}`}>
                    {inr(n)}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2">
                {METHODS.map(([m, label]) => (
                  <button key={m} onClick={() => setMethod(m)} className={`chip ${method === m ? "chip-active" : ""}`}>
                    {label}
                  </button>
                ))}
                {k.canWaive && (
                  <button onClick={() => setMethod("WAIVE")} className={`chip ${method === "WAIVE" ? "chip-active" : ""}`} title="Let this amount go — it is not collected">
                    🙏 Waive
                  </button>
                )}
              </div>
              <input className="input" maxLength={300} placeholder="Note (optional) — e.g. paid by son, UPI ref 1234" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
              <ErrorBox message={error} />
              <button onClick={receive} disabled={busy || !(+amount > 0)} className="btn-primary w-full !py-3 !text-lg">
                {busy
                  ? "Saving…"
                  : method === "WAIVE"
                    ? `Waive ${inr(+amount || 0)}`
                    : `Receive ${inr(+amount || 0)} by ${METHODS.find(([m]) => m === method)![1].replace(/^\S+\s/, "")}`}
              </button>
              {+amount > 0 && +amount < k.due && (
                <p className="text-xs text-maroon-800/60 -mt-1">
                  {inr(k.due - +amount)} will still be due. Oldest bills are cleared first.
                </p>
              )}
            </section>
          )}
          {done && <p className="rounded-xl bg-leaf-50 border border-leaf-500/30 px-3 py-2 text-sm font-semibold">{done}</p>}
          {k.due <= 0 && error && <ErrorBox message={error} />}

          <section aria-label="Khata history">
            <h3 className="font-semibold mb-1">History</h3>
            {k.history.length === 0 ? (
              <p className="text-sm text-maroon-800/50">Nothing on khata yet.</p>
            ) : (
              <ul className="divide-y divide-cream-200 text-sm max-h-72 overflow-y-auto">
                {k.history.map((h) => (
                  <li key={h.id} className={`py-2 flex justify-between gap-3 ${h.void ? "opacity-50" : ""}`}>
                    <span>
                      <span className="font-medium">
                        {h.kind === "CHARGE"
                          ? `🧾 Bill ${h.orderNumber ?? ""}`
                          : h.kind === "WAIVE"
                            ? "🙏 Waived"
                            : `✅ Paid by ${h.method === "UPI" ? "UPI" : h.method === "CARD" ? "card" : "cash"}${h.orderNumber ? ` with bill ${h.orderNumber}` : ""}`}
                      </span>
                      {h.void && <span className="text-xs text-red-700"> · order cancelled, not owed</span>}
                      <span className="block text-xs text-maroon-800/50">
                        {when(h.createdAt)}{h.staffName && ` · ${h.staffName}`}{h.note && ` · ${h.note}`}
                      </span>
                    </span>
                    <span className="text-right shrink-0">
                      <span className={`font-semibold ${h.kind === "CHARGE" ? "text-red-700" : "text-leaf-600"}`}>
                        {h.kind === "CHARGE" ? "+" : "−"}{inr(h.amount)}
                      </span>
                      <span className="block text-xs text-maroon-800/50">bal {inr(h.balanceAfter)}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </Modal>
  );
}
