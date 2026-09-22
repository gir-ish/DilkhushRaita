import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { khataDues } from "@/lib/khata";
import { GUEST_USER_ID } from "@/lib/guest";

/**
 * Customer lookup for the counter screen — type a phone or name and pick the
 * returning customer instead of retyping their details.
 *
 * Deliberately narrower than /api/admin/customers: that one is manager/
 * marketing only and exposes lifetime spend and segments. Taking an order
 * needs a name and a number, nothing more, so cashiers get only that.
 */
export const GET = handler(async (req: Request) => {
  await requireStaff("BRANCH_MANAGER", "CASHIER", "DELIVERY_MANAGER");
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  // Two characters is not a search, it is a data dump.
  if (q.length < 3) return NextResponse.json({ customers: [] });

  const digits = q.replace(/\D/g, "");
  const users = await db.user.findMany({
    where: {
      role: "CUSTOMER",
      blocked: false,
      // The shared walk-in account is a billing destination, not a person to
      // look up — and picking it by accident would file a named customer's
      // order under Guest.
      id: { not: GUEST_USER_ID },
      OR: [
        { name: { contains: q } },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }] : []),
      ],
    },
    select: {
      id: true,
      name: true,
      phone: true,
      metrics: { select: { completedOrders: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 8,
  });

  // What each owes on khata, so the cashier sees it before adding to it.
  const dues = await khataDues(users.map((u) => u.id));
  return NextResponse.json({
    customers: users.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      completedOrders: u.metrics?.completedOrders ?? 0,
      khataDue: dues.get(u.id) ?? 0,
    })),
  });
});
