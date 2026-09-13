import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { KHATA_METHODS, loadKhata, settleKhata } from "@/lib/khata";

/**
 * One customer's khata: what they owe, bill by bill, and every entry since
 * the account was opened. POST takes a payment against it.
 *
 * Cashiers as well as managers: settling up happens at the till.
 */
async function customer(userId: string) {
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, name: true, phone: true, role: true } });
  if (!u || u.role !== "CUSTOMER") throw new HttpError(404, "Customer not found");
  return { id: u.id, name: u.name, phone: u.phone };
}

async function view(userId: string) {
  const k = await loadKhata(userId);
  const order = (e: (typeof k.history)[number]["entry"]) => e.order;
  return {
    customer: await customer(userId),
    due: k.due,
    charged: k.charged,
    paid: k.paid,
    waived: k.waived,
    pending: k.pendingBills.map((b) => ({
      orderId: b.orderId,
      orderNumber: b.entry.order?.orderNumber ?? null,
      placedAt: b.entry.order?.placedAt ?? b.entry.createdAt,
      branch: b.entry.order?.branch.name ?? null,
      type: b.entry.order?.type ?? null,
      tableNo: b.entry.order?.tableNo ?? null,
      charged: b.charged,
      settled: b.settled,
      pending: b.pending,
    })),
    // Newest first: the last thing that happened is what the owner looks for.
    history: [...k.history].reverse().map((h) => ({
      id: h.entry.id,
      kind: h.entry.kind,
      amount: h.entry.amount,
      method: h.entry.method,
      note: h.entry.note,
      staffName: h.entry.staffName,
      createdAt: h.entry.createdAt,
      orderNumber: order(h.entry)?.orderNumber ?? null,
      orderStatus: order(h.entry)?.status ?? null,
      void: h.void,
      balanceAfter: h.balanceAfter,
    })),
  };
}

export const GET = handler(async (_req: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
  const { userId } = await params;
  return NextResponse.json({ ...(await view(userId)), canWaive: s.role !== "CASHIER" });
});

const Settle = z.object({
  amount: z.number().positive().max(10_000_000),
  method: z.enum([...KHATA_METHODS, "WAIVE"]),
  note: z.string().max(300).nullish(),
  branchId: z.string().nullish(),
});

export const POST = handler(async (req: Request, { params }: { params: Promise<{ userId: string }> }) => {
  const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
  const { userId } = await params;
  const body = Settle.parse(await req.json());
  await customer(userId);
  // Letting money go is a manager's call, not the till's.
  if (body.method === "WAIVE" && s.role === "CASHIER")
    throw new HttpError(403, "Only the owner or a manager can waive an amount");

  const after = await settleKhata({ userId, ...body, staff: { uid: s.uid, name: s.name } });
  await audit({ uid: s.uid, name: s.name }, body.method === "WAIVE" ? "KHATA_WAIVED" : "KHATA_PAYMENT", "User", userId, {
    amount: body.amount,
    method: body.method,
    dueAfter: after.due,
    note: body.note ?? undefined,
  });
  return NextResponse.json({ ok: true, ...(await view(userId)), canWaive: s.role !== "CASHIER" });
});
