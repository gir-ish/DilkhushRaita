import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { khataLimits } from "@/lib/khata";

/**
 * Where the khata colours change. Anyone who sees the colours may read the
 * limits; only the owner or a manager changes them.
 */
export const GET = handler(async () => {
  await requireStaff("BRANCH_MANAGER", "CASHIER", "MARKETING");
  return NextResponse.json(await khataLimits());
});

const Body = z.object({
  yellowAbove: z.number().min(0).max(10_000_000),
  redAbove: z.number().min(0).max(10_000_000),
});

export const PUT = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const body = Body.parse(await req.json());
  if (body.redAbove < body.yellowAbove)
    throw new HttpError(400, "The red limit must be at least the yellow limit");
  const before = await khataLimits();
  await db.khataSettings.upsert({ where: { id: "singleton" }, create: { id: "singleton", ...body }, update: body });
  await audit({ uid: s.uid, name: s.name }, "KHATA_LIMITS_CHANGED", "KhataSettings", "singleton", { from: before, to: body });
  return NextResponse.json({ ok: true, ...body });
});
