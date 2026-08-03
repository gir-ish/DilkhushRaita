import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { CouponBody, couponToDb } from "@/lib/validation";
import { audit } from "@/lib/audit";
import { round2 } from "@/lib/utils";

export const GET = handler(async () => {
  await requireStaff("MARKETING", "BRANCH_MANAGER");
  const coupons = await db.coupon.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { redemptions: true } } },
  });
  const savings = await db.couponRedemption.groupBy({
    by: ["couponId"],
    _sum: { amountSaved: true },
  });
  const savingsBy = new Map(savings.map((s) => [s.couponId, s._sum.amountSaved ?? 0]));
  return NextResponse.json({
    coupons: coupons.map((c) => ({
      ...c,
      redemptionCount: c._count.redemptions,
      totalSaved: round2(savingsBy.get(c.id) ?? 0),
    })),
  });
});

export const POST = handler(async (req: Request) => {
  const s = await requireStaff("MARKETING");
  const body = CouponBody.parse(await req.json());
  const exists = await db.coupon.findUnique({ where: { code: body.code.toUpperCase() } });
  if (exists) throw new HttpError(409, "A coupon with this code already exists");
  const coupon = await db.coupon.create({ data: couponToDb(body) });
  await audit({ uid: s.uid, name: s.name }, "COUPON_CREATED", "Coupon", coupon.id, { code: coupon.code });
  return NextResponse.json({ ok: true, coupon });
});
