import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { smsSettings } from "@/lib/points-sms";

/** Messages the shop sends by itself — for now, the points SMS after a big order. */
export const GET = handler(async () => {
  await requireStaff("MARKETING", "BRANCH_MANAGER");
  return NextResponse.json(await smsSettings());
});

const Body = z.object({
  pointsSmsEnabled: z.boolean(),
  pointsSmsMinOrder: z.number().min(0).max(1_000_000),
});

export const PUT = handler(async (req: Request) => {
  const s = await requireStaff("MARKETING");
  const body = Body.parse(await req.json());
  const before = await smsSettings();
  await db.smsSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...body }, update: body });
  await audit({ uid: s.uid, name: s.name }, "SMS_SETTINGS_CHANGED", "SmsSettings", "singleton", { from: before, to: body });
  return NextResponse.json({ ok: true, ...body });
});
