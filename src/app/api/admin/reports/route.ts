import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, HttpError, requireStaff } from "@/lib/guard";
import { toCsv } from "@/lib/csv";
import { round2 } from "@/lib/utils";

/**
 * Reports. ?type=sales|items|coupons|customers|cod &from=YYYY-MM-DD &to=…
 * &branchId= &format=csv
 */
export const GET = handler(async (req: Request) => {
  const session = await requireStaff("BRANCH_MANAGER", "CASHIER", "MARKETING");
  const url = new URL(req.url);
  const type = url.searchParams.get("type") ?? "sales";
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const branchId = url.searchParams.get("branchId");
  const asCsv = url.searchParams.get("format") === "csv";

  const scope = await allowedBranchIds(session);
  const branchFilter =
    branchId && branchId !== "all"
      ? { branchId }
      : scope
        ? { branchId: { in: scope } }
        : {};
  const dateFilter = {
    gte: from ? new Date(from) : new Date(Date.now() - 30 * 86400000),
    lt: to ? new Date(new Date(to).getTime() + 86400000) : new Date(),
  };

  let rows: Array<Record<string, unknown>> = [];

  if (type === "sales") {
    const orders = await db.order.findMany({
      where: { placedAt: dateFilter, ...branchFilter },
      include: { branch: { select: { name: true } } },
      orderBy: { placedAt: "asc" },
    });
    const byDay = new Map<string, { orders: number; delivered: number; revenue: number; discounts: number; deliveryFees: number; tax: number; cancelled: number }>();
    for (const o of orders) {
      const day = o.placedAt.toISOString().slice(0, 10);
      const d = byDay.get(day) ?? { orders: 0, delivered: 0, revenue: 0, discounts: 0, deliveryFees: 0, tax: 0, cancelled: 0 };
      d.orders++;
      if (o.status === "DELIVERED") {
        d.delivered++;
        d.revenue = round2(d.revenue + o.total);
        d.discounts = round2(d.discounts + o.discount + o.loyaltyCredit);
        d.deliveryFees = round2(d.deliveryFees + o.deliveryFee);
        d.tax = round2(d.tax + o.tax);
      }
      if (["CANCELLED", "REJECTED"].includes(o.status)) d.cancelled++;
      byDay.set(day, d);
    }
    rows = [...byDay.entries()].map(([date, d]) => ({ date, ...d }));
  } else if (type === "items") {
    const agg = await db.orderItem.groupBy({
      by: ["nameSnapshot"],
      where: {
        order: { placedAt: dateFilter, status: { notIn: ["CANCELLED", "REJECTED"] }, ...branchFilter },
      },
      _sum: { qty: true, lineTotal: true },
      _count: { _all: true },
      orderBy: { _sum: { qty: "desc" } },
    });
    rows = agg.map((a) => ({
      item: a.nameSnapshot,
      unitsSold: a._sum.qty ?? 0,
      revenue: round2(a._sum.lineTotal ?? 0),
      orderLines: a._count._all,
    }));
  } else if (type === "coupons") {
    const reds = await db.couponRedemption.findMany({
      where: { createdAt: dateFilter },
      include: { coupon: true, order: { select: { total: true, status: true, subtotal: true } } },
    });
    const byCoupon = new Map<string, { code: string; name: string; uses: number; totalSaved: number; revenue: number; avgCart: number }>();
    for (const r of reds) {
      const d = byCoupon.get(r.couponId) ?? { code: r.coupon.code, name: r.coupon.name, uses: 0, totalSaved: 0, revenue: 0, avgCart: 0 };
      d.uses++;
      d.totalSaved = round2(d.totalSaved + r.amountSaved);
      if (r.order.status === "DELIVERED") d.revenue = round2(d.revenue + r.order.total);
      d.avgCart = round2((d.avgCart * (d.uses - 1) + r.order.subtotal) / d.uses);
      byCoupon.set(r.couponId, d);
    }
    rows = [...byCoupon.values()];
  } else if (type === "customers") {
    const metrics = await db.customerMetrics.findMany({
      include: { user: { select: { name: true, phone: true, createdAt: true } } },
      orderBy: { lifetimeSpend: "desc" },
      take: 500,
    });
    rows = metrics.map((m) => ({
      name: m.user.name ?? "",
      phone: m.user.phone ?? "",
      joined: m.user.createdAt.toISOString().slice(0, 10),
      completedOrders: m.completedOrders,
      cancelledOrders: m.cancelledOrders,
      lifetimeSpend: m.lifetimeSpend,
      avgOrderValue: m.avgOrderValue,
      lastOrderAt: m.lastOrderAt?.toISOString().slice(0, 10) ?? "",
    }));
  } else if (type === "cod") {
    const orders = await db.order.findMany({
      where: {
        placedAt: dateFilter,
        paymentMethod: "COD",
        status: "DELIVERED",
        ...branchFilter,
      },
      include: {
        branch: { select: { name: true } },
        deliveryAgent: { include: { user: { select: { name: true } } } },
      },
    });
    rows = orders.map((o) => ({
      orderNumber: o.orderNumber,
      date: o.placedAt.toISOString().slice(0, 10),
      branch: o.branch.name,
      agent: o.deliveryAgent?.user.name ?? "—",
      cashCollected: o.total,
    }));
  } else {
    throw new HttpError(400, "Unknown report type");
  }

  if (asCsv)
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename=${type}-report.csv`,
      },
    });
  return NextResponse.json({ rows });
});
