import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { isBranchOpen } from "@/lib/geo";
import { hhmm, withinTimeWindow } from "@/lib/utils";
import { menuPricing } from "@/lib/menu-pricing";
import { orderLimits } from "@/lib/order-limits";

/** Full menu for a branch, with branch-specific price/availability applied. */
export const GET = handler(
  async (_req: Request, { params }: { params: Promise<{ slug: string }> }) => {
    const { slug } = await params;
    const branch = await db.branch.findUnique({
      where: { slug },
      include: { hours: true },
    });
    if (!branch) throw new HttpError(404, "Branch not found");

    const open = isBranchOpen(branch, branch.hours);
    const limits = await orderLimits();
    const nowHHmm = hhmm(new Date());

    const categories = await db.category.findMany({
      where: { active: true },
      orderBy: { displayOrder: "asc" },
      include: {
        items: {
          where: { active: true },
          orderBy: { displayOrder: "asc" },
          include: {
            variants: { where: { active: true } },
            addOns: { where: { active: true } },
            branchItems: { where: { branchId: branch.id } },
          },
        },
      },
    });

    const out = categories
      .map((c) => ({
        id: c.id,
        name: c.name,
        slug: c.slug,
        // A dish this branch does not sell is left off its menu altogether,
        // rather than shown as unavailable; a category left empty drops out
        // below.
        items: c.items.filter((i) => i.branchItems[0]?.onMenu !== false).map((i) => {
          const bi = i.branchItems[0];
          const inWindow = bi ? withinTimeWindow(nowHHmm, bi.availableFrom, bi.availableTo) : true;
          const inStock = !bi || bi.stockQty === -1 || bi.stockQty > 0;
          const priced = menuPricing(i, bi);
          return {
            id: i.id,
            name: i.name,
            nameHindi: i.nameHindi,
            description: i.description,
            imageUrl: i.imageUrl,
            imageEmoji: i.imageEmoji,
            price: priced.price,
            veg: i.veg,
            vegan: i.vegan,
            spicy: i.spicy,
            bestseller: i.bestseller,
            recommended: i.recommended,
            prepTimeMins: i.prepTimeMins,
            ingredients: i.ingredients,
            allergens: i.allergens,
            available: (bi ? bi.available : true) && inWindow && inStock,
            availabilityNote: !inWindow && bi?.availableFrom
              ? `Available ${bi.availableFrom}–${bi.availableTo}`
              : !inStock
                ? "Sold out for now"
                : null,
            stockQty: bi?.stockQty ?? -1,
            // This branch's own Half/Full prices, as a difference from the
            // listed price — which is what every client adds up.
            variants: priced.variants,
            addOns: i.addOns.map((a) => ({
              id: a.id,
              name: a.name,
              price: a.price,
              veg: a.veg,
              required: a.required,
            })),
          };
        }),
      }))
      .filter((c) => c.items.length > 0);

    return NextResponse.json({
      branch: {
        id: branch.id,
        slug: branch.slug,
        name: branch.name,
        address: branch.address,
        phone: branch.phone,
        open: open.open,
        openReason: open.reason ?? null,
        busyMode: branch.busyMode,
        minOrderValue: branch.minOrderValue,
        packagingFee: branch.packagingFee,
        taxPercent: branch.taxPercent,
        deliveryEnabled: branch.deliveryEnabled && !(branch.busyMode && branch.busyPauseDelivery),
        pickupEnabled: branch.pickupEnabled,
        prepTimeMins: branch.prepTimeMins + (branch.busyMode ? branch.busyExtraMins : 0),
        // The counter is not held to these; see src/lib/order-limits.ts.
        maxQtyPerItem: limits.maxQtyPerItem,
        maxItemsPerOrder: limits.maxItemsPerOrder,
      },
      categories: out,
    });
  }
);
