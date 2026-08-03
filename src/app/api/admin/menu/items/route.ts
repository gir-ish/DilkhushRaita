import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { toCsv } from "@/lib/csv";
import { ItemBody } from "@/lib/validation";

export const GET = handler(async (req: Request) => {
  await requireStaff("BRANCH_MANAGER", "KITCHEN", "CASHIER");
  const url = new URL(req.url);
  const items = await db.menuItem.findMany({
    orderBy: [{ categoryId: "asc" }, { displayOrder: "asc" }],
    include: {
      category: { select: { name: true } },
      variants: true,
      addOns: true,
      branchItems: { include: { branch: { select: { name: true, slug: true } } } },
    },
  });
  if (url.searchParams.get("format") === "csv") {
    const rows = items.map((i) => ({
      id: i.id,
      name: i.name,
      category: i.category.name,
      basePrice: i.basePrice,
      veg: i.veg,
      spicy: i.spicy,
      bestseller: i.bestseller,
      active: i.active,
      description: i.description,
    }));
    return new Response(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": "attachment; filename=menu-export.csv",
      },
    });
  }
  return NextResponse.json({ items });
});

export const POST = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const body = ItemBody.parse(await req.json());
  const { variants, addOns, ...data } = body;
  const item = await db.menuItem.create({
    data: {
      ...data,
      variants: { create: variants },
      addOns: { create: addOns },
    },
  });
  // Make the item visible at every branch by default.
  const branches = await db.branch.findMany({ select: { id: true } });
  await db.branchMenuItem.createMany({
    data: branches.map((b) => ({ branchId: b.id, menuItemId: item.id })),
  });
  await audit({ uid: s.uid, name: s.name }, "ITEM_CREATED", "MenuItem", item.id, { name: item.name });
  return NextResponse.json({ ok: true, item });
});
