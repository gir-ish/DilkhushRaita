/**
 * Everything both install affordances need to agree on.
 *
 * There are two installable apps on this origin — the customer shop and the
 * staff dashboard — and two places that offer them: the bar that appears by
 * itself (components/install-prompt.tsx) and the permanent button on the
 * dashboard login screen (components/install-app-button.tsx). They must agree
 * about which app a page belongs to, whether it is already installed and what
 * to tell someone whose browser will not offer an install, or the two will
 * contradict each other on the same screen.
 */

/** `beforeinstallprompt`, which TypeScript's DOM lib still does not describe. */
export type InstallEvent = Event & {
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
 * on which page the reader is standing on. The dismissals are remembered
 * separately: a customer who waved away the shop app has said nothing at all
 * about the dashboard, and an owner who installed the dashboard should still
 * be asked about the shop.
 */
export const APPS = {
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

export type App = (typeof APPS)[keyof typeof APPS];

/** Which of the two apps a given path belongs to. */
export function appFor(pathname: string): App {
  return pathname.startsWith("/admin") ? APPS.admin : APPS.shop;
}

/**
 * The parked install offer, but only if it belongs to the app we are about to
 * name. After a client-side navigation across the /admin boundary the offer
 * left on `window` is the other app's, and no fresh event follows — there is
 * no new document for the browser to fire one into.
 */
export function offerFor(app: App): InstallEvent | null {
  const evt = window.__dkInstallEvent;
  if (!evt) return null;
  return appFor(window.__dkInstallPath ?? "/") === app ? evt : null;
}

/** Already installed — this page is running from the home screen icon. */
export function isInstalled(): boolean {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // Safari sets this instead, and has never implemented display-mode for it.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    // iPadOS 13+ reports itself as a Mac. A desktop Mac has no touch screen,
    // so the touch points are what separate them.
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function isIosSafari(): boolean {
  if (!isIos()) return false;
  /*
   * Chrome, Firefox and Edge on iOS are Safari underneath, but only Safari's
   * own share sheet carries "Add to Home Screen". Showing those instructions
   * in Chrome sends the reader hunting through a menu that does not contain
   * the thing they were told to look for.
   */
  return !/crios|fxios|edgios|opios/i.test(navigator.userAgent);
}

/**
 * Where "install this page as an app" lives in the menu of whatever is running.
 *
 * Every browser buries it somewhere different and renames it every few
 * versions, so this names the trail rather than promising exact words.
 */
export function manualHint(): string {
  const ua = navigator.userAgent;
  const mobile = /android|mobile/i.test(ua);
  if (isIosSafari()) {
    return "Tap the Share button in the toolbar, then choose Add to Home Screen.";
  }
  /*
   * iOS, but not Safari — Chrome, Firefox, Edge and Opera on an iPhone.
   *
   * They are all Safari underneath and none of them can install a web app:
   * only Safari's own share sheet carries the entry that does it. Their menus
   * DO have similarly named items, which is worse than having none, so the
   * only honest instruction is to change browser first. Checked before the
   * per-browser branches below, which would otherwise match on the engine
   * name and send the reader to a menu item that quietly does nothing.
   */
  if (isIos()) {
    return "Open this page in Safari, then tap Share → Add to Home Screen. Only Safari can install an app on iPhone.";
  }
  if (/edg/i.test(ua)) {
    return mobile
      ? "Open the ⋯ menu, then choose Add to phone."
      : "Open the ⋯ menu, then Apps → Install this site as an app.";
  }
  if (/firefox|fxios/i.test(ua)) {
    return mobile
      ? "Open the ⋮ menu, then choose Install."
      : "Firefox on a computer cannot install apps — open this page in Chrome or Edge.";
  }
  return mobile
    ? "Open the ⋮ menu, then choose Add to Home screen."
    : "Open the ⋮ menu, then look for Install page as an app (older versions say Install…).";
}

const SNOOZE_DAYS = 14;

/** True while this person has asked not to be bothered, or has installed. */
export function suppressed(key: string): boolean {
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

export function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* nothing to do — see suppressed() */
  }
}

export function snooze(key: string) {
  remember(key, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000));
}
