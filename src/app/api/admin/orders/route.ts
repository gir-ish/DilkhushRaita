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
  // Online orders whose payment never arrived, which the other views hide.
  const unpaid = url.searchParams.get("unpaid");

  const scope = await allowedBranchIds(session);
  const where: Record<string, unknown> = {};
  if (branchId && branchId !== "all") where.branchId = branchId;
  else if (scope) where.branchId = { in: scope };
  if (status && status !== "all") where.status = status;
  if (active === "1") where.status = { in: ACTIVE_STATUSES };
  if (paymentStatus && paymentStatus !== "all") where.paymentStatus = paymentStatus;

  const and: unknown[] = [];
  const unpaidOnline = { paymentMethod: "ONLINE", paymentStatus: { not: "PAID" } };

  if (unpaid === "1") {
    // The parked pile, asked for explicitly.
    and.push(unpaidOnline);
  } else if (active === "1" || ((!status || status === "all") && (!paymentStatus || paymentStatus === "all"))) {
    /*
     * An online order is written to the database before its payment window can
     * even open — the gateway order needs a receipt to point at. Until the money
     * arrives it is an intention, not an order: the customer may still be
     * choosing a UPI app, or may have refreshed the page and wandered off.
     *
     * Showing those in the queue means the kitchen cooks food nobody paid for,
     * and the owner cannot tell a real order from an abandoned one. They are
     * hidden until PAID, and reachable on demand with ?unpaid=1.
     */
    and.push({ NOT: unpaidOnline });
  }
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
