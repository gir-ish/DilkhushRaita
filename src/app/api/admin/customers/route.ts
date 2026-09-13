import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { khataBand, khataDues, khataLimits, type KhataBand } from "@/lib/khata";

/**
 * Customer list with metrics. ?q= name/phone search, ?segment= filter,
 * ?band=green|yellow|red khata colour.
 */
export const GET = handler(async (req: Request) => {
  await requireStaff("BRANCH_MANAGER", "MARKETING");
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim();
  const segment = url.searchParams.get("segment");
  const bandParam = url.searchParams.get("band");
  const band = (["green", "yellow", "red"] as const).find((b) => b === bandParam) ?? null;

  const where: Record<string, unknown> = { role: "CUSTOMER" };
  if (q) where.OR = [{ name: { contains: q } }, { phone: { contains: q.replace(/\D/g, "") } }];

  const users = await db.user.findMany({
    where,
    include: { metrics: true, profile: { include: { loyaltyTier: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  // All dues, not only this page's: the khata filters and the shop-wide
  // totals must not depend on which 200 customers happen to be listed.
  const [dues, limits] = await Promise.all([khataDues(), khataLimits()]);
  const bandOf = (id: string) => khataBand(dues.get(id) ?? 0, limits);

  // Everyone who owes is listed when asked for, even beyond the newest 200.
  if (segment === "khata" || band === "yellow" || band === "red") {
    const owing = [...dues].filter(([, d]) => d > 0).map(([id]) => id);
    const more = await db.user.findMany({
      where: { id: { in: owing.filter((id) => !users.some((u) => u.id === id)) }, ...(q ? { OR: where.OR as never } : {}) },
      include: { metrics: true, profile: { include: { loyaltyTier: true } } },
    });
    users.push(...more);
  }

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
    khataDue: dues.get(u.id) ?? 0,
    khataBand: bandOf(u.id),
  }));

  const now = Date.now();
  if (segment === "new") rows = rows.filter((r) => r.completedOrders === 0);
  if (segment === "frequent") rows = rows.filter((r) => r.completedOrders >= 5);
  if (segment === "high-spend") rows = rows.filter((r) => r.lifetimeSpend >= 3000);
  if (segment === "inactive-30")
    rows = rows.filter(
      (r) => r.lastOrderAt && now - new Date(r.lastOrderAt).getTime() > 30 * 86400000
    );
  if (segment === "khata") rows = rows.filter((r) => r.khataDue > 0);
  if (band) rows = rows.filter((r) => r.khataBand === band);
  // Whoever owes most first, whenever the list is about money owed.
  if (segment === "khata" || band === "yellow" || band === "red") rows.sort((a, b) => b.khataDue - a.khataDue);

  // Shop-wide counts per colour, for the filter chips.
  const allCustomers = await db.user.count({ where: { role: "CUSTOMER" } });
  const counts: Record<KhataBand, number> = { green: 0, yellow: 0, red: 0 };
  for (const [, d] of dues) counts[khataBand(d, limits)]++;
  counts.green = allCustomers - counts.yellow - counts.red;

  const owing = [...dues.values()].filter((d) => d > 0);
  return NextResponse.json({
    customers: rows,
    khata: {
      totalDue: Math.round(owing.reduce((s, d) => s + d, 0) * 100) / 100,
      customers: owing.length,
      limits,
      counts,
    },
  });
});
