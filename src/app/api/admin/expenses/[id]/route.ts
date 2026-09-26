import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { round2 } from "@/lib/utils";
import { CATEGORY_KEYS, PAID_BY, istDayStart } from "@/lib/expenses";

/**
 * Correct or remove one entry.
 *
 * An account book is written in a hurry at the end of a shift, so every field
 * can be put right afterwards — the wrong day, the wrong branch, a figure
 * typed twice. Each change is audited, so the book can be corrected without
 * the corrections themselves going unrecorded.
 */

const Body = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  branchId: z.string().nullish(),
  category: z.enum(CATEGORY_KEYS).optional(),
  payee: z.string().max(80).nullish(),
  note: z.string().max(300).nullish(),
  amount: z.number().positive().max(10_000_000).optional(),
  paidBy: z.enum(PAID_BY).optional(),
  unpaid: z.boolean().optional(),
});

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const s = await requireStaff("OWNER");
    const { id } = await params;
    const body = Body.parse(await req.json());

    const before = await db.expense.findUnique({ where: { id } });
    if (!before) throw new HttpError(404, "That entry no longer exists.");

    let date: Date | undefined;
    if (body.date !== undefined) {
      const parsed = istDayStart(body.date);
      if (!parsed) throw new HttpError(400, "That is not a valid date.");
      date = parsed;
    }
    if (body.branchId) {
      const branch = await db.branch.findUnique({ where: { id: body.branchId } });
      if (!branch) throw new HttpError(400, "That branch no longer exists.");
    }

    const saved = await db.expense.update({
      where: { id },
      data: {
        ...(date ? { date } : {}),
        ...(body.branchId !== undefined ? { branchId: body.branchId || null } : {}),
        ...(body.category ? { category: body.category } : {}),
        ...(body.payee !== undefined ? { payee: body.payee?.trim() || null } : {}),
        ...(body.note !== undefined ? { note: body.note?.trim() || null } : {}),
        ...(body.amount !== undefined ? { amount: round2(body.amount) } : {}),
        ...(body.paidBy ? { paidBy: body.paidBy } : {}),
        ...(body.unpaid !== undefined ? { unpaid: body.unpaid } : {}),
      },
    });

    await audit({ uid: s.uid, name: s.name }, "EXPENSE_EDITED", "Expense", id, {
      from: { amount: before.amount, category: before.category, payee: before.payee },
      to: { amount: saved.amount, category: saved.category, payee: saved.payee },
    });

    return NextResponse.json({ ok: true });
  }
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const s = await requireStaff("OWNER");
    const { id } = await params;
    const entry = await db.expense.findUnique({ where: { id } });
    if (!entry) throw new HttpError(404, "That entry no longer exists.");

    await db.expense.delete({ where: { id } });
    await audit({ uid: s.uid, name: s.name }, "EXPENSE_DELETED", "Expense", id, {
      amount: entry.amount,
      category: entry.category,
      payee: entry.payee,
      date: entry.date,
    });
    return NextResponse.json({ ok: true });
  }
);
