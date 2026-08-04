import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";

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

  return NextResponse.json({
    customers: users.map((u) => ({
      id: u.id,
      name: u.name,
      phone: u.phone,
      completedOrders: u.metrics?.completedOrders ?? 0,
    })),
  });
});
