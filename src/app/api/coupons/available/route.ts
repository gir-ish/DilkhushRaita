import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { evaluateCoupon } from "@/lib/coupons";
import { hhmm } from "@/lib/utils";
import { tierFor } from "@/lib/loyalty";

const Query = z.object({
  branchId: z.string(),
  subtotal: z.coerce.number().min(0).default(0),
  orderType: z.enum(["DELIVERY", "PICKUP"]).default("DELIVERY"),
});

/**
 * Lists offers for the coupon drawer: eligible ones ranked best-first, plus
 * ineligible ones with the exact reason (smart conflict/eligibility display).
 * Note: `subtotal` here is only for preview; checkout re-verifies on the server.
 */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const q = Query.parse(Object.fromEntries(url.searchParams));
  const session = await getSession();
  const userId = session?.role === "CUSTOMER" ? session.uid : null;

  let customer = {
    completedOrders: 0,
    lifetimeSpend: 0,
    loyaltyTierId: null as string | null,
    lastOrderAt: null as Date | null,
  };
  if (userId) {
    const [m, p, tiers] = await Promise.all([
      db.customerMetrics.findUnique({ where: { userId } }),
      db.customerProfile.findUnique({ where: { userId } }),
      db.loyaltyTier.findMany(),
    ]);
    const tier = tierFor(tiers, {
      completedOrders: m?.completedOrders ?? 0,
      lifetimeSpend: m?.lifetimeSpend ?? 0,
    });
    customer = {
      completedOrders: m?.completedOrders ?? 0,
      lifetimeSpend: m?.lifetimeSpend ?? 0,
      loyaltyTierId: tier?.id ?? p?.loyaltyTierId ?? null,
      lastOrderAt: m?.lastOrderAt ?? null,
    };
  }

  const coupons = await db.coupon.findMany({ where: { active: true } });
  const totals = await db.couponRedemption.groupBy({ by: ["couponId"], _count: { _all: true } });
  const mine = userId
    ? await db.couponRedemption.groupBy({
        by: ["couponId"],
        where: { userId },
        _count: { _all: true },
      })
    : [];
  const totalBy = new Map(totals.map((r) => [r.couponId, r._count._all]));
  const mineBy = new Map(mine.map((r) => [r.couponId, r._count._all]));

  const now = new Date();
  const evals = coupons.map((c) =>
    evaluateCoupon(c, {
      subtotal: q.subtotal,
      orderType: q.orderType,
      paymentMethod: "COD",
      branchId: q.branchId,
      now,
      nowHHmm: hhmm(now),
      dayOfWeek: new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })).getDay(),
      deliveryFee: 30,
      itemIdsInCart: [],
      itemPriceById: {},
      customer,
      totalRedemptions: totalBy.get(c.id) ?? 0,
      customerRedemptions: mineBy.get(c.id) ?? 0,
    })
  );

  const fmt = (e: (typeof evals)[number]) => ({
    code: e.coupon.code,
    name: e.coupon.name,
    description: e.coupon.description,
    autoApply: e.coupon.autoApply,
    eligible: e.eligible,
    reason: e.reason ?? null,
    estimatedSavings: e.savings,
  });

  return NextResponse.json({
    eligible: evals.filter((e) => e.eligible).sort((a, b) => b.savings - a.savings).map(fmt),
    ineligible: evals.filter((e) => !e.eligible).map(fmt),
  });
});
