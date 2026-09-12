import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { parseVariantPrices } from "@/lib/menu-pricing";

/**
 * Saves prices from the Menu page's "Edit prices" grid: for each dish and
 * branch, either one price or a price per portion (Half, Full).
 *
 * Only prices. Availability, stock and serving windows are left exactly as
 * they are, so repricing a dish cannot quietly switch it back on or reset a
 * stock count.
 */
const Price = z.number().min(0).max(100000);
const Body = z.object({
  changes: z
    .array(
      z.object({
        menuItemId: z.string().min(1),
        branchId: z.string().min(1),
        price: Price.optional(),
        variantPrices: z.record(z.string().min(1).max(40), Price).optional(),
      })
    )
    .min(1)
    .max(1000),
});

export const PATCH = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const { changes } = Body.parse(await req.json());

  const itemIds = [...new Set(changes.map((c) => c.menuItemId))];
  const items = await db.menuItem.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, name: true, variants: { where: { active: true } }, branchItems: true },
  });
  const branches = await db.branch.findMany({ select: { id: true, name: true } });
  const itemById = new Map(items.map((i) => [i.id, i]));
  const branchIds = new Set(branches.map((b) => b.id));

  const log: { item: string; branchId: string; from: unknown; to: unknown }[] = [];
  const writes = changes.map((c) => {
    const item = itemById.get(c.menuItemId);
    if (!item) throw new HttpError(404, "A dish in this change no longer exists — reload the page");
    if (!branchIds.has(c.branchId)) throw new HttpError(404, "Unknown branch — reload the page");
    const bi = item.branchItems.find((b) => b.branchId === c.branchId);

    let data: { priceOverride: number; variantPricesJson?: string };
    if (item.variants.length) {
      if (!c.variantPrices) throw new HttpError(400, `${item.name} is sold in portions — give a price for each`);
      // Every portion the dish is sold in, and only those.
      const prices: Record<string, number> = {};
      for (const v of item.variants) {
        const p = Object.entries(c.variantPrices).find(([n]) => n.trim().toLowerCase() === v.name.trim().toLowerCase())?.[1];
        if (p === undefined) throw new HttpError(400, `${item.name}: no ${v.name} price`);
        prices[v.name] = p;
      }
      const def = item.variants.find((v) => v.isDefault) ?? item.variants[0];
      data = { priceOverride: prices[def.name], variantPricesJson: JSON.stringify(prices) };
      log.push({
        item: item.name,
        branchId: c.branchId,
        from: parseVariantPrices(bi?.variantPricesJson),
        to: prices,
      });
    } else {
      if (c.price === undefined) throw new HttpError(400, `${item.name}: no price`);
      data = { priceOverride: c.price };
      log.push({ item: item.name, branchId: c.branchId, from: bi?.priceOverride ?? null, to: c.price });
    }
    return db.branchMenuItem.upsert({
      where: { branchId_menuItemId: { branchId: c.branchId, menuItemId: c.menuItemId } },
      create: { branchId: c.branchId, menuItemId: c.menuItemId, ...data },
      update: data,
    });
  });

  await db.$transaction(writes);
  await audit({ uid: s.uid, name: s.name }, "PRICE_CHANGED", "MenuItem", undefined, { changes: log });
  return NextResponse.json({ ok: true, saved: writes.length });
});
