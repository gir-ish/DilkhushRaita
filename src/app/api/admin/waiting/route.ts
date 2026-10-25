import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, requireStaff } from "@/lib/guard";

/**
 * Website orders nobody has accepted yet — the short answer.
 *
 * The order queue can give the same list, but it returns a hundred orders
 * with every item, customer and branch attached, which is the right shape for
 * a screen and the wrong one for something asking "anything waiting?" every
 * fifteen seconds. The phone app does exactly that, all day, on mobile data.
 *
 * So: the few fields an alert needs and nothing else. Same session, same
 * branch scoping, same database — this is a narrower window onto the queue,
 * not a second copy of it.
 */
export const dynamic = "force-dynamic";

export const GET = handler(async () => {
  const session = await requireStaff("BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER");
  const scope = await allowedBranchIds(session);

  const orders = await db.order.findMany({
    where: {
      status: "PLACED",
      channel: "ONLINE",
      ...(scope ? { branchId: { in: scope } } : {}),
    },
    orderBy: { placedAt: "asc" },
    take: 50,
    select: {
      id: true,
      orderNumber: true,
      type: true,
      total: true,
      placedAt: true,
      contactName: true,
      user: { select: { name: true } },
      branch: { select: { name: true } },
      _count: { select: { items: true } },
    },
  });

  return NextResponse.json({
    count: orders.length,
    orders: orders.map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      type: o.type,
      total: o.total,
      placedAt: o.placedAt,
      itemCount: o._count.items,
      customerName: o.user?.name ?? o.contactName,
      branchName: o.branch.name,
    })),
  });
});
