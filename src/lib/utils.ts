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

export function timeAgo(iso: string | Date) {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h} hr ago`;
  return `${Math.floor(h / 24)} d ago`;
}
