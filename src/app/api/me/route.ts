import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireCustomer } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { tierFor, pointsValue } from "@/lib/loyalty";
import { loyaltyRates } from "@/lib/loyalty-settings";

/** Session + profile summary. Returns { user: null } when signed out. */
export const GET = handler(async () => {
  const session = await getSession();
  if (!session || session.role !== "CUSTOMER") return NextResponse.json({ user: null });

  const [user, tiers] = await Promise.all([
    db.user.findUnique({
      where: { id: session.uid },
      include: { profile: true, metrics: true },
    }),
    db.loyaltyTier.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  if (!user) return NextResponse.json({ user: null });

  const tier = tierFor(tiers, {
    completedOrders: user.metrics?.completedOrders ?? 0,
    lifetimeSpend: user.metrics?.lifetimeSpend ?? 0,
  });
  const next = tiers.find((t) => t.sortOrder === (tier?.sortOrder ?? -1) + 1);

  return NextResponse.json({
    user: {
      id: user.id,
      name: user.name,
      phone: user.phone,
      notifyPromos: user.profile?.notifyPromos ?? true,
      birthday: user.profile?.birthday ?? null,
      anniversary: user.profile?.anniversary ?? null,
      referralCode: user.profile?.referralCode ?? null,
      storeCredit: user.profile?.storeCredit ?? 0,
      loyaltyPoints: user.profile?.loyaltyPoints ?? 0,
      pointsValue: pointsValue(user.profile?.loyaltyPoints ?? 0, await loyaltyRates()),
      completedOrders: user.metrics?.completedOrders ?? 0,
      tier: tier ? { name: tier.name, benefits: tier.benefitsText } : null,
      nextTier: next
        ? { name: next.name, ordersNeeded: Math.max(0, next.minCompletedOrders - (user.metrics?.completedOrders ?? 0)) }
        : null,
    },
  });
});

const Patch = z.object({
  name: z.string().min(1).max(60).optional(),
  notifyPromos: z.boolean().optional(),
  birthday: z.string().nullish(),
  anniversary: z.string().nullish(),
});

export const PATCH = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = Patch.parse(await req.json());
  if (body.name)
    await db.user.update({ where: { id: session.uid }, data: { name: body.name.trim() } });
  await db.customerProfile.update({
    where: { userId: session.uid },
    data: {
      ...(body.notifyPromos !== undefined ? { notifyPromos: body.notifyPromos } : {}),
      ...(body.birthday !== undefined
        ? { birthday: body.birthday ? new Date(body.birthday) : null }
        : {}),
      ...(body.anniversary !== undefined
        ? { anniversary: body.anniversary ? new Date(body.anniversary) : null }
        : {}),
    },
  });
  return NextResponse.json({ ok: true });
});
