import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
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

/**
 * DELETE            — switches the coupon off, keeping it and its history.
 * DELETE ?permanent=1 — removes it entirely, but only if nobody ever used it.
 *
 * A coupon someone redeemed is part of what a customer was charged, so it
 * stays: an old bill has to keep saying which offer took money off it.
 */
export const DELETE = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("MARKETING");
    const permanent = new URL(req.url).searchParams.get("permanent") === "1";

    if (!permanent) {
      await db.coupon.update({ where: { id }, data: { active: false } });
      await audit({ uid: s.uid, name: s.name }, "COUPON_DEACTIVATED", "Coupon", id);
      return NextResponse.json({ ok: true, deleted: false });
    }

    const coupon = await db.coupon.findUnique({
      where: { id },
      include: { _count: { select: { redemptions: true } } },
    });
    if (!coupon) throw new HttpError(404, "That coupon is already gone");
    if (coupon._count.redemptions > 0)
      throw new HttpError(
        409,
        `${coupon.code} was used ${coupon._count.redemptions} time(s), so it is kept for those bills — switch it off instead`
      );

    await db.coupon.delete({ where: { id } });
    await audit({ uid: s.uid, name: s.name }, "COUPON_DELETED", "Coupon", id, { code: coupon.code, name: coupon.name });
    return NextResponse.json({ ok: true, deleted: true, code: coupon.code });
  }
);
