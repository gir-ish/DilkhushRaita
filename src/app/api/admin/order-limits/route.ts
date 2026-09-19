import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { COUNTER_LIMITS, LIMIT_BOUNDS, invalidateOrderLimits, orderSettingsRow } from "@/lib/order-limits";

/**
 * How much a customer may order on the website. The counter's own limits are
 * returned alongside, so the dashboard can say plainly that they differ.
 */
export const GET = handler(async () => {
  await requireStaff("BRANCH_MANAGER", "CASHIER");
  const row = await orderSettingsRow();
  return NextResponse.json({
    maxQtyPerItem: row.maxQtyPerItem,
    maxItemsPerOrder: row.maxItemsPerOrder,
    counter: COUNTER_LIMITS,
    bounds: LIMIT_BOUNDS,
  });
});

const Body = z.object({
  maxQtyPerItem: z.number().int().min(LIMIT_BOUNDS.qty.min).max(LIMIT_BOUNDS.qty.max),
  maxItemsPerOrder: z.number().int().min(LIMIT_BOUNDS.items.min).max(LIMIT_BOUNDS.items.max),
});

export const PUT = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const body = Body.parse(await req.json());
  const before = await orderSettingsRow();

  await db.orderSettings.update({ where: { id: "singleton" }, data: body });
  // Quotes read this through a short-lived cache; drop it so the change shows
  // on the website immediately rather than half a minute later.
  invalidateOrderLimits();
  await audit({ uid: s.uid, name: s.name }, "ORDER_LIMITS_CHANGED", "OrderSettings", "singleton", {
    from: { maxQtyPerItem: before.maxQtyPerItem, maxItemsPerOrder: before.maxItemsPerOrder },
    to: body,
  });
  return NextResponse.json({ ok: true, ...body });
});
