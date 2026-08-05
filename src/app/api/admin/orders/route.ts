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

  const and: unknown[] = [];
  // An online order is written to the database before its payment window even
  // opens, so an unpaid one is not yet a real order. Keep it out of the working
  // queue entirely — otherwise the kitchen cooks food nobody has paid for, and
  // a customer who simply closed the tab leaves a ticket behind.
  if (active === "1")
    and.push({ NOT: { paymentMethod: "ONLINE", paymentStatus: { not: "PAID" } } });
  // Abandoned online payments are noise rather than business, so the default
  // list hides them. Still reachable by filtering explicitly on CANCELLED.
  if (!status || status === "all")
    and.push({
      NOT: { status: "CANCELLED", paymentMethod: "ONLINE", paymentStatus: { not: "PAID" } },
    });
  if (and.length) where.AND = and;
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
      // address/phone/taxPercent are the bill header — printing a bill must not
      // need a second round trip.
      branch: {
        select: {
          name: true,
          slug: true,
          address: true,
          pincode: true,
          phone: true,
          taxPercent: true,
        },
      },
      deliveryAgent: { include: { user: { select: { name: true } } } },
    },
  });
  return NextResponse.json({ orders });
});
