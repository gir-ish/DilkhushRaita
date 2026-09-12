import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { ItemBody } from "@/lib/validation";
import { syncVariants } from "@/lib/menu-variants";

const Patch = ItemBody.partial().extend({
  branchOverrides: z
    .array(
      z.object({
        branchId: z.string(),
        priceOverride: z.number().min(0).nullish(),
        // This branch's price per portion, by name: {"Half":70,"Full":120}.
        // Omitted leaves what is stored alone.
        variantPrices: z.record(z.string().min(1).max(40), z.number().min(0).max(100000)).optional(),
        // Sold at this branch at all. Omitted leaves it as it is.
        onMenu: z.boolean().optional(),
        available: z.boolean().default(true),
        stockQty: z.number().int().min(-1).default(-1),
        availableFrom: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
        availableTo: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
      })
    )
    .optional(),
});

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER");
    const body = Patch.parse(await req.json());
    const { variants, addOns, branchOverrides, ...data } = body;

    const existing = await db.menuItem.findUnique({
      where: { id },
      include: { branchItems: true },
    });
    if (!existing) throw new HttpError(404, "Item not found");

    await db.$transaction(async (tx) => {
      await tx.menuItem.update({ where: { id }, data });
      if (variants) await syncVariants(tx, id, variants);
      if (addOns) {
        await tx.addOn.deleteMany({ where: { menuItemId: id } });
        for (const a of addOns) await tx.addOn.create({ data: { ...a, menuItemId: id } });
      }
      if (branchOverrides) {
        for (const { variantPrices, onMenu, ...o } of branchOverrides) {
          const prices = variantPrices ? { variantPricesJson: JSON.stringify(variantPrices) } : {};
          const listed = onMenu === undefined ? {} : { onMenu };
          await tx.branchMenuItem.upsert({
            where: { branchId_menuItemId: { branchId: o.branchId, menuItemId: id } },
            create: { ...o, ...prices, ...listed, menuItemId: id },
            update: {
              priceOverride: o.priceOverride ?? null,
              ...prices,
              ...listed,
              available: o.available,
              stockQty: o.stockQty,
              availableFrom: o.availableFrom ?? null,
              availableTo: o.availableTo ?? null,
            },
          });
        }
      }
    });

    // A price is what a customer is charged, so every change to one — the
    // fallback or any branch's — is recorded with what it was before.
    const priceChanges = (branchOverrides ?? []).flatMap((o) => {
      const before = existing.branchItems.find((b) => b.branchId === o.branchId);
      const was = { price: before?.priceOverride ?? null, portions: before?.variantPricesJson ?? "{}" };
      const now = {
        price: o.priceOverride ?? null,
        portions: o.variantPrices ? JSON.stringify(o.variantPrices) : was.portions,
      };
      return was.price !== now.price || was.portions !== now.portions
        ? [{ branchId: o.branchId, from: was, to: now }]
        : [];
    });
    if (priceChanges.length || (data.basePrice !== undefined && data.basePrice !== existing.basePrice))
      await audit({ uid: s.uid, name: s.name }, "PRICE_CHANGED", "MenuItem", id, {
        base: { from: existing.basePrice, to: data.basePrice ?? existing.basePrice },
        branches: priceChanges,
      });
    else
      await audit({ uid: s.uid, name: s.name }, "ITEM_UPDATED", "MenuItem", id);

    const item = await db.menuItem.findUnique({
      where: { id },
      include: { variants: true, addOns: true, branchItems: true },
    });
    return NextResponse.json({ ok: true, item });
  }
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER");
    // Soft delete keeps order history intact.
    await db.menuItem.update({ where: { id }, data: { active: false } });
    await audit({ uid: s.uid, name: s.name }, "ITEM_DELETED", "MenuItem", id);
    return NextResponse.json({ ok: true });
  }
);
