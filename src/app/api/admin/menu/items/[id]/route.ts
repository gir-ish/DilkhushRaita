import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { ItemBody } from "@/lib/validation";

const Patch = ItemBody.partial().extend({
  branchOverrides: z
    .array(
      z.object({
        branchId: z.string(),
        priceOverride: z.number().min(0).nullish(),
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

    const existing = await db.menuItem.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, "Item not found");

    await db.$transaction(async (tx) => {
      await tx.menuItem.update({ where: { id }, data });
      if (variants) {
        await tx.menuItemVariant.deleteMany({ where: { menuItemId: id } });
        for (const v of variants)
          await tx.menuItemVariant.create({ data: { ...v, menuItemId: id } });
      }
      if (addOns) {
        await tx.addOn.deleteMany({ where: { menuItemId: id } });
        for (const a of addOns) await tx.addOn.create({ data: { ...a, menuItemId: id } });
      }
      if (branchOverrides) {
        for (const o of branchOverrides) {
          await tx.branchMenuItem.upsert({
            where: { branchId_menuItemId: { branchId: o.branchId, menuItemId: id } },
            create: { ...o, menuItemId: id },
            update: {
              priceOverride: o.priceOverride ?? null,
              available: o.available,
              stockQty: o.stockQty,
              availableFrom: o.availableFrom ?? null,
              availableTo: o.availableTo ?? null,
            },
          });
        }
      }
    });

    if (data.basePrice !== undefined && data.basePrice !== existing.basePrice)
      await audit({ uid: s.uid, name: s.name }, "PRICE_CHANGED", "MenuItem", id, {
        from: existing.basePrice,
        to: data.basePrice,
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
