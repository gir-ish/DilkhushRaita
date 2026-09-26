import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { round2 } from "@/lib/utils";
import {
  CATEGORY_KEYS,
  PAID_BY,
  istDayKeyOf,
  istDayStart,
  istMonthKey,
  istMonthRange,
  summarise,
} from "@/lib/expenses";

/**
 * The owner's account book: money going out, a month at a time.
 *
 * Owner only, and deliberately so — this is the shop's own hisaab, not
 * something a cashier needs or should see. `requireStaff("OWNER")` lets
 * nobody else through.
 *
 * A month is the unit because that is how a shop is reconciled: rent, wages
 * and the electricity bill all land once, and a day on its own cannot say
 * whether the month is going well.
 */

const Body = z.object({
  /** YYYY-MM-DD, the Indian day this belongs to. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  branchId: z.string().nullish(),
  category: z.enum(CATEGORY_KEYS),
  payee: z.string().max(80).nullish(),
  note: z.string().max(300).nullish(),
  amount: z.number().positive().max(10_000_000),
  paidBy: z.enum(PAID_BY).default("CASH"),
  unpaid: z.boolean().default(false),
});

export const GET = handler(async (req: Request) => {
  await requireStaff("OWNER");
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? istMonthKey();
  const branchId = url.searchParams.get("branchId");
  const category = url.searchParams.get("category");
  const q = url.searchParams.get("q")?.trim();

  const range = istMonthRange(month);
  if (!range) throw new HttpError(400, "Pick a month as YYYY-MM.");

  const where = {
    date: { gte: range.start, lt: range.end },
    ...(branchId === "both" ? { branchId: null } : branchId ? { branchId } : {}),
    ...(category ? { category } : {}),
    ...(q
      ? { OR: [{ payee: { contains: q } }, { note: { contains: q } }] }
      : {}),
  };

  const [rows, branches] = await Promise.all([
    db.expense.findMany({
      where,
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      include: { branch: { select: { id: true, name: true, slug: true } } },
    }),
    db.branch.findMany({ select: { id: true, name: true, slug: true } }),
  ]);

  /*
   * What came in over the same days, so a month can be read as a whole rather
   * than as a pile of receipts. Cancelled and rejected orders are not money.
   */
  const orders = await db.order.findMany({
    where: {
      placedAt: { gte: range.start, lt: range.end },
      status: { notIn: ["CANCELLED", "REJECTED"] },
      ...(branchId && branchId !== "both" ? { branchId } : {}),
    },
    select: { placedAt: true, total: true, branchId: true },
  });
  const salesByDay: Record<string, number> = {};
  let sales = 0;
  for (const o of orders) {
    sales += o.total;
    const day = istDayKeyOf(o.placedAt);
    salesByDay[day] = round2((salesByDay[day] ?? 0) + o.total);
  }

  const summary = summarise(rows);

  return NextResponse.json({
    month,
    expenses: rows.map((r) => ({
      id: r.id,
      date: istDayKeyOf(r.date),
      branchId: r.branchId,
      branchName: r.branch?.name ?? null,
      category: r.category,
      payee: r.payee,
      note: r.note,
      amount: r.amount,
      paidBy: r.paidBy,
      unpaid: r.unpaid,
      createdBy: r.createdBy,
    })),
    summary,
    sales: { total: round2(sales), byDay: salesByDay, orders: orders.length },
    branches,
    /** Names used before, so the same helper is not spelt three ways. */
    payees: [...new Set(rows.map((r) => r.payee).filter(Boolean))].slice(0, 200),
  });
});

export const POST = handler(async (req: Request) => {
  const s = await requireStaff("OWNER");
  const body = Body.parse(await req.json());

  const date = istDayStart(body.date);
  if (!date) throw new HttpError(400, "That is not a valid date.");
  if (body.branchId) {
    const branch = await db.branch.findUnique({ where: { id: body.branchId } });
    if (!branch) throw new HttpError(400, "That branch no longer exists.");
  }

  const saved = await db.expense.create({
    data: {
      date,
      branchId: body.branchId ?? null,
      category: body.category,
      payee: body.payee?.trim() || null,
      note: body.note?.trim() || null,
      amount: round2(body.amount),
      paidBy: body.paidBy,
      unpaid: body.unpaid,
      createdBy: s.name ?? null,
    },
  });

  await audit({ uid: s.uid, name: s.name }, "EXPENSE_ADDED", "Expense", saved.id, {
    date: body.date,
    category: body.category,
    amount: saved.amount,
    payee: saved.payee,
  });

  return NextResponse.json({ ok: true, id: saved.id });
});
