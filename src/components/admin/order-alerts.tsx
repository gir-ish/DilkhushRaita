"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Turning on alerts that survive the site being closed.
 *
 * The dashboard's chime needs a tab open. This is the other thing: the
 * browser hands its push service a subscription, we keep it, and a new order
 * wakes the device whether or not anyone is looking at the site.
 *
 * Permission has to be asked for by a real click — browsers refuse a prompt
 * that nobody asked for, and a refusal is remembered — so this is a button
 * and never something that happens on load.
 */

type State = "checking" | "unsupported" | "unconfigured" | "off" | "on" | "blocked";

/** The VAPID key travels as base64url and has to reach the browser as bytes. */
function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4))
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const raw = atob(padded);
  // A plain ArrayBuffer, not a SharedArrayBuffer: subscribe() will not take
  // the latter, and Uint8Array.from would leave the type open to both.
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/** Enough to tell one device from another in a list. */
function describeDevice(): string {
  const ua = navigator.userAgent;
  const os = /Android/i.test(ua)
    ? "Android"
    : /iPhone|iPad/i.test(ua)
      ? "iPhone"
      : /Windows/i.test(ua)
        ? "Windows"
        : /Mac/i.test(ua)
          ? "Mac"
          : "this device";
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Chrome\//.test(ua)
      ? "Chrome"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Safari\//.test(ua)
          ? "Safari"
          : "browser";
  return `${browser} on ${os}`;
}

export function OrderAlerts() {
  const [state, setState] = useState<State>("checking");
  const [publicKey, setPublicKey] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ id: string; label: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
      // Safari on iOS only offers push to a PWA added to the home screen, and
      // says nothing about it until then — hence the hint below.
      return setState("unsupported");
    }
    try {
      const r = await fetch("/api/admin/push");
      if (!r.ok) return setState("unconfigured");
      const d = await r.json();
      setDevices(d.devices ?? []);
      if (!d.configured || !d.publicKey) return setState("unconfigured");
      setPublicKey(d.publicKey);

      if (Notification.permission === "denied") return setState("blocked");
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setState(sub ? "on" : "off");
    } catch {
      setState("unconfigured");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const turnOn = async () => {
    if (!publicKey) return;
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "blocked" : "off");
        return;
      }
      const reg = await navigator.serviceWorker.ready;
      const sub =
        (await reg.pushManager.getSubscription()) ??
        (await reg.pushManager.subscribe({
          // Required by every browser: a push nobody sees is not allowed.
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        }));

      const r = await fetch("/api/admin/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...sub.toJSON(), label: describeDevice() }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      setState("on");
      setMessage("This device will now be woken for new orders.");
      void refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not turn alerts on");
    } finally {
      setBusy(false);
    }
  };

  const turnOff = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch(`/api/admin/push?endpoint=${encodeURIComponent(sub.endpoint)}`, {
          method: "DELETE",
        });
        await sub.unsubscribe();
      }
      setState("off");
      void refresh();
    } finally {
      setBusy(false);
    }
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const r = await fetch("/api/admin/push", { method: "PUT" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setMessage("Sent — it should appear in a moment, even if you close this tab.");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "Could not send a test");
    } finally {
      setBusy(false);
    }
  };

  if (state === "checking") return null;

  return (
    <section className="card p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-display text-xl font-bold text-maroon-700">🔔 Order alerts</h2>
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${
            state === "on" ? "bg-leaf-50 text-leaf-600" : "bg-cream-200 text-maroon-700"
          }`}
        >
          {state === "on" ? "On for this device" : "Off"}
        </span>

        {state === "off" && (
          <button onClick={turnOn} disabled={busy} className="btn-primary ml-auto !min-h-[40px]">
            {busy ? "Asking…" : "Turn on for this device"}
          </button>
        )}
        {state === "on" && (
          <div className="ml-auto flex gap-2">
            <button onClick={test} disabled={busy} className="btn-outline !min-h-[40px] text-sm">
              Send a test
            </button>
            <button onClick={turnOff} disabled={busy} className="btn-ghost !min-h-[40px] text-sm">
              Turn off
            </button>
          </div>
        )}
      </div>

      <p className="mt-2 text-sm text-maroon-800/70">
        A new order rings this device even when the dashboard is closed and the browser is not
        running. The chime you already have only works while a tab is open.
      </p>

      {state === "blocked" && (
        <p className="mt-2 rounded-xl bg-red-50 border border-red-600/30 px-3 py-2 text-sm">
          This browser is set to block notifications from the site, so it cannot be turned on from
          here. Open the padlock beside the address bar, allow notifications, and reload.
        </p>
      )}
      {state === "unconfigured" && (
        <p className="mt-2 rounded-xl bg-cream-100 px-3 py-2 text-sm">
          Not set up on the server yet — the keys that let us wake a browser are missing from the
          environment.
        </p>
      )}
      {state === "unsupported" && (
        <p className="mt-2 rounded-xl bg-cream-100 px-3 py-2 text-sm">
          This browser cannot be woken. On an iPhone, add the dashboard to the home screen first
          (Share → Add to Home Screen) and open it from there — Safari only allows alerts for an
          installed app.
        </p>
      )}
      {message && <p className="mt-2 text-sm font-semibold text-maroon-700">{message}</p>}

      {devices.length > 0 && (
        <p className="mt-2 text-xs text-maroon-800/60">
          Alerts are on for: {devices.map((d) => d.label || "a device").join(", ")}.
        </p>
      )}
    </section>
  );
}
