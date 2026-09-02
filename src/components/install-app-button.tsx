"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { appFor, isInstalled, manualHint, offerFor, remember } from "@/lib/install";

/**
 * A permanent "install this as an app" control, as opposed to the bar that
 * appears on its own.
 *
 * The bar has three ways to show nothing, all of them correct on their own and
 * indistinguishable to whoever is waiting for it: it waits a few seconds, it
 * stays quiet for a fortnight after a dismissal, and it needs the browser to
 * have offered an install in the first place. Chrome does not offer one on a
 * page that already sits inside the scope of an app that is installed — and
 * the shop app's scope is "/", which covers the dashboard. So an owner with
 * the customer app on their phone can be shown nothing, forever, with no way
 * to ask.
 *
 * This is that way to ask. It is always on screen, it never snoozes, and when
 * the browser will not open its own install dialog it says which menu item
 * does the same job by hand. Installing from that menu uses the manifest of
 * the page it is on, so from a dashboard screen it installs the dashboard.
 */
export function InstallAppButton({ className = "" }: { className?: string }) {
  const pathname = usePathname();
  const app = appFor(pathname);

  // "hidden" until the effect has run: this cannot be decided on the server,
  // and rendering a button that then vanishes is worse than arriving a moment
  // late. It stays hidden for good if we are already running as the app.
  const [ready, setReady] = useState(false);
  const [hasOffer, setHasOffer] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (isInstalled()) return;
    setReady(true);
    setHasOffer(Boolean(offerFor(app)));

    const onInstallable = () => setHasOffer(Boolean(offerFor(app)));
    const onInstalled = () => {
      remember(app.storageKey, "installed");
      setReady(false);
    };
    window.addEventListener("dk-installable", onInstallable);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("dk-installable", onInstallable);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, [app]);

  const onClick = useCallback(async () => {
    const evt = offerFor(app);
    if (!evt) {
      // No offer to spend, so the honest answer is the manual route rather
      // than a button that appears to do nothing.
      setHint(manualHint());
      return;
    }
    await evt.prompt();
    const { outcome } = await evt.userChoice;
    window.__dkInstallEvent = null;
    setHasOffer(false);
    if (outcome === "accepted") remember(app.storageKey, "installed");
    // Declined: leave the control in place. Unlike the bar, this one was asked
    // for, so it stays available to ask again.
    else setHint(manualHint());
  }, [app]);

  if (!ready) return null;

  return (
    <div className={className}>
      <button
        type="button"
        onClick={onClick}
        className="underline text-sm text-maroon-600 w-full"
      >
        {hasOffer ? "Install this dashboard as an app" : "How do I install this as an app?"}
      </button>
      {hint && (
        <p className="mt-2 rounded-lg bg-cream-100 p-3 text-sm text-maroon-800/80">{hint}</p>
      )}
    </div>
  );
}
