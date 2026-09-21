import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, requireStaff } from "@/lib/guard";

/**
 * Parcels still waiting at the counter — ordered, not yet handed over.
 *
 * Whether taken at the counter or ordered online for pickup, each shows what
 * the kitchen is doing with it and whether it is paid, on khata, or still to
 * collect when the customer takes it.
 */
export const GET = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
  const branchId = new URL(req.url).searchParams.get("branchId");
  const scope = await allowedBranchIds(s);

  const orders = await db.order.findMany({
    where: {
      type: "PICKUP",
      status: { in: ["ACCEPTED", "PREPARING", "READY"] },
      // An online payment that never completed is not an order anyone is
      // waiting on — it is hidden everywhere else too.
      NOT: { paymentMethod: "ONLINE", paymentStatus: { not: "PAID" } },
      ...(branchId ? { branchId } : {}),
      ...(scope ? { branchId: { in: scope } } : {}),
    },
    orderBy: { placedAt: "asc" },
    include: {
      items: { orderBy: { addedAt: "asc" } },
      user: { select: { name: true, phone: true } },
    },
    take: 100,
  });

  return NextResponse.json({
    pickups: orders.map((o) => ({
      id: o.id,
      branchId: o.branchId,
      orderNumber: o.orderNumber,
      status: o.status,
      total: o.total,
      placedAt: o.placedAt,
      paymentMethod: o.paymentMethod,
      paymentStatus: o.paymentStatus,
      customer: { name: o.user.name, phone: o.user.phone },
      itemCount: o.items.reduce((n, i) => n + i.qty, 0),
      items: o.items.map((i) => ({ id: i.id, name: i.nameSnapshot, variantName: i.variantName, qty: i.qty, lineTotal: i.lineTotal })),
    })),
  });
});
