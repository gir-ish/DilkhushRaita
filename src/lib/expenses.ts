import { round2 } from "./utils";

/**
 * The shop's own account book: what went out, on what, to whom, and on which
 * day.
 *
 * Not to be confused with the customer khata, which is money owed TO the shop.
 * This is the other direction — the owner's hisaab for groceries, wages, gas
 * and everything else, kept per day because that is when it is actually
 * written down.
 */

export const EXPENSE_CATEGORIES = [
  { key: "GROCERIES", label: "Groceries / raashan", icon: "🛒" },
  { key: "VEGETABLES", label: "Vegetables", icon: "🥬" },
  { key: "DAIRY", label: "Milk & paneer", icon: "🥛" },
  { key: "MEAT", label: "Meat", icon: "🍗" },
  { key: "GAS", label: "Gas cylinder", icon: "🔥" },
  { key: "HELPER", label: "Helper / staff wages", icon: "🧑‍🍳" },
  { key: "RENT", label: "Rent", icon: "🏠" },
  { key: "ELECTRICITY", label: "Electricity", icon: "💡" },
  { key: "WATER", label: "Water", icon: "🚰" },
  { key: "PACKAGING", label: "Packing material", icon: "📦" },
  { key: "MAINTENANCE", label: "Repairs & maintenance", icon: "🔧" },
  { key: "TRANSPORT", label: "Transport & fuel", icon: "🛵" },
  { key: "MARKETING", label: "Marketing", icon: "📣" },
  { key: "OTHER", label: "Other", icon: "📝" },
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number]["key"];

export const CATEGORY_KEYS = EXPENSE_CATEGORIES.map((c) => c.key) as [
  ExpenseCategory,
  ...ExpenseCategory[],
];

export function categoryLabel(key: string): string {
  const found = EXPENSE_CATEGORIES.find((c) => c.key === key);
  return found ? `${found.icon} ${found.label}` : key;
}

/** How the money left: useful for reconciling the till at the end of a day. */
export const PAID_BY = ["CASH", "UPI", "CARD", "BANK"] as const;
export type PaidBy = (typeof PAID_BY)[number];

/* ------------------------------------------------------------------ dates */

const IST_OFFSET = "+05:30";

/**
 * Midnight, Indian time, for a YYYY-MM-DD day.
 *
 * Every expense is filed against a day, not an instant, and the day it belongs
 * to is the Indian one — an entry written at half past midnight in Delhi
 * belongs to that date, and a UTC day would file it under yesterday.
 */
export function istDayStart(day: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const d = new Date(`${day}T00:00:00${IST_OFFSET}`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** The half-open range [start, end) covering one Indian month, YYYY-MM. */
export function istMonthRange(month: string): { start: Date; end: Date } | null {
  if (!/^\d{4}-\d{2}$/.test(month)) return null;
  const [y, m] = month.split("-").map(Number);
  if (m < 1 || m > 12) return null;
  const start = new Date(`${month}-01T00:00:00${IST_OFFSET}`);
  const nextY = m === 12 ? y + 1 : y;
  const nextM = m === 12 ? 1 : m + 1;
  const end = new Date(
    `${nextY}-${String(nextM).padStart(2, "0")}-01T00:00:00${IST_OFFSET}`
  );
  return Number.isNaN(start.getTime()) ? null : { start, end };
}

/** "2026-09-24" for a stored timestamp, in Indian time. */
export function istDayKeyOf(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: "Asia/Kolkata",
  }).format(d);
}

/** "2026-09" for today, or for a given moment. */
export function istMonthKey(d: Date = new Date()): string {
  return istDayKeyOf(d).slice(0, 7);
}

/* --------------------------------------------------------------- totalling */

export interface ExpenseLike {
  date: Date;
  category: string;
  payee: string | null;
  amount: number;
  paidBy: string;
  unpaid: boolean;
  branchId: string | null;
}

export interface ExpenseSummary {
  total: number;
  /** Already out of the till or the bank. */
  paid: number;
  /** Taken on the shop's own credit and still owed to a supplier. */
  unpaid: number;
  byCategory: { key: string; amount: number; count: number }[];
  byBranch: Record<string, number>;
  /** What each helper was paid, biggest first — the wages question, answered. */
  byPayee: { payee: string; amount: number; count: number }[];
  byPaidBy: Record<string, number>;
  byDay: Record<string, number>;
}

/**
 * Every total the accounts page shows, from one pass over the rows.
 *
 * Doing this here rather than in SQL keeps one definition of "spent" — the
 * page, the export and any future report cannot drift apart into three
 * slightly different numbers.
 */
export function summarise(rows: ExpenseLike[]): ExpenseSummary {
  const byCategory = new Map<string, { amount: number; count: number }>();
  const byPayee = new Map<string, { amount: number; count: number }>();
  const byBranch: Record<string, number> = {};
  const byPaidBy: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  let total = 0;
  let unpaid = 0;

  for (const r of rows) {
    total += r.amount;
    if (r.unpaid) unpaid += r.amount;

    const cat = byCategory.get(r.category) ?? { amount: 0, count: 0 };
    byCategory.set(r.category, { amount: cat.amount + r.amount, count: cat.count + 1 });

    // Wages are the one thing an owner tracks by person, so the breakdown is
    // built for helpers only; a supplier's name belongs under its category.
    if (r.category === "HELPER" && r.payee) {
      const key = r.payee.trim();
      const p = byPayee.get(key) ?? { amount: 0, count: 0 };
      byPayee.set(key, { amount: p.amount + r.amount, count: p.count + 1 });
    }

    const branch = r.branchId ?? "both";
    byBranch[branch] = round2((byBranch[branch] ?? 0) + r.amount);
    byPaidBy[r.paidBy] = round2((byPaidBy[r.paidBy] ?? 0) + r.amount);
    const day = istDayKeyOf(r.date);
    byDay[day] = round2((byDay[day] ?? 0) + r.amount);
  }

  return {
    total: round2(total),
    paid: round2(total - unpaid),
    unpaid: round2(unpaid),
    byCategory: [...byCategory.entries()]
      .map(([key, v]) => ({ key, amount: round2(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount),
    byPayee: [...byPayee.entries()]
      .map(([payee, v]) => ({ payee, amount: round2(v.amount), count: v.count }))
      .sort((a, b) => b.amount - a.amount),
    byBranch,
    byPaidBy,
    byDay,
  };
}

/** Every day of an Indian month, so a day with no entries still has a row. */
export function daysOfMonth(month: string): string[] {
  const range = istMonthRange(month);
  if (!range) return [];
  const days: string[] = [];
  for (let t = range.start.getTime(); t < range.end.getTime(); t += 86_400_000) {
    const key = istDayKeyOf(new Date(t));
    // Guard against the same key twice if a DST-like shift ever applied.
    if (days[days.length - 1] !== key) days.push(key);
  }
  return days;
}

/* ------------------------------------------------------------------- CSV */

const csvCell = (v: unknown) => {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** The same rows, for a spreadsheet. */
export function toCsv(
  rows: (ExpenseLike & { note: string | null; branchName: string })[]
): string {
  const head = ["Date", "Branch", "Category", "Paid to", "Note", "Amount", "Paid by", "Status"];
  const body = rows.map((r) =>
    [
      istDayKeyOf(r.date),
      r.branchName,
      categoryLabel(r.category).replace(/^\S+\s/, ""),
      r.payee ?? "",
      r.note ?? "",
      r.amount.toFixed(2),
      r.paidBy,
      r.unpaid ? "UNPAID" : "Paid",
    ]
      .map(csvCell)
      .join(",")
  );
  return [head.join(","), ...body].join("\n");
}
