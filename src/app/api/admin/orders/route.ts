import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, requireStaff } from "@/lib/guard";
import { ACTIVE_STATUSES } from "@/lib/constants";

/**
 * Staff order queue. Filters: ?status= &branchId= &q= (order no / name / phone)
 * &paymentStatus= &active=1 &date=YYYY-MM-DD
 */
export const GET = handler(async (req: Request) => {
  const session = await requireStaff(
    "BRANCH_MANAGER",
    "KITCHEN",
    "CASHIER",
    "DELIVERY_MANAGER"
  );
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const status = url.searchParams.get("status");
  const paymentStatus = url.searchParams.get("paymentStatus");
  const branchId = url.searchParams.get("branchId");
  const active = url.searchParams.get("active");
  const date = url.searchParams.get("date");

  const scope = await allowedBranchIds(session);
  const where: Record<string, unknown> = {};
  if (branchId && branchId !== "all") where.branchId = branchId;
  else if (scope) where.branchId = { in: scope };
  if (status && status !== "all") where.status = status;
  if (active === "1") where.status = { in: ACTIVE_STATUSES };
  if (paymentStatus && paymentStatus !== "all") where.paymentStatus = paymentStatus;
  if (date) {
    const d = new Date(date);
    where.placedAt = { gte: d, lt: new Date(d.getTime() + 86400000) };
  }
  if (q) {
    where.OR = [
      { orderNumber: { contains: q.toUpperCase() } },
      { user: { name: { contains: q } } },
      { user: { phone: { contains: q.replace(/\D/g, "") } } },
    ];
  }

  const orders = await db.order.findMany({
    where,
    orderBy: { placedAt: "desc" },
    take: 100,
    include: {
      items: true,
      user: { select: { name: true, phone: true } },
      branch: { select: { name: true, slug: true } },
      deliveryAgent: { include: { user: { select: { name: true } } } },
    },
  });
  return NextResponse.json({ orders });
});
