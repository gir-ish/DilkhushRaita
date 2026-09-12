import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { menuToCsv } from "@/lib/menu-csv";
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
    // The import format, so a download can be edited and uploaded back. Only
    // what is on the menu: re-importing a hidden dish would switch it back on.
    const branches = await db.branch.findMany({ orderBy: { createdAt: "asc" }, select: { id: true, slug: true } });
    const onMenu = await db.menuItem.findMany({
      where: { active: true },
      orderBy: [{ category: { displayOrder: "asc" } }, { displayOrder: "asc" }, { name: "asc" }],
      include: { category: { select: { name: true } }, variants: true, addOns: true, branchItems: true },
    });
    return new Response(menuToCsv(onMenu, branches), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
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
