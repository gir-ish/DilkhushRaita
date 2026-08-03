import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { round2 } from "@/lib/utils";

const Query = z.object({
  rewardType: z.enum(["PERCENT", "FLAT", "FREE_DELIVERY", "FREE_ITEM"]),
  value: z.coerce.number().default(0),
  maxDiscount: z.coerce.number().optional(),
  minCartValue: z.coerce.number().optional(),
  firstOrderOnly: z.coerce.boolean().optional(),
  minCompletedOrders: z.coerce.number().optional(),
  inactiveDays: z.coerce.number().optional(),
  totalLimit: z.coerce.number().optional(),
});

/**
 * Coupon-rule preview: estimated eligible customers, an example calculation,
 * and the maximum campaign liability.
 */
export const GET = handler(async (req: Request) => {
  await requireStaff("MARKETING");
  const q = Query.parse(Object.fromEntries(new URL(req.url).searchParams));

  const where: Record<string, unknown> = {};
  if (q.firstOrderOnly) where.completedOrders = 0;
  if (q.minCompletedOrders) where.completedOrders = { gte: q.minCompletedOrders };
  if (q.inactiveDays)
    where.lastOrderAt = { lt: new Date(Date.now() - q.inactiveDays * 86400000) };

  const [eligibleCustomers, totalCustomers, avg] = await Promise.all([
    db.customerMetrics.count({ where }),
    db.user.count({ where: { role: "CUSTOMER" } }),
    db.customerMetrics.aggregate({ _avg: { avgOrderValue: true } }),
  ]);

  const exampleCart = Math.max(q.minCartValue ?? 0, round2(avg._avg.avgOrderValue ?? 350) || 350);
  let exampleDiscount = 0;
  if (q.rewardType === "PERCENT")
    exampleDiscount = Math.min((exampleCart * q.value) / 100, q.maxDiscount ?? Infinity);
  else if (q.rewardType === "FLAT") exampleDiscount = q.value;
  else if (q.rewardType === "FREE_DELIVERY") exampleDiscount = 30;
  exampleDiscount = round2(exampleDiscount);

  const perRedemptionMax = round2(
    q.rewardType === "PERCENT" ? (q.maxDiscount ?? exampleDiscount) : exampleDiscount
  );
  const maxLiability = q.totalLimit
    ? round2(q.totalLimit * perRedemptionMax)
    : null; // unlimited campaigns have unbounded liability

  return NextResponse.json({
    eligibleCustomers: q.firstOrderOnly ? "new visitors + " + eligibleCustomers : eligibleCustomers,
    totalCustomers,
    exampleCart,
    exampleDiscount,
    perRedemptionMax,
    maxLiability,
    warning:
      maxLiability === null
        ? "No total redemption limit set — campaign liability is unlimited."
        : null,
  });
});
