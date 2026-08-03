import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { CouponBody, couponToDb } from "@/lib/validation";
import { audit } from "@/lib/audit";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("MARKETING");
    const body = CouponBody.partial().parse(await req.json());
    const data =
      body.code || body.orderTypes || body.daysOfWeek || body.startAt !== undefined || body.endAt !== undefined
        ? couponToDb(CouponBody.parse({ ...(await currentAsBody(id)), ...body }))
        : (body as Record<string, unknown>);
    const coupon = await db.coupon.update({ where: { id }, data });
    await audit({ uid: s.uid, name: s.name }, "COUPON_UPDATED", "Coupon", id, body);
    return NextResponse.json({ ok: true, coupon });
  }
);

async function currentAsBody(id: string) {
  const c = await db.coupon.findUniqueOrThrow({ where: { id } });
  return {
    ...c,
    orderTypes: JSON.parse(c.orderTypesJson),
    daysOfWeek: JSON.parse(c.daysOfWeekJson),
    startAt: c.startAt?.toISOString() ?? null,
    endAt: c.endAt?.toISOString() ?? null,
  };
}

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("MARKETING");
    // Deactivate rather than delete to keep redemption history.
    await db.coupon.update({ where: { id }, data: { active: false } });
    await audit({ uid: s.uid, name: s.name }, "COUPON_DEACTIVATED", "Coupon", id);
    return NextResponse.json({ ok: true });
  }
);
