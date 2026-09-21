import { db } from "./db";

/**
 * Order numbers a person can read out over a counter: RHN-210926-0001.
 *
 * The branch, the date, then that branch's own count for the day, starting
 * again at 0001 each morning. "DKA3MR1YYP" was unique and unmemorable; this
 * can be called across a room, the date keeps one day's 0001 apart from
 * another's, and the code says which kitchen it belongs to.
 *
 * Online and counter orders share one series per branch: the website taking
 * 0001 means the next order at that till is 0002. One queue of food, one run
 * of numbers.
 *
 * The count comes from a row per branch per day that is incremented in the
 * database, so two tills taking an order in the same second cannot land on the
 * same number. A day that somehow passes 9999 simply gets a fifth digit rather
 * than starting over — a repeated number would be worse than a long one.
 */
export const ORDER_NUMBER_RE = /^[A-Z]{2,5}-\d{6}-\d{4,}$/;

/** Branches whose code was set before the dashboard could set one. */
const KNOWN_CODES: Record<string, string> = { rohini: "RHN", nsp: "NSP" };

/** The letters in front of a branch's order numbers. */
export function branchCode(branch: { code?: string | null; slug: string }): string {
  const own = branch.code?.trim().toUpperCase();
  if (own) return own;
  const letters = branch.slug.replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase();
  return KNOWN_CODES[branch.slug] ?? (letters || "DK");
}

/** DDMMYY in Indian time — the day a customer would call it. */
export function istDayKey(d: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("day")}${get("month")}${get("year")}`;
}

export function formatOrderNumber(code: string, day: string, seq: number): string {
  return `${code}-${day}-${String(seq).padStart(4, "0")}`;
}

/**
 * The next number for this branch today, counted in the database so it is
 * never reused.
 */
export async function nextOrderNumber(branchId: string, when: Date = new Date()): Promise<string> {
  const branch = await db.branch.findUnique({ where: { id: branchId }, select: { code: true, slug: true } });
  const code = branchCode(branch ?? { slug: "dk" });
  const day = istDayKey(when);
  const row = await db.orderCounter.upsert({
    where: { day: `${code}-${day}` },
    create: { day: `${code}-${day}`, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return formatOrderNumber(code, day, row.seq);
}
