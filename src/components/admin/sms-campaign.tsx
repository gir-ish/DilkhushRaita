"use client";

import { useRef, useState } from "react";
import { ErrorBox } from "@/components/ui";

interface Preview {
  message: string;
  length: number;
  creditsPerMessage: number;
  recipients: number;
  credits: number;
  duplicatesRemoved: number;
  rejected: { raw: string; why: string }[];
  rejectedCount: number;
  batches: number;
}

interface SendResult {
  ok: boolean;
  sent: number;
  attempted: number;
  creditsSpent: number;
  failures: string[];
}

/**
 * Sends the promotional SMS to a list of numbers.
 *
 * Two steps on purpose. This is the only button in the dashboard that spends
 * money per press, and the amount is not obvious from the list — a paste of
 * eight hundred numbers is sixteen hundred credits, and nothing on screen says
 * so until it is worked out. So: preview first, showing the exact message, the
 * count and the cost; then a send that refuses if either number has moved since.
 */
export function SmsCampaign() {
  const [source, setSource] = useState<"paste" | "customers">("customers");
  const [recipients, setRecipients] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<SendResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const call = async (dryRun: boolean, expect?: { count: number; credits: number }) => {
    const r = await fetch("/api/admin/marketing/campaign", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        // The server fills this itself when the source is the customer list.
        recipients: source === "customers" ? "customers" : recipients,
        source,
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
      setPreview(null);
    };
    reader.readAsText(f);
  };

  return (
    <section className="card p-4 mt-4" aria-label="SMS campaign">
      <h2 className="font-semibold mb-1">📣 Promotional SMS</h2>
      <p className="text-sm text-maroon-800/60 mb-3">
        Sends the DLT-approved &ldquo;Website Promotion&rdquo; message. Every recipient costs
        credits from the SMS balance.
      </p>

      <ErrorBox message={error} />

      <div className="flex gap-2 my-3">
        {(
          [
            ["customers", "Our customers"],
            ["paste", "A list I provide"],
          ] as const
        ).map(([s, label]) => (
          <button
            key={s}
            onClick={() => {
              setSource(s);
              setPreview(null);
              setResult(null);
            }}
            aria-pressed={source === s}
            className={`min-h-[38px] flex-1 rounded-lg border px-3 text-sm font-semibold ${
              source === s ? "border-maroon-600 bg-maroon-600 text-white" : "border-maroon-800/20"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {source === "customers" ? (
        <p className="rounded-lg bg-cream-100 px-3 py-2 text-sm">
          Everyone who has ordered from you and is not blocked. These are the numbers with
          the clearest claim to consent — they were given to you to place an order.
        </p>
      ) : (
        <>
          <textarea
            className="input !h-32 font-mono text-sm"
            placeholder={"9876543210\n9812345678\n… one per line, or comma separated"}
            value={recipients}
            onChange={(e) => {
              setRecipients(e.target.value);
              setPreview(null);
            }}
          />
          <div className="mt-2 flex items-center gap-2">
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
              Any column; anything unusable is listed back to you.
            </span>
          </div>
        </>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={doPreview}
          disabled={busy || (source === "paste" && !recipients.trim())}
          className="btn-outline !min-h-[40px]"
        >
          {busy && !confirming ? "Checking…" : "Preview & cost"}
        </button>
      </div>

      {preview && (
        <div className="mt-4 rounded-xl border border-maroon-800/15 p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-maroon-800/50">
            Exactly what will be sent
          </p>
          <p className="mt-1 whitespace-pre-wrap rounded-lg bg-cream-100 p-3 font-mono text-sm">
            {preview.message}
          </p>

          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-4">
            <div><dt className="text-maroon-800/60">Recipients</dt><dd className="font-bold">{preview.recipients}</dd></div>
            <div><dt className="text-maroon-800/60">Credits each</dt><dd className="font-bold">{preview.creditsPerMessage}</dd></div>
            <div>
              <dt className="text-maroon-800/60">Total credits</dt>
              <dd className="font-bold text-lg text-maroon-700">{preview.credits}</dd>
            </div>
            <div><dt className="text-maroon-800/60">Length</dt><dd className="font-bold">{preview.length} chars</dd></div>
          </dl>

          {preview.duplicatesRemoved > 0 && (
            <p className="mt-2 text-sm text-maroon-800/70">
              {preview.duplicatesRemoved} duplicate{preview.duplicatesRemoved === 1 ? "" : "s"} removed —
              nobody is messaged twice.
            </p>
          )}

          {preview.rejectedCount > 0 && (
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer font-semibold text-red-700">
                {preview.rejectedCount} entr{preview.rejectedCount === 1 ? "y" : "ies"} cannot be used
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
            <p className="mt-3 font-semibold text-red-700">Nothing to send.</p>
          ) : !confirming ? (
            <button onClick={() => setConfirming(true)} className="btn-primary !min-h-[44px] mt-3">
              Send to {preview.recipients} number{preview.recipients === 1 ? "" : "s"}
            </button>
          ) : (
            <div className="mt-3 rounded-xl bg-red-50 border border-red-200 p-3">
              <p className="font-bold text-red-900">
                This spends {preview.credits} credits and cannot be undone.
              </p>
              <p className="text-sm text-red-900/80 mt-1">
                {preview.recipients} people will receive this message. Messages already sent cannot
                be recalled.
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
          <p className="mt-2 text-xs text-maroon-800/60">
            Accepted by the gateway is not the same as delivered — numbers on DND may still be
            dropped by the operator.
          </p>
        </div>
      )}
    </section>
  );
}
