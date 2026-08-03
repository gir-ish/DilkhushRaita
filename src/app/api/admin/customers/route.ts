import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";

/** Customer list with metrics. ?q= name/phone search, ?segment= filter. */
export const GET = handler(async (req: Request) => {
  await requireStaff("BRANCH_MANAGER", "MARKETING");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const segment = url.searchParams.get("segment");

  const where: Record<string, unknown> = { role: "CUSTOMER" };
  if (q) where.OR = [{ name: { contains: q } }, { phone: { contains: q.replace(/\D/g, "") } }];

  const users = await db.user.findMany({
    where,
    include: { metrics: true, profile: { include: { loyaltyTier: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  let rows = users.map((u) => ({
    id: u.id,
    name: u.name,
    phone: u.phone,
    blocked: u.blocked,
    codOnlyBlock: u.codOnlyBlock,
    joined: u.createdAt,
    completedOrders: u.metrics?.completedOrders ?? 0,
    cancelledOrders: u.metrics?.cancelledOrders ?? 0,
    lifetimeSpend: u.metrics?.lifetimeSpend ?? 0,
    avgOrderValue: u.metrics?.avgOrderValue ?? 0,
    lastOrderAt: u.metrics?.lastOrderAt ?? null,
    loyaltyPoints: u.profile?.loyaltyPoints ?? 0,
    tier: u.profile?.loyaltyTier?.name ?? "New Customer",
  }));

  const now = Date.now();
  if (segment === "new") rows = rows.filter((r) => r.completedOrders === 0);
  if (segment === "frequent") rows = rows.filter((r) => r.completedOrders >= 5);
  if (segment === "high-spend") rows = rows.filter((r) => r.lifetimeSpend >= 3000);
  if (segment === "inactive-30")
    rows = rows.filter(
      (r) => r.lastOrderAt && now - new Date(r.lastOrderAt).getTime() > 30 * 86400000
    );

  return NextResponse.json({ customers: rows });
});
