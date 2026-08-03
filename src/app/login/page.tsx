"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ErrorBox } from "@/components/ui";

// TEMPORARY: mirrors OTP_BYPASS on the server. Set NEXT_PUBLIC_OTP_BYPASS
// (and OTP_BYPASS) to "false" together once real SMS delivery is live.
const OTP_BYPASS = process.env.NEXT_PUBLIC_OTP_BYPASS === "true";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/account";

  const [phone, setPhone] = useState("");
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [stage, setStage] = useState<"phone" | "otp">("phone");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [devOtp, setDevOtp] = useState<string | null>(null);

  useEffect(() => {
    if (countdown <= 0) return;
    const t = setInterval(() => setCountdown((c) => c - 1), 1000);
    return () => clearInterval(t);
  }, [countdown]);

  const sendOtp = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/otp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      if (d.bypass) {
        // OTP verification is temporarily disabled — sign in immediately.
        await verify("");
        return;
      }
      setStage("otp");
      setCountdown(d.resendIn ?? 30);
      setDevOtp(d.devOtp ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send OTP");
    } finally {
      setBusy(false);
    }
  };

  const verify = async (codeOverride?: string) => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/auth/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, code: codeOverride ?? code, name: name.trim() }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error);
      router.push(next);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen pattern-jaali flex items-center justify-center px-4 py-10">
      <div className="card p-6 w-full max-w-sm">
        <Link href="/" className="block text-center mb-4">
          <span className="text-3xl" aria-hidden>🥘</span>
          <span className="block font-display font-bold text-maroon-700 text-xl">DilKhush Dhaba</span>
          <span className="text-xs font-bold tracking-widest text-mustard-600">RAITA WALA</span>
        </Link>

        {stage === "phone" ? (
          <form onSubmit={(e) => { e.preventDefault(); sendOtp(); }} className="space-y-4">
            <div>
              <label htmlFor="phone" className="label">Mobile number</label>
              <div className="flex">
                <span className="inline-flex items-center px-3 rounded-l-xl border border-r-0 border-cream-300 bg-cream-100 text-sm font-semibold">
                  +91
                </span>
                <input
                  id="phone"
                  className="input !rounded-l-none"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  placeholder="98XXXXXXXX"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))}
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="name" className="label">Name *</label>
              <input id="name" className="input" required value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="What should we call you?" />
            </div>
            <ErrorBox message={error} />
            <button type="submit" disabled={busy || phone.length !== 10 || name.trim().length < 2} className="btn-primary w-full">
              {busy ? "Signing in…" : OTP_BYPASS ? "Continue" : "Send OTP"}
            </button>
            <p className="text-xs text-maroon-800/50 text-center">
              We only use your number for order updates. Browsing the menu never requires sign-in.
            </p>
          </form>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); verify(); }} className="space-y-4">
            <p className="text-sm">
              OTP sent to <strong>+91 {phone}</strong>{" "}
              <button type="button" className="underline" onClick={() => setStage("phone")}>change</button>
            </p>
            {devOtp && (
              <p className="rounded-xl bg-mustard-100 px-3 py-2 text-sm">
                🧪 <strong>Dev mode:</strong> your OTP is <code className="font-bold">{devOtp}</code>
              </p>
            )}
            <div>
              <label htmlFor="otp" className="label">6-digit OTP</label>
              <input
                id="otp"
                className="input text-center tracking-[0.5em] font-bold text-lg"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                required
              />
            </div>
            <ErrorBox message={error} />
            <button type="submit" disabled={busy || code.length !== 6} className="btn-primary w-full">
              {busy ? "Verifying…" : "Verify & continue"}
            </button>
            <button
              type="button"
              disabled={countdown > 0 || busy}
              onClick={sendOtp}
              className="btn-ghost w-full"
            >
              {countdown > 0 ? `Resend OTP in ${countdown}s` : "Resend OTP"}
            </button>
          </form>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginInner />
    </Suspense>
  );
}
