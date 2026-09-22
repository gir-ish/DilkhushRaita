import { db } from "@/lib/db";
import { HttpError } from "@/lib/guard";
import { round2 } from "@/lib/utils";
import { TAB_CLOSED_STATUSES } from "@/lib/constants";
import { isGuest } from "@/lib/guest";

/**
 * The khata — a customer's running account for bills they pay later.
 *
 * Every bill put on khata is a CHARGE. Whatever they pay against the account
 * is a PAYMENT (cash, UPI or card); an amount the owner lets go — a ₹5
 * rounding, a goodwill discount — is a WAIVE. Nothing is ever edited: a
 * mistake is put right with another entry, so the entries are the history
 * and the history is the account.
 *
 * Payments clear the oldest bills first, the way a paper khata is kept. When a
 * bill is fully covered its order is marked PAID, so every other screen — the
 * order list, the bill, the reports — agrees with the khata.
 */

export const KHATA_METHODS = ["CASH", "UPI", "CARD"] as const;
export type KhataMethod = (typeof KHATA_METHODS)[number];
export type KhataKind = "CHARGE" | "PAYMENT" | "WAIVE";

/** Payment status of an order on khata that still has something owing. */
export const ON_KHATA = "CREDIT";

/** Paise are noise from floating point, not money anyone is owed. */
const EPS = 0.009;

export interface KhataRow {
  id: string;
  kind: string;
  amount: number;
  orderId: string | null;
  createdAt: Date;
  /** Status of the order a CHARGE is for — a cancelled order's charge no longer counts. */
  orderStatus?: string | null;
}

/** A charge for food that never went out is not owed. */
export function chargeCounts(row: Pick<KhataRow, "kind" | "orderStatus">): boolean {
  return row.kind !== "CHARGE" || !TAB_CLOSED_STATUSES.includes((row.orderStatus ?? "") as never);
}

/**
 * The account, worked out from its entries: what is due, what each bill still
 * owes after payments are applied oldest first, and the balance after every
 * entry.
 */
export function summarizeKhata<R extends KhataRow>(rows: R[]) {
  const sorted = [...rows].sort(
    (a, b) =>
      a.createdAt.getTime() - b.createdAt.getTime() ||
      // A bill and the part-payment taken with it share a moment; the bill first.
      (a.kind === "CHARGE" ? -1 : 0) - (b.kind === "CHARGE" ? -1 : 0)
  );

  let charged = 0, paid = 0, waived = 0;
  for (const r of sorted) {
    if (!chargeCounts(r)) continue;
    if (r.kind === "CHARGE") charged += r.amount;
    else if (r.kind === "PAYMENT") paid += r.amount;
    else if (r.kind === "WAIVE") waived += r.amount;
  }

  let credit = paid + waived;
  const bills = sorted
    .filter((r) => r.kind === "CHARGE" && chargeCounts(r))
    .map((r) => {
      const settled = Math.min(credit, r.amount);
      credit -= settled;
      return { entry: r, orderId: r.orderId, charged: round2(r.amount), settled: round2(settled), pending: round2(r.amount - settled) };
    });

  let balance = 0;
  const history = sorted.map((r) => {
    const counts = chargeCounts(r);
    if (counts) balance += r.kind === "CHARGE" ? r.amount : -r.amount;
    return { entry: r, void: !counts, balanceAfter: round2(balance) };
  });

  const due = round2(charged - paid - waived);
  return {
    charged: round2(charged),
    paid: round2(paid),
    waived: round2(waived),
    /** Positive: the customer owes this. Negative: they have paid ahead. */
    due: Math.abs(due) < EPS ? 0 : due,
    bills,
    pendingBills: bills.filter((b) => b.pending > EPS),
    history,
  };
}

// ---------------------------------------------------------------- colours

export type KhataBand = "green" | "yellow" | "red";
export interface KhataLimits {
  /** Yellow once the due is above this. 0 = anything pending. */
  yellowAbove: number;
  /** Red once the due is above this. */
  redAbove: number;
}
export const DEFAULT_KHATA_LIMITS: KhataLimits = { yellowAbove: 0, redAbove: 1000 };

/**
 * Green: nothing to chase. Yellow: owes something. Red: owes a lot. Where the
 * lines fall is the owner's call — both limits are set on the Customers page.
 */
export function khataBand(due: number, limits: KhataLimits): KhataBand {
  if (due > limits.redAbove + EPS) return "red";
  if (due > limits.yellowAbove + EPS) return "yellow";
  return "green";
}

/** The owner's limits, or the defaults before any are saved. */
export async function khataLimits(): Promise<KhataLimits> {
  const row = await db.khataSettings.findUnique({ where: { id: "singleton" } });
  return row ? { yellowAbove: row.yellowAbove, redAbove: row.redAbove } : DEFAULT_KHATA_LIMITS;
}

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];
type Client = Tx | typeof db;

async function rowsFor(client: Client, userId: string) {
  return client.khataEntry.findMany({
    where: { userId },
    include: {
      order: {
        select: {
          id: true, orderNumber: true, status: true, placedAt: true, total: true, type: true, tableNo: true,
          branch: { select: { name: true } },
        },
      },
    },
  });
}

/** One customer's khata, with each entry's order. */
export async function loadKhata(userId: string, client: Client = db) {
  const rows = (await rowsFor(client, userId)).map((r) => ({ ...r, orderStatus: r.order?.status ?? null }));
  return summarizeKhata(rows);
}

/** What each customer owes — for lists. Customers with nothing on khata are absent. */
export async function khataDues(userIds?: string[]): Promise<Map<string, number>> {
  const rows = await db.khataEntry.findMany({
    where: userIds ? { userId: { in: userIds } } : {},
    select: { userId: true, kind: true, amount: true, order: { select: { status: true } } },
  });
  const due = new Map<string, number>();
  for (const r of rows) {
    if (!chargeCounts({ kind: r.kind, orderStatus: r.order?.status })) continue;
    due.set(r.userId, (due.get(r.userId) ?? 0) + (r.kind === "CHARGE" ? r.amount : -r.amount));
  }
  for (const [k, v] of due) due.set(k, Math.abs(v) < EPS ? 0 : round2(v));
  return due;
}

/**
 * Marks each khata order PAID once payments cover it, and back to owing if
 * they no longer do. Called after anything that moves the account.
 */
async function syncOrders(tx: Tx, userId: string) {
  const { bills } = await loadKhata(userId, tx);
  for (const b of bills) {
    if (!b.orderId) continue;
    const status = b.pending > EPS ? ON_KHATA : "PAID";
    await tx.order.updateMany({
      where: { id: b.orderId, paymentMethod: "KHATA", NOT: { paymentStatus: status } },
      data: { paymentStatus: status },
    });
    await tx.payment.updateMany({ where: { orderId: b.orderId, method: "KHATA" }, data: { status } });
  }
}

interface Staff {
  uid: string;
  name?: string;
}

/**
 * Puts a bill on the customer's khata, with anything they paid towards it
 * there and then.
 */
export async function chargeToKhata(
  tx: Tx,
  input: {
    userId: string;
    orderId: string;
    branchId: string;
    amount: number;
    paidNow?: number;
    paidNowMethod?: KhataMethod;
    staff: Staff;
  }
) {
  // Khata is a debt owed by someone we can find again. A guest is by
  // definition nobody in particular, so the one thing that must not happen is
  // a bill quietly parked against them.
  if (isGuest(input.userId))
    throw new HttpError(400, "A guest bill cannot go on khata — take their number first");
  const paidNow = round2(input.paidNow ?? 0);
  if (paidNow < 0) throw new HttpError(400, "The amount paid now cannot be negative");
  if (paidNow > input.amount + EPS)
    throw new HttpError(400, `Paid now (₹${paidNow}) is more than the bill (₹${input.amount})`);
  const who = { staffId: input.staff.uid, staffName: input.staff.name ?? null };
  await tx.khataEntry.create({
    data: { userId: input.userId, orderId: input.orderId, branchId: input.branchId, kind: "CHARGE", amount: round2(input.amount), ...who },
  });
  if (paidNow > 0)
    await tx.khataEntry.create({
      data: {
        userId: input.userId,
        orderId: input.orderId,
        branchId: input.branchId,
        kind: "PAYMENT",
        amount: paidNow,
        method: input.paidNowMethod ?? "CASH",
        note: "Paid with the bill",
        ...who,
      },
    });
  await syncOrders(tx, input.userId);
}

/**
 * Takes a payment against the account — all of it or any part — or waives an
 * amount. Refuses more than is owed: a slip of the finger that records ₹1000
 * for ₹100 would otherwise leave the customer showing as paid ahead.
 */
export async function settleKhata(input: {
  userId: string;
  amount: number;
  method: KhataMethod | "WAIVE";
  note?: string | null;
  branchId?: string | null;
  staff: Staff;
}) {
  const amount = round2(input.amount);
  if (!(amount > 0)) throw new HttpError(400, "Enter an amount above ₹0");
  return db.$transaction(async (tx) => {
    const { due } = await loadKhata(input.userId, tx);
    if (due <= 0) throw new HttpError(400, "Nothing is due on this khata");
    if (amount > due + EPS) throw new HttpError(400, `Only ₹${due} is due — enter that or less`);
    await tx.khataEntry.create({
      data: {
        userId: input.userId,
        kind: input.method === "WAIVE" ? "WAIVE" : "PAYMENT",
        method: input.method === "WAIVE" ? null : input.method,
        amount,
        note: input.note?.trim() || null,
        branchId: input.branchId ?? null,
        staffId: input.staff.uid,
        staffName: input.staff.name ?? null,
      },
    });
    await syncOrders(tx, input.userId);
    return loadKhata(input.userId, tx);
  });
}
