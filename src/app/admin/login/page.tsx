"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ErrorBox } from "@/components/ui";

type Mode = "loading" | "pin" | "password" | "setPin" | "forgot";

function AdminLoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>("loading");
  const [greeting, setGreeting] = useState<string | null>(null);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [code, setCode] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = useCallback(() => {
    router.push(params.get("next") ?? "/admin");
    router.refresh();
  }, [router, params]);

  // Does this browser already hold a PIN? Answered per device, so a new phone
  // simply gets the password form.
  useEffect(() => {
    fetch("/api/auth/staff/pin")
      .then((r) => r.json())
      .then((d) => {
        if (d.pinReady) { setGreeting(d.name ?? null); setMode("pin"); }
        else setMode("password");
      })
      .catch(() => setMode("password"));
  }, []);

  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error ?? "Something went wrong");
    return d;
  };

  const run = (fn: () => Promise<void>) => async (e?: React.FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError(null);
    try { await fn(); } catch (err) {
      setError(err instanceof Error ? err.message : "Failed");
    } finally { setBusy(false); }
  };

  const signInWithPassword = run(async () => {
    const d = await post("/api/auth/staff/login", { email, password });
    // Owner without a PIN yet: offer to set one now rather than burying it in
    // a settings page they will never open.
    if (d.canSetPin && !d.hasPin) { setMode("setPin"); setNote(null); return; }
    go();
  });

  const signInWithPin = run(async () => {
    await post("/api/auth/staff/pin/login", { pin });
    go();
  });

  const savePin = run(async () => {
    if (pin !== pin2) throw new Error("The two PINs do not match");
    await post("/api/auth/staff/pin", { pin });
    go();
  });

  const sendCode = run(async () => {
    const d = await post("/api/auth/staff/pin/forgot", {});
    setSentTo(d.sentTo ?? null);
    setMode("forgot");
    setNote(`Code sent to ${d.sentTo}. It expires in ${d.expiresInMinutes} minutes.`);
  });

  const resetPin = run(async () => {
    if (pin !== pin2) throw new Error("The two PINs do not match");
    await post("/api/auth/staff/pin/reset", { code, pin });
    setNote("PIN updated. Enter it to sign in.");
    setPin(""); setPin2(""); setCode("");
    setMode("pin");
  });

  const pinInput = (id: string, label: string, value: string, set: (v: string) => void, autoFocus = false) => (
    <div>
      <label htmlFor={id} className="label">{label}</label>
      <input
        id={id}
        className="input text-center text-2xl tracking-[0.5em] font-bold"
        inputMode="numeric"
        autoComplete="off"
        maxLength={6}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => set(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </div>
  );

  const shell = (children: React.ReactNode) => (
    <main className="min-h-screen bg-maroon-800 flex items-center justify-center p-4">
      <div className="card p-6 w-full max-w-sm space-y-4">
        <div className="text-center">
          <span className="text-3xl" aria-hidden>🥘</span>
          <h1 className="font-display text-xl font-bold text-maroon-700">Staff Dashboard</h1>
          <p className="text-sm text-maroon-800/60">DilKhush Dhaba – Raita Wala</p>
        </div>
        {children}
      </div>
    </main>
  );

  if (mode === "loading") return shell(<p className="text-center text-sm text-maroon-800/50">Loading…</p>);

  if (mode === "pin")
    return shell(
      <form onSubmit={signInWithPin} className="space-y-4">
        {greeting && <p className="text-center text-sm font-semibold text-maroon-700">Welcome back, {greeting}</p>}
        {pinInput("pin", "Enter your PIN", pin, setPin, true)}
        {note && <p className="text-sm text-leaf-600">{note}</p>}
        <ErrorBox message={error} />
        <button type="submit" disabled={busy || pin.length < 4} className="btn-primary w-full">
          {busy ? "Checking…" : "Unlock"}
        </button>
        <div className="flex justify-between text-sm">
          <button type="button" className="underline text-maroon-600" onClick={() => { setError(null); setNote(null); setMode("password"); }}>
            Use password
          </button>
          <button type="button" className="underline text-maroon-600" onClick={sendCode} disabled={busy}>
            Forgot PIN?
          </button>
        </div>
      </form>
    );

  if (mode === "setPin")
    return shell(
      <form onSubmit={savePin} className="space-y-4">
        <p className="text-sm text-maroon-800/70">
          Signed in. Set a PIN and this device will only ask for those digits from now on.
        </p>
        {pinInput("newPin", "New PIN (4–6 digits)", pin, setPin, true)}
        {pinInput("newPin2", "Confirm PIN", pin2, setPin2)}
        <ErrorBox message={error} />
        <button type="submit" disabled={busy || pin.length < 4} className="btn-primary w-full">
          {busy ? "Saving…" : "Save PIN"}
        </button>
        <button type="button" className="underline text-sm text-maroon-600 w-full" onClick={go}>
          Skip for now
        </button>
      </form>
    );

  if (mode === "forgot")
    return shell(
      <form onSubmit={resetPin} className="space-y-4">
        <p className="text-sm text-maroon-800/70">
          We emailed a 6-digit code{sentTo ? ` to ${sentTo}` : ""}. Enter it and choose a new PIN.
        </p>
        <div>
          <label htmlFor="code" className="label">Code from email</label>
          <input
            id="code"
            className="input text-center text-xl tracking-[0.4em] font-bold"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
          />
        </div>
        {pinInput("resetPin", "New PIN (4–6 digits)", pin, setPin)}
        {pinInput("resetPin2", "Confirm PIN", pin2, setPin2)}
        {note && <p className="text-sm text-leaf-600">{note}</p>}
        <ErrorBox message={error} />
        <button type="submit" disabled={busy || code.length !== 6 || pin.length < 4} className="btn-primary w-full">
          {busy ? "Saving…" : "Set new PIN"}
        </button>
        <button type="button" className="underline text-sm text-maroon-600 w-full" onClick={() => { setError(null); setNote(null); setMode("password"); }}>
          Use password instead
        </button>
      </form>
    );

  return shell(
    <form onSubmit={signInWithPassword} className="space-y-4">
      <div>
        <label htmlFor="email" className="label">Email</label>
        <input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <label htmlFor="password" className="label">Password</label>
        <input id="password" type="password" required autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} />
      </div>
      {note && <p className="text-sm text-leaf-600">{note}</p>}
      <ErrorBox message={error} />
      <button type="submit" disabled={busy} className="btn-primary w-full">
        {busy ? "Signing in…" : "Sign in"}
      </button>
      {greeting && (
        <button type="button" className="underline text-sm text-maroon-600 w-full" onClick={() => { setError(null); setMode("pin"); }}>
          Use PIN instead
        </button>
      )}
    </form>
  );
}

export default function AdminLoginPage() {
  return (
    <Suspense>
      <AdminLoginInner />
    </Suspense>
  );
}
