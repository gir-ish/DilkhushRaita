import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { parseCsv } from "@/lib/csv";
import { audit } from "@/lib/audit";

/**
 * Bulk menu import. POST text/csv with headers:
 *   name,category,price,veg,spicy,bestseller,description
 * Creates missing categories; upserts items by name.
 */
export const POST = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const text = await req.text();
  const rows = parseCsv(text);
  if (rows.length === 0) throw new HttpError(400, "CSV is empty or missing a header row");

  let created = 0;
  let updated = 0;
  for (const row of rows) {
    if (!row.name || !row.category || !row.price) continue;
    const price = parseFloat(row.price);
    if (isNaN(price)) continue;
    const slug = row.category.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const category = await db.category.upsert({
      where: { slug },
      create: { name: row.category, slug },
      update: {},
    });
    const data = {
      categoryId: category.id,
      basePrice: price,
      veg: row.veg ? row.veg.toLowerCase() !== "false" : true,
      spicy: row.spicy?.toLowerCase() === "true",
      bestseller: row.bestseller?.toLowerCase() === "true",
      description: row.description ?? "",
    };
    const existing = await db.menuItem.findFirst({ where: { name: row.name } });
    if (existing) {
      await db.menuItem.update({ where: { id: existing.id }, data });
      updated++;
    } else {
      const item = await db.menuItem.create({ data: { ...data, name: row.name } });
      const branches = await db.branch.findMany({ select: { id: true } });
      await db.branchMenuItem.createMany({
        data: branches.map((b) => ({ branchId: b.id, menuItemId: item.id })),
      });
      created++;
    }
  }
  await audit({ uid: s.uid, name: s.name }, "MENU_IMPORTED", "MenuItem", undefined, { created, updated });
  return NextResponse.json({ ok: true, created, updated });
});
