import { db } from "./db";

/**
 * Order numbers a person can read out over a counter: 210926-0001.
 *
 * The date (day, month, year) and then the day's own count, starting again at
 * 0001 each morning. "DKA3MR1YYP" was unique and unmemorable; this can be
 * called across a room, and the date in front means one day's 0001 is never
 * confused with another's.
 *
 * The count comes from a row per day that is incremented in the database, so
 * two tills taking an order in the same second cannot land on the same number.
 * A day that somehow passes 9999 simply gets a fifth digit rather than
 * starting over — a repeated number would be worse than a long one.
 */
export const ORDER_NUMBER_RE = /^\d{6}-\d{4,}$/;

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

export function formatOrderNumber(day: string, seq: number): string {
  return `${day}-${String(seq).padStart(4, "0")}`;
}

/** The next number for today, counted in the database so it is never reused. */
export async function nextOrderNumber(day: string = istDayKey()): Promise<string> {
  const row = await db.orderCounter.upsert({
    where: { day },
    create: { day, seq: 1 },
    update: { seq: { increment: 1 } },
  });
  return formatOrderNumber(day, row.seq);
}
