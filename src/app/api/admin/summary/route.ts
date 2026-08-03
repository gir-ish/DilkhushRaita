import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, requireStaff } from "@/lib/guard";
import { ACTIVE_STATUSES } from "@/lib/constants";
import { round2 } from "@/lib/utils";

function rangeFromParam(range: string, from?: string | null, to?: string | null) {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  switch (range) {
    case "yesterday": {
      const s = startOfDay(new Date(now.getTime() - 86400000));
      return { gte: s, lt: startOfDay(now) };
    }
    case "7d":
      return { gte: new Date(now.getTime() - 7 * 86400000), lt: now };
    case "30d":
      return { gte: new Date(now.getTime() - 30 * 86400000), lt: now };
    case "custom":
      return {
        gte: from ? new Date(from) : startOfDay(now),
        lt: to ? new Date(new Date(to).getTime() + 86400000) : now,
      };
    default:
      return { gte: startOfDay(now), lt: now };
  }
}

export const GET = handler(async (req: Request) => {
  const session = await requireStaff("BRANCH_MANAGER", "CASHIER", "DELIVERY_MANAGER", "MARKETING");
  const url = new URL(req.url);
  const range = rangeFromParam(
    url.searchParams.get("range") ?? "today",
    url.searchParams.get("from"),
    url.searchParams.get("to")
  );
  const branchParam = url.searchParams.get("branchId");
  const scope = await allowedBranchIds(session);
  const branchFilter =
    branchParam && branchParam !== "all"
      ? { branchId: branchParam }
      : scope
        ? { branchId: { in: scope } }
        : {};

  const inRange = { placedAt: range, ...branchFilter };
  const [orders, activeOrders, branches, newCustomers, itemAgg] = await Promise.all([
    db.order.findMany({ where: inRange, include: { user: { select: { id: true } } } }),
    db.order.count({ where: { status: { in: ACTIVE_STATUSES }, ...branchFilter } }),
    db.branch.findMany({ select: { id: true, name: true } }),
    db.user.count({ where: { role: "CUSTOMER", createdAt: range } }),
    db.orderItem.groupBy({
      by: ["nameSnapshot"],
      where: { order: { ...inRange, status: { notIn: ["CANCELLED", "REJECTED"] } } },
      _sum: { qty: true, lineTotal: true },
      orderBy: { _sum: { qty: "desc" } },
      take: 8,
    }),
  ]);

  const done = orders.filter((o) => o.status === "DELIVERED");
  const cancelled = orders.filter((o) => ["CANCELLED", "REJECTED"].includes(o.status));
  const revenue = round2(done.reduce((s, o) => s + o.total, 0));
  const discountCost = round2(done.reduce((s, o) => s + o.discount + o.loyaltyCredit, 0));
  const uniqueCustomers = new Set(orders.map((o) => o.userId));

  const byBranch = branches.map((b) => {
    const bo = orders.filter((o) => o.branchId === b.id);
    const bd = bo.filter((o) => o.status === "DELIVERED");
    return {
      id: b.id,
      name: b.name,
      orders: bo.length,
      delivered: bd.length,
      revenue: round2(bd.reduce((s, o) => s + o.total, 0)),
      cancelled: bo.filter((o) => ["CANCELLED", "REJECTED"].includes(o.status)).length,
    };
  });

  const byHour: Record<number, number> = {};
  for (const o of orders) {
    const h = new Date(o.placedAt.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getHours();
    byHour[h] = (byHour[h] ?? 0) + 1;
  }

  const paymentBreakdown: Record<string, { count: number; amount: number }> = {};
  for (const o of done) {
    const k = o.paymentMethod;
    paymentBreakdown[k] = paymentBreakdown[k] ?? { count: 0, amount: 0 };
    paymentBreakdown[k].count++;
    paymentBreakdown[k].amount = round2(paymentBreakdown[k].amount + o.total);
  }

  const couponUse = orders.filter((o) => o.couponCode).length;
  const avgDeliveryMins =
    done.filter((o) => o.deliveredAt).length > 0
      ? Math.round(
          done
            .filter((o) => o.deliveredAt)
            .reduce((s, o) => s + (o.deliveredAt!.getTime() - o.placedAt.getTime()) / 60000, 0) /
            done.filter((o) => o.deliveredAt).length
        )
      : null;

  return NextResponse.json({
    revenue,
    totalOrders: orders.length,
    completedOrders: done.length,
    cancelledOrders: cancelled.length,
    activeOrders,
    newCustomers,
    uniqueCustomers: uniqueCustomers.size,
    avgOrderValue: done.length ? round2(revenue / done.length) : 0,
    discountCost,
    couponUse,
    avgDeliveryMins,
    byBranch,
    byHour,
    paymentBreakdown,
    bestsellers: itemAgg.map((i) => ({
      name: i.nameSnapshot,
      qty: i._sum.qty ?? 0,
      revenue: round2(i._sum.lineTotal ?? 0),
    })),
  });
});
