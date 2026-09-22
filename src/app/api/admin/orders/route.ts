import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, requireStaff } from "@/lib/guard";
import { ACTIVE_STATUSES } from "@/lib/constants";

/**
 * Staff order queue. Filters: ?status= &branchId= &q= (order no / name / phone)
 * &paymentStatus= &active=1 &date=YYYY-MM-DD &channel=ONLINE|COUNTER
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
  // Website orders or till orders. The online queue is the one that needs
  // watching: those are the orders nobody has said yes to yet.
  const channel = url.searchParams.get("channel");
  const active = url.searchParams.get("active");
  const date = url.searchParams.get("date");
  // Online orders whose payment never arrived, which the other views hide.
  const unpaid = url.searchParams.get("unpaid");

  const scope = await allowedBranchIds(session);
  const where: Record<string, unknown> = {};
  if (branchId && branchId !== "all") where.branchId = branchId;
  else if (scope) where.branchId = { in: scope };
  if (channel === "ONLINE" || channel === "COUNTER") where.channel = channel;
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
    // An Indian day, not a UTC one: an order taken at half past midnight in
    // Delhi belongs to that date, and a UTC window would file it under
    // yesterday.
    const start = new Date(`${date}T00:00:00+05:30`);
    if (!Number.isNaN(start.getTime()))
      where.placedAt = { gte: start, lt: new Date(start.getTime() + 86400000) };
  }
  if (q) {
    /*
     * Numbers read like 210926-0001, so "0001" on its own is how anyone
     * searches: a plain "contains" finds it within that day's number, and the
     * date filter beside it separates one day's 0001 from another's. Older
     * orders still carry their old DK… number, which the same search finds.
     */
    const digits = q.replace(/\D/g, "");
    where.OR = [
      { orderNumber: { contains: q.toUpperCase().replace(/\s+/g, "") } },
      { user: { name: { contains: q } } },
      // Four digits or fewer is somebody typing an order number; matching it
      // against phone numbers too would bury 210926-0001 under every customer
      // whose number happens to contain 0001.
      ...(digits.length >= 5 ? [{ user: { phone: { contains: digits } } }] : []),
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
