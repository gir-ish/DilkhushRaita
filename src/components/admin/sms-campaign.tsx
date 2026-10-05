"use client";

import { useEffect, useRef, useState } from "react";
import { ErrorBox } from "@/components/ui";

type Template = "websitePromotion" | "specialOffer" | "customerOffer";

/**
 * What each template does, in the operator's terms. The wording itself is the
 * DLT-approved text in src/lib/sms-templates.ts; this only explains the slots.
 */
const TEMPLATES: { key: Template; label: string; blurb: string }[] = [
  {
    key: "websitePromotion",
    label: "Website Promotion",
    blurb: "Invites people to order online. Greets each customer by first name.",
  },
  {
    key: "specialOffer",
    label: "Special Offer",
    blurb: "Announces one of your coupons — its name and code go into the message.",
  },
  {
    key: "customerOffer",
    label: "Points Reminder",
    blurb:
      "Tells each customer, by first name, how many Dilkhush Points they have and nudges them to spend them. Choose the fewest points worth reminding someone about.",
  },
];

interface Coupon {
  id: string;
  code: string;
  name: string;
  active: boolean;
}

interface Preview {
  template: { key: Template; name: string; id: string };
  samples: { message: string; recipients: number; creditsEach: number }[];
  distinctMessages: number;
  recipients: number;
  credits: number;
  skipped: { phone: string; why: string }[];
  skippedCount: number;
  duplicatesRemoved: number;
  /** Left out because they have had this very message before. */
  alreadySent: number;
  /** The limit this preview applied: 0 = never had it, null = no limit. */
  maxTimesSent: number | null;
  /** For a Special Offer, the coupon the count was against. */
  variant: string | null;
  /** …or any message, recently. */
  recentlyTexted: number;
  rejected: { raw: string; why: string }[];
  rejectedCount: number;
}

interface SendResult {
  ok: boolean;
  sent: number;
  attempted: number;
  creditsSpent: number;
  failures: string[];
  /** The gateway's id for each submission — what the Delivery Report is searched by. */
  messageIds?: string[];
}

/**
 * Sends a promotional SMS to a list of numbers.
 *
 * Two steps on purpose. This is the only button in the dashboard that spends
 * money per press, and the amount is not obvious from the list. So: preview
 * first, showing real messages with real names in them, the count and the cost;
 * then a send that refuses if either figure has moved since.
 */
export function SmsCampaign() {
  const [template, setTemplate] = useState<Template>("websitePromotion");
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [couponId, setCouponId] = useState("");
  // Points Reminder: only customers with at least this many points.
  const [minPoints, setMinPoints] = useState("1");
  const [source, setSource] = useState<"paste" | "customers" | "contacts" | "both">("customers");
  // Contact book: how many numbers are in it, so the choice says what it means.
  const [book, setBook] = useState<{ sendable: number; optedOut: number } | null>(null);
  const [recipients, setRecipients] = useState("");
  // Send to the people who have not had this one yet. On by default: the
  // usual reason to send a campaign again is that the list has grown.
  // "" = no limit; otherwise the most times they may already have had it.
  const [maxTimesSent, setMaxTimesSent] = useState("0");
  const [quietDays, setQuietDays] = useState("0");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    fetch("/api/admin/marketing/contacts?take=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setBook(d.totals))
      .catch(() => setBook(null));
  }, []);

  useEffect(() => {
    fetch("/api/admin/coupons")
      .then((r) => (r.ok ? r.json() : { coupons: [] }))
      .then((d) => setCoupons((d.coupons ?? []).filter((c: Coupon) => c.active)))
      .catch(() => setCoupons([]));
  }, []);

  // Anything that changes who gets what makes the old preview a lie.
  const invalidate = () => {
    setPreview(null);
    setResult(null);
    setConfirming(false);
  };

  const call = async (dryRun: boolean, expect?: { count: number; credits: number }) => {
    const r = await fetch("/api/admin/marketing/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        template,
        couponId: template === "specialOffer" ? couponId : undefined,
        minPoints: template === "customerOffer" ? Math.max(1, Math.floor(+minPoints || 1)) : undefined,
        recipients: source === "paste" ? recipients : "",
        source,
        maxTimesSent: maxTimesSent === "" ? null : Math.max(0, Math.floor(+maxTimesSent)),
        quietDays: Math.max(0, Math.floor(+quietDays || 0)),
        dryRun,
        expect,
      }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error ?? "Something went wrong");
    return d;
  };

  const doPreview = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    setConfirming(false);
    try {
      setPreview(await call(true));
    } catch (e) {
      setPreview(null);
      setError(e instanceof Error ? e.message : "Could not preview");
    } finally {
      setBusy(false);
    }
  };

  const doSend = async () => {
    if (!preview) return;
    setBusy(true);
    setError(null);
    try {
      setResult(await call(false, { count: preview.recipients, credits: preview.credits }));
      setConfirming(false);
      setPreview(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send");
    } finally {
      setBusy(false);
    }
  };

  const readFile = (f: File) => {
    const reader = new FileReader();
    // Any column of any CSV works: the server pulls the numbers out and reports
    // whatever it could not use, so nobody has to reformat a spreadsheet first.
    reader.onload = () => {
      setSource("paste");
      setRecipients(String(reader.result ?? ""));
      invalidate();
    };
    reader.readAsText(f);
  };

  const pill = (active: boolean) =>
    `min-h-[38px] flex-1 rounded-lg border px-3 text-sm font-semibold ${
      active ? "border-maroon-600 bg-maroon-600 text-white" : "border-maroon-800/20"
    }`;

  const current = TEMPLATES.find((t) => t.key === template)!;
  const canPreview =
    !busy &&
    (source !== "paste" || recipients.trim().length > 0) &&
    (template !== "specialOffer" || !!couponId);

  return (
    <section className="card p-4 mt-4" aria-label="SMS campaign">
      <h2 className="font-semibold mb-1">📣 SMS campaigns</h2>
      <p className="text-sm text-maroon-800/60 mb-3">
        Sends a DLT-approved promotional message. Every recipient costs credits, customers who
        switched promotions off are never included, and numbers on Do Not Disturb will not
        receive promotional SMS.
      </p>

      <ErrorBox message={error} />

      <p className="mt-3 mb-1 text-xs font-bold uppercase tracking-wide text-maroon-800/50">Message</p>
      <div className="flex flex-wrap gap-2">
        {TEMPLATES.map((t) => (
          <button
            key={t.key}
            onClick={() => {
              setTemplate(t.key);
              invalidate();
            }}
            aria-pressed={template === t.key}
            className={pill(template === t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-maroon-800/70">{current.blurb}</p>

      {template === "specialOffer" && (
        <div className="mt-3">
          <label className="label" htmlFor="campaign-coupon">
            Coupon to announce
          </label>
          <select
            id="campaign-coupon"
            className="input"
            value={couponId}
            onChange={(e) => {
              setCouponId(e.target.value);
              invalidate();
            }}
          >
            <option value="">Choose an active coupon…</option>
            {coupons.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.name}
              </option>
            ))}
          </select>
          {coupons.length === 0 && (
            <p className="mt-1 text-xs text-maroon-800/60">
              No active coupons. Switch one on above before announcing it.
            </p>
          )}
        </div>
      )}

      {template === "customerOffer" && (
        <div className="mt-3">
          <label className="label" htmlFor="campaign-min-points">
            Only customers with at least
          </label>
          <div className="flex items-center gap-2">
            <input
              id="campaign-min-points"
              className="input !w-32"
              type="number"
              min={1}
              value={minPoints}
              onChange={(e) => {
                setMinPoints(e.target.value);
                invalidate();
              }}
            />
            <span className="text-sm">points</span>
          </div>
          <p className="mt-1 text-xs text-maroon-800/60">
            Each message carries that customer&apos;s own name and points. Customers with fewer are left out.
          </p>
        </div>
      )}

      <PointsSmsSettings />

      <p className="mt-4 mb-1 text-xs font-bold uppercase tracking-wide text-maroon-800/50">
        Send to
      </p>
      <div className="flex gap-2">
        {(
          [
            ["customers", "Our customers"],
            ["contacts", "Contact book"],
            ["both", "Both together"],
            ["paste", "A list I provide"],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            onClick={() => {
              setSource(s);
              invalidate();
            }}
            aria-pressed={source === s}
            className={pill(source === s)}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "customers" ? (
        <p className="mt-2 rounded-lg bg-cream-100 px-3 py-2 text-sm">
          Everyone who has ordered from you, is not blocked and has not turned promotions off.
          Each is greeted by their own first name.
        </p>
      ) : source === "both" ? (
        <p className="mt-2 rounded-lg bg-cream-100 px-3 py-2 text-sm">
          Everyone who has ordered from you, <strong>and</strong> every number in the contact book.
          Anybody on both lists is counted once and paid for once, and is greeted by the name on
          their own account rather than the one the phone book had.
          {book && (
            <>
              {" "}
              The contact book holds <strong>{book.sendable.toLocaleString("en-IN")}</strong> of
              those.
            </>
          )}
        </p>
      ) : source === "contacts" ? (
        <p className="mt-2 rounded-lg bg-cream-100 px-3 py-2 text-sm">
          {book ? (
            <>
              The <strong>{book.sendable.toLocaleString("en-IN")}</strong> number
              {book.sendable === 1 ? "" : "s"} in your contact book. Every one was checked when it
              was uploaded, so nothing is spent finding out a number is wrong.
              {book.optedOut > 0 && (
                <> {book.optedOut} opted out {book.optedOut === 1 ? "is" : "are"} left out.</>
              )}
            </>
          ) : (
            <>Upload a phone book below to fill the contact book.</>
          )}
        </p>
      ) : (
        <>
          <textarea
            className="input !h-32 font-mono text-sm mt-2"
            placeholder={"9876543210\n9812345678\n… one per line, or comma separated"}
            value={recipients}
            onChange={(e) => {
              setRecipients(e.target.value);
              invalidate();
            }}
          />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])}
            />
            <button onClick={() => fileRef.current?.click()} className="btn-outline !min-h-[36px] text-sm">
              📄 Upload CSV
            </button>
            <span className="text-xs text-maroon-800/60">
              Numbers that belong to customers get their name; others are greeted
              &ldquo;Friend&rdquo;.
            </span>
          </div>
        </>
      )}

      {/* Who to leave out. Both narrow whichever audience is chosen above. */}
      <div className="mt-3 rounded-xl border border-cream-300 bg-cream-100/60 p-3">
        <p className="text-xs font-bold uppercase tracking-wide text-maroon-800/50">Leave out</p>
        <label className="mt-1.5 flex flex-wrap items-center gap-2 text-sm">
          Send to those who have had this message
          <select
            className="input !w-auto !min-h-[36px]"
            value={maxTimesSent}
            onChange={(e) => {
              setMaxTimesSent(e.target.value);
              invalidate();
            }}
          >
            <option value="0">never</option>
            <option value="1">at most once</option>
            <option value="2">at most twice</option>
            <option value="3">at most 3 times</option>
            <option value="5">at most 5 times</option>
            <option value="">any number of times — send to everyone</option>
          </select>
        </label>
        <p className="mt-1 text-xs text-maroon-800/60">
          Counted per message, and for a special offer per coupon — so a Diwali offer reaches
          people who have already had a welcome offer, while a website promotion only ever goes
          to each number once.
          {template === "specialOffer" && !couponId && (
            <span className="block text-maroon-700 font-semibold">
              Choose the coupon above; the count is kept against that offer.
            </span>
          )}
        </p>
        <label className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          Anyone texted in the last
          <input
            type="number"
            min={0}
            max={365}
            className="input !w-20 !min-h-[36px] text-center"
            value={quietDays}
            onChange={(e) => {
              setQuietDays(e.target.value);
              invalidate();
            }}
          />
          days by any campaign
          <span className="text-xs text-maroon-800/60">(0 = no limit)</span>
        </label>
      </div>

      <div className="mt-3">
        <button onClick={doPreview} disabled={!canPreview} className="btn-outline !min-h-[40px]">
          {busy && !confirming ? "Checking…" : "Preview & cost"}
        </button>
      </div>

      {preview && (
        <div className="mt-4 rounded-xl border border-maroon-800/15 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-maroon-800/50">
            {preview.template.name} · template {preview.template.id}
          </p>

          <p className="mt-2 text-xs text-maroon-800/60">
            {preview.distinctMessages > 1
              ? `${preview.distinctMessages} different messages — one per first name. A few of them:`
              : "Exactly what will be sent:"}
          </p>
          <ul className="mt-1 space-y-2">
            {preview.samples.map((s, i) => (
              <li key={i} className="rounded-lg bg-cream-100 p-3">
                <p className="whitespace-pre-wrap font-mono text-sm">{s.message}</p>
                <p className="mt-1 text-xs text-maroon-800/60">
                  {s.recipients} recipient{s.recipients === 1 ? "" : "s"} · {s.message.length} chars ·{" "}
                  {s.creditsEach} credit{s.creditsEach === 1 ? "" : "s"} each
                </p>
              </li>
            ))}
          </ul>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-maroon-800/60">Recipients</dt>
              <dd className="font-bold">{preview.recipients}</dd>
            </div>
            <div>
              <dt className="text-maroon-800/60">Total credits</dt>
              <dd className="font-bold text-lg text-maroon-700">{preview.credits}</dd>
            </div>
            <div>
              <dt className="text-maroon-800/60">Left out</dt>
              <dd className="font-bold">{preview.skippedCount + preview.rejectedCount}</dd>
            </div>
          </dl>

          {preview.alreadySent > 0 && (
            <p className="mt-2 text-sm">
              ✓ <strong>{preview.alreadySent}</strong> already had{" "}
              {preview.variant ? `the ${preview.variant} offer` : "this message"}
              {preview.maxTimesSent ? ` more than ${preview.maxTimesSent} time${preview.maxTimesSent === 1 ? "" : "s"}` : ""}{" "}
              and {preview.alreadySent === 1 ? "is" : "are"} left out.
            </p>
          )}
          {preview.recentlyTexted > 0 && (
            <p className="mt-1 text-sm">
              ⏸ <strong>{preview.recentlyTexted}</strong> were texted recently and{" "}
              {preview.recentlyTexted === 1 ? "is" : "are"} left out.
            </p>
          )}
          {preview.duplicatesRemoved > 0 && (
            <p className="mt-2 text-sm text-maroon-800/70">
              {preview.duplicatesRemoved} duplicate{preview.duplicatesRemoved === 1 ? "" : "s"} removed —
              nobody is messaged twice.
            </p>
          )}

          {preview.skippedCount > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold text-maroon-800">
                {preview.skippedCount} left out on purpose
              </summary>
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-maroon-800/70">
                {preview.skipped.map((s, i) => (
                  <li key={i}>
                    <code>{s.phone}</code> — {s.why}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preview.rejectedCount > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold text-red-700">
                {preview.rejectedCount} entr{preview.rejectedCount === 1 ? "y" : "ies"} could not be used
              </summary>
              <ul className="mt-1 max-h-32 overflow-y-auto text-xs text-maroon-800/70">
                {preview.rejected.map((r, i) => (
                  <li key={i}>
                    <code>{r.raw}</code> — {r.why}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {preview.recipients === 0 ? (
            <p className="mt-3 font-semibold text-red-700">Nobody to send to.</p>
          ) : !confirming ? (
            <button onClick={() => setConfirming(true)} className="btn-primary !min-h-[44px] mt-3">
              Send to {preview.recipients} {preview.recipients === 1 ? "person" : "people"}
            </button>
          ) : (
            <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3">
              <p className="font-bold text-red-900">
                This spends {preview.credits} credits and cannot be undone.
              </p>
              <p className="text-sm text-red-900/80 mt-1">
                {preview.recipients} {preview.recipients === 1 ? "person" : "people"} will receive it.
                Messages already sent cannot be recalled.
              </p>
              <div className="mt-3 flex gap-2">
                <button onClick={doSend} disabled={busy} className="btn-primary !min-h-[44px]">
                  {busy ? "Sending…" : `Yes, send ${preview.recipients}`}
                </button>
                <button onClick={() => setConfirming(false)} disabled={busy} className="btn-ghost !min-h-[44px]">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {result && (
        <div
          className={`mt-4 rounded-xl p-3 ${result.ok ? "bg-leaf-50 border border-leaf-500/30" : "bg-red-50 border border-red-200"}`}
        >
          <p className="font-bold">
            {result.ok ? "✅ Sent" : "⚠️ Partly sent"} — {result.sent} of {result.attempted}, using{" "}
            {result.creditsSpent} credits.
          </p>
          {result.failures.length > 0 && (
            <ul className="mt-2 text-sm text-red-900">
              {result.failures.map((f, i) => (
                <li key={i}>• {f}</li>
              ))}
            </ul>
          )}
          {/* The only thread back to what actually happened: the gateway tells
              us nothing about delivery, and the panel's Delivery Report is
              searched by this id. */}
          {result.messageIds && result.messageIds.length > 0 && (
            <p className="mt-2 text-xs text-maroon-800/70">
              Gateway reference{result.messageIds.length > 1 ? "s" : ""}:{" "}
              <span className="font-mono font-semibold">{result.messageIds.join(", ")}</span>
              <br />
              Look this up in the SMS panel&apos;s Delivery Report to see what reached each number.
            </p>
          )}
          <p className="mt-2 text-xs text-maroon-800/60">
            Accepted by the gateway is not the same as delivered — numbers on Do Not Disturb are
            dropped by the operator for promotional messages.
          </p>
        </div>
      )}
    </section>
  );
}

/**
 * The points SMS the shop sends by itself: after an order above the amount set
 * here, the customer is told the points it earned — by name, once the order
 * is complete. Promotional, so never to someone who opted out, and only
 * 9am–9pm.
 */
function PointsSmsSettings() {
  const [s, setS] = useState<{
    pointsSmsEnabled: boolean;
    pointsSmsMinOrder: number;
    orderConfirmedSms: boolean;
    orderDispatchedSms: boolean;
    orderDeliveredSms: boolean;
  } | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/admin/sms-settings")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setS(d))
      .catch(() => {});
  }, []);
  if (!s) return null;

  const save = async (next: typeof s) => {
    setS(next);
    setSaved(false);
    setError(null);
    const r = await fetch("/api/admin/sms-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(next),
    });
    if (!r.ok) setError((await r.json()).error ?? "Could not save");
    else setSaved(true);
  };

  return (
    <div className="mt-4 rounded-xl border border-cream-300 bg-cream-100/60 p-3 text-sm">
      <p className="font-semibold">Automatic points SMS</p>
      <div className="flex flex-wrap items-center gap-2 mt-1">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            className="h-4 w-4 accent-maroon-600"
            checked={s.pointsSmsEnabled}
            onChange={(e) => save({ ...s, pointsSmsEnabled: e.target.checked })}
          />
          After an order above ₹
        </label>
        <input
          className="input !w-28 !min-h-[36px]"
          type="number"
          min={0}
          value={s.pointsSmsMinOrder}
          disabled={!s.pointsSmsEnabled}
          onChange={(e) => setS({ ...s, pointsSmsMinOrder: +e.target.value })}
          onBlur={() => save(s)}
          aria-label="Minimum order for the points SMS"
        />
        <span>text the customer the points it earned.</span>
        {saved && <span className="text-leaf-600 font-semibold">Saved ✓</span>}
      </div>
      <p className="text-xs text-maroon-800/60 mt-1">
        Website, parcel and dine-in alike — sent when the order completes. 1 credit each. Never to someone who turned
        promotions off, and only within the hours the operator carries promotional messages.
      </p>

      {/* The three order updates, each on its own switch: they are not worth
          the same. "On the way" tells the customer something they cannot see;
          the confirmation repeats what the website said a second earlier. */}
      <p className="font-semibold mt-3">Order updates by SMS</p>
      <div className="mt-1 grid gap-1.5 sm:grid-cols-3">
        {(
          [
            ["orderConfirmedSms", "✅ Order confirmed", "Repeats what the website just said"],
            ["orderDispatchedSms", "🛵 On the way", "Delivery orders only"],
            ["orderDeliveredSms", "📦 Delivered", "Delivery orders only"],
          ] as const
        ).map(([key, label, hint]) => (
          <label key={key} className="flex items-start gap-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-maroon-600"
              checked={s[key]}
              onChange={(e) => save({ ...s, [key]: e.target.checked })}
            />
            <span>
              {label}
              <span className="block text-xs text-maroon-800/60">{hint}</span>
            </span>
          </label>
        ))}
      </div>
      <p className="text-xs text-maroon-800/60 mt-1">
        1 credit each, and transactional — they reach numbers that have blocked promotional
        messages. Switching one off here stops it everywhere, without a deploy.
      </p>
      {error && <p className="text-xs text-red-700 mt-1">{error}</p>}
    </div>
  );
}
