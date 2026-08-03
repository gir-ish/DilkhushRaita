import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  await requireStaff("MARKETING", "BRANCH_MANAGER");
  const tiers = await db.loyaltyTier.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ tiers });
});

const Body = z.object({
  tiers: z
    .array(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1).max(50),
        minCompletedOrders: z.number().int().min(0),
        minLifetimeSpend: z.number().min(0),
        pointMultiplier: z.number().min(0.1).max(10),
        freeDelivery: z.boolean(),
        discountPercent: z.number().min(0).max(50),
        benefitsText: z.string().max(300).default(""),
        sortOrder: z.number().int(),
      })
    )
    .min(1)
    .max(10),
});

/** Replace the tier ladder (owner-configurable names, thresholds, benefits). */
export const PUT = handler(async (req: Request) => {
  const s = await requireStaff("MARKETING");
  const { tiers } = Body.parse(await req.json());
  for (const t of tiers) {
    const { id, ...data } = t;
    if (id) await db.loyaltyTier.update({ where: { id }, data });
    else await db.loyaltyTier.create({ data });
  }
  await audit({ uid: s.uid, name: s.name }, "LOYALTY_TIERS_UPDATED", "LoyaltyTier", undefined, tiers);
  const out = await db.loyaltyTier.findMany({ orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ ok: true, tiers: out });
});
