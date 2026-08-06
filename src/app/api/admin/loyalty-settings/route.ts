import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { invalidateLoyaltyRates, loyaltySettingsRow } from "@/lib/loyalty-settings";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  await requireStaff("MARKETING", "BRANCH_MANAGER");
  return NextResponse.json({ settings: await loyaltySettingsRow() });
});

const Body = z.object({
  // Bounded on purpose: these multiply into every order total, and a stray
  // zero or an extra digit here is a direct hit to the day's takings.
  pointsPer10Rupees: z.number().min(0).max(100),
  pointValueRupees: z.number().min(0.01).max(100),
  minPointsToRedeem: z.number().int().min(1).max(100000),
});

export const PUT = handler(async (req: Request) => {
  const s = await requireStaff("MARKETING");
  const body = Body.parse(await req.json());

  await loyaltySettingsRow(); // make sure the row exists before updating
  const settings = await db.loyaltySettings.update({
    where: { id: "singleton" },
    data: body,
  });
  invalidateLoyaltyRates();

  await audit({ uid: s.uid, name: s.name }, "LOYALTY_SETTINGS_UPDATED", "LoyaltySettings", settings.id, body);
  return NextResponse.json({ ok: true, settings });
});
