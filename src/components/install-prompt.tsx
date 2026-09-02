"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useCart } from "@/components/cart-context";

/**
 * The "Install our app" bar.
 *
 * The whole app-store question, answered without an app store: an installed
 * PWA gets its own icon on the home screen, opens without browser chrome, and
 * costs nothing to publish. What it does NOT get is a listing anyone can
 * search for — so the only place a customer will ever learn this is possible
 * is here, on the site itself. Hence a visible prompt rather than leaving them
 * to find "Add to Home Screen" in a browser menu, which nobody does.
 *
 * Two entirely different mechanisms hide behind one component:
 *
 *   Android / desktop Chrome, Edge, Samsung Internet — the browser decides the
 *   site is installable and fires `beforeinstallprompt`. We swallow that event
 *   and re-offer it on our own terms; one tap and the browser's real install
 *   dialog appears.
 *
 *   iOS Safari — fires nothing and offers no API. Installing is possible but
 *   entirely manual, so all we can do is point at the Share button. Every iOS
 *   customer has to be told, because there is no other way in.
 */

/** `beforeinstallprompt`, which TypeScript's DOM lib still does not describe. */
type InstallEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

declare global {
  interface Window {
    /** Stashed by the inline script in layout.tsx — see the note there. */
    __dkInstallEvent?: InstallEvent | null;
    /** The path that was open when the event above fired. */
    __dkInstallPath?: string | null;
  }
}

/**
 * The two installable apps on this origin, and what to say about each.
 *
 * The dashboard is a second app with its own manifest, icon and scope — see
 * src/app/admin/layout.tsx. Which one a browser is offering depends entirely
 * on which page the customer or the owner is standing on, so this component
 * only has to pick the right words for it. The dismissals are remembered
 * separately: a customer who waved away the shop app has said nothing at all
 * about the dashboard, and an owner who installed the dashboard should still
 * be asked about the shop.
 */
const APPS = {
  shop: {
    storageKey: "dk_install",
    icon: "/icon-192.png",
    label: "Install the DilKhush app",
    title: "Install the DilKhush app",
    iosTitle: "Add DilKhush to your Home Screen",
    body: "Order in one tap from your home screen. No app store, no download.",
  },
  admin: {
    storageKey: "dk_install_admin",
    icon: "/icon-admin-192.png",
    label: "Install the DilKhush Dashboard app",
    title: "Install the Dashboard app",
    iosTitle: "Add the Dashboard to your Home Screen",
    body: "Open the counter from your home screen — no browser, no address to type.",
  },
} as const;

/** Which of the two apps a given path belongs to. */
function appFor(pathname: string) {
  return pathname.startsWith("/admin") ? APPS.admin : APPS.shop;
}

/**
 * The parked install offer, but only if it belongs to the app we are about to
 * name. After a client-side navigation across the /admin boundary the offer
 * left on `window` is the other app's, and no fresh event follows — there is
 * no new document for the browser to fire one into.
 */
function offerFor(app: (typeof APPS)[keyof typeof APPS]): InstallEvent | null {
  const evt = window.__dkInstallEvent;
  if (!evt) return null;
  return appFor(window.__dkInstallPath ?? "/") === app ? evt : null;
}

const SNOOZE_DAYS = 14;

/**
 * Long enough that the bar does not race the first paint or cover the hero
 * before it has been read; short enough that it is still obviously part of
 * arriving on the site. A customer who has already tapped through to something
 * has told us they are busy, and the checks below get out of the way.
 */
const APPEAR_AFTER_MS = 3500;

/** Already installed — the app is running from the home screen icon. */
function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari sets this instead, and has never implemented display-mode for it.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const ios =
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports itself as a Mac. A desktop Mac has no touch screen,
    // so the touch points are what separate them.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  if (!ios) return false;
  /*
   * Chrome, Firefox and Edge on iOS are Safari underneath, but only Safari's
   * own share sheet carries "Add to Home Screen". Showing these instructions
   * in Chrome sends the customer hunting through a menu that does not contain
   * the thing they were told to look for.
   */
  return !/crios|fxios|edgios|opios/i.test(ua);
}

/** True while this person has asked not to be bothered, or has installed. */
function suppressed(key: string): boolean {
  try {
    const v = localStorage.getItem(key);
    if (!v) return false;
    if (v === "installed") return true;
    return Date.now() < Number(v);
  } catch {
    // Private mode, or storage blocked. We cannot remember a dismissal, so the
    // choice is nagging or never asking; asking is the point of the component.
    return false;
  }
}

function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing to do — see suppressed() */
  }
}

function snooze(key: string) {
  remember(key, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
}

export function InstallPrompt() {
  const pathname = usePathname();
  const { count } = useCart();
  const [mode, setMode] = useState<"prompt" | "ios" | null>(null);

  /*
   * Which app the page in front of us belongs to. The browser has already
   * decided this from the manifest the page links; we only follow it.
   */
  const app = appFor(pathname);

  /*
   * Where this must never appear.
   *
   * On the dashboard, only the two screens nobody is working on: the login
   * page, which is where an owner who has not installed it yet always starts,
   * and the overview. The counter, the kitchen and the order queue are live
   * screens with their own controls along the bottom edge, and a dismissible
   * bar over a ticket during service is worth less than nothing.
   *
   * On the shop side, /checkout is somebody halfway through paying — nothing
   * we want to say is worth a lost order. A non-empty cart covers the rest: it
   * means the customer is mid-task, and it is exactly when the menu and cart
   * screens raise their own fixed bar along the bottom edge, the same edge
   * this bar wants. Waiting until they are not shopping avoids both at once.
   */
  const unwelcome =
    app === APPS.admin
      ? pathname !== "/admin" && pathname !== "/admin/login"
      : pathname.startsWith("/checkout") || count > 0;

  useEffect(() => {
    if (unwelcome) {
      setMode(null);
      return;
    }
    if (isInstalled() || suppressed(app.storageKey)) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const showLater = (m: "prompt" | "ios") => {
      clearTimeout(timer);
      timer = setTimeout(() => setMode(m), APPEAR_AFTER_MS);
    };

    // The event usually fires before React has hydrated, which is why it is
    // caught in the document head and parked on `window` for us to find here.
    if (offerFor(app)) showLater("prompt");
    else if (isIosSafari()) showLater("ios");

    const onInstallable = () => {
      if (offerFor(app)) showLater("prompt");
    };
    const onInstalled = () => {
      remember(app.storageKey, "installed");
      setMode(null);
    };
    window.addEventListener("dk-installable", onInstallable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("dk-installable", onInstallable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [unwelcome, app]);

  const dismiss = useCallback(() => {
    snooze(app.storageKey);
    setMode(null);
  }, [app]);

  const install = useCallback(async () => {
    const evt = offerFor(app);
    if (!evt) return dismiss();
    // Ours closes first: the browser's own dialog is about to take the screen,
    // and two install prompts at once reads as a scam.
    setMode(null);
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    // Single use. Chrome issues a fresh event if they become eligible again.
    window.__dkInstallEvent = null;
    if (outcome === "accepted") remember(app.storageKey, "installed");
    else snooze(app.storageKey);
  }, [dismiss, app]);

  useEffect(() => {
    if (!mode) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && dismiss();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [mode, dismiss]);

  if (!mode) return null;

  return (
    <aside
      aria-label={app.label}
      className="fixed inset-x-0 bottom-0 z-40 p-3 no-print
        pb-[max(0.75rem,env(safe-area-inset-bottom))]
        sm:inset-x-auto sm:right-4 sm:bottom-4 sm:w-[22rem] sm:p-0"
    >
      <div className="card-elevated animate-sheet-up p-4">
        <div className="flex items-start gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={app.icon}
            alt=""
            width={48}
            height={48}
            className="h-12 w-12 shrink-0 rounded-xl shadow-hairline"
          />
          <div className="min-w-0 flex-1">
            <p className="font-display text-fluid-lg font-semibold text-maroon-800">
              {mode === "ios" ? app.iosTitle : app.title}
            </p>
            <p className="mt-0.5 text-fluid-sm text-maroon-700/80">
              {mode === "ios" ? (
                <>
                  Tap <IosShareIcon /> in the toolbar below, then choose{" "}
                  <span className="font-semibold text-maroon-800">Add to Home Screen</span>.
                </>
              ) : (
                app.body
              )}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Not now"
            className="btn-ghost -mr-2 -mt-2 !min-h-0 h-9 w-9 shrink-0 !px-0 text-lg leading-none"
          >
            <span aria-hidden>×</span>
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          {mode === "prompt" ? (
            <>
              <button type="button" onClick={install} className="btn-primary flex-1">
                Install
              </button>
              <button type="button" onClick={dismiss} className="btn-ghost">
                Not now
              </button>
            </>
          ) : (
            <button type="button" onClick={dismiss} className="btn-secondary flex-1">
              Got it
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}

/**
 * iOS's share glyph, drawn rather than described. "Tap the share button" is
 * meaningless to someone who has never noticed it; the shape is what they will
 * actually scan the toolbar for.
 */
function IosShareIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      aria-label="the Share button"
      role="img"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="mx-0.5 inline-block -translate-y-px text-maroon-600"
    >
      <path d="M12 15V3m0 0L8 7m4-4 4 4" />
      <path d="M4 13v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6" />
    </svg>
  );
}
