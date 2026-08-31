export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

export function inr(n: number) {
  return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

export function round2(n: number) {
  return Math.round(n * 100) / 100;
}

/** Normalises an Indian mobile number to +91XXXXXXXXXX, or null if invalid. */
export function normalizePhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, "");
  let ten = digits;
  if (digits.length === 12 && digits.startsWith("91")) ten = digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) ten = digits.slice(1);
  if (!/^[6-9]\d{9}$/.test(ten)) return null;
  return "+91" + ten;
}

export function genOrderNumber() {
  const t = Date.now().toString(36).toUpperCase().slice(-6);
  const r = Math.floor(Math.random() * 1296).toString(36).toUpperCase().padStart(2, "0");
  return `DK${t}${r}`;
}

export function parseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

/** "HH:mm" comparison helper: is `now` within [from, to)? Handles overnight windows. */
export function withinTimeWindow(now: string, from?: string | null, to?: string | null) {
  if (!from || !to) return true;
  if (from <= to) return now >= from && now < to;
  return now >= from || now < to; // overnight, e.g. 22:00–02:00
}

export function hhmm(d: Date, tz = "Asia/Kolkata") {
  return new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: tz,
  }).format(d);
}

export function istDayOfWeek(d: Date) {
  return Number(
    new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" })
      .format(d) === "Sun"
      ? 0
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
          new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "Asia/Kolkata" }).format(d)
        ) + 1
  );
}

/**
 * Order timestamps are always shown in Indian time, whatever the device clock
 * is set to — a bill reprinted from a laptop in another zone has to match the
 * time the counter actually wrote on it.
 */
const IST = "Asia/Kolkata";

/** "05 Aug 2026" */
export function istDate(iso: string | Date) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: IST,
  }).format(new Date(iso));
}

/** "02:48 AM" */
export function istTime(iso: string | Date) {
  return new Intl.DateTimeFormat("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
    timeZone: IST,
  })
    .format(new Date(iso))
    .toUpperCase();
}

/** "05 Aug 2026, 02:48 AM" */
export function istDateTime(iso: string | Date) {
  return `${istDate(iso)}, ${istTime(iso)}`;
}

export function timeAgo(iso: string | Date) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}

/**
 * The post-sign-in destination, reduced to something that can only point back
 * at this site.
 *
 * Both login screens read `?next=` and navigate to it once the sign-in
 * succeeds. That parameter is part of a URL an attacker gets to write, and a
 * router will happily send the browser to another origin, so
 * `/admin/login?next=https://dilkhush-dhaba.example/admin/login` sent a staff
 * member who had just typed their real password to a copy of the login screen
 * that then asked for it again. The link starts on the genuine domain, which is
 * exactly what makes it work.
 *
 * Only a path on this site is allowed through:
 *   - it must start with a single "/", so "https://evil" and "javascript:" are out;
 *   - the second character must not be "/" or "\", which rules out "//evil.com"
 *     and "/\evil.com" — both of which browsers read as another host;
 *   - a backslash anywhere is refused, since browsers normalise it to "/" and
 *     it is only ever there to slip past a check like this one.
 *
 * Anything rejected falls back to `fallback` rather than failing, because a bad
 * `next` should still sign the person in — just onto their own dashboard.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next) return fallback;
  if (!next.startsWith("/")) return fallback;
  if (next.length > 1 && (next[1] === "/" || next[1] === "\\")) return fallback;
  if (next.includes("\\")) return fallback;
  return next;
}
