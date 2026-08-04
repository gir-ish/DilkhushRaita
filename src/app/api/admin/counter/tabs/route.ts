import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, requireStaff } from "@/lib/guard";
import { TERMINAL_STATUSES } from "@/lib/constants";

/**
 * Open dine-in tabs — tables that are still eating and have not paid.
 *
 * A tab is a DINE_IN order that is neither finished nor settled. Staff add
 * further rounds to it and bill once at the end.
 */
export const GET = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER", "CASHIER");
  const branchId = new URL(req.url).searchParams.get("branchId");

  const scope = await allowedBranchIds(s);
  const tabs = await db.order.findMany({
    where: {
      type: "DINE_IN",
      paymentStatus: "PENDING",
      status: { notIn: [...TERMINAL_STATUSES] },
      ...(branchId ? { branchId } : {}),
      ...(scope ? { branchId: { in: scope } } : {}),
    },
    orderBy: { placedAt: "asc" },
    include: {
      items: { orderBy: { addedAt: "asc" } },
      user: { select: { name: true, phone: true } },
      branch: { select: { name: true, slug: true } },
    },
  });

  return NextResponse.json({
    tabs: tabs.map((t) => ({
      id: t.id,
      orderNumber: t.orderNumber,
      tableNo: t.tableNo,
      status: t.status,
      total: t.total,
      placedAt: t.placedAt,
      customer: { name: t.user.name, phone: t.user.phone },
      branch: t.branch,
      rounds: Math.max(...t.items.map((i) => i.round), 1),
      itemCount: t.items.reduce((n, i) => n + i.qty, 0),
      items: t.items.map((i) => ({
        id: i.id,
        name: i.nameSnapshot,
        variantName: i.variantName,
        qty: i.qty,
        lineTotal: i.lineTotal,
        round: i.round,
      })),
    })),
  });
});
