import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { nameKey, parseMenuCsv, rowBasePrice, rowFullDelta, PORTIONS, type MenuRow } from "@/lib/menu-csv";
import { syncVariants } from "@/lib/menu-variants";

/**
 * Bulk menu import — the format is described in src/lib/menu-csv.ts.
 *
 *   POST /api/admin/menu/import?dryRun=1          → what would change, nothing written
 *   POST /api/admin/menu/import                   → apply
 *   POST /api/admin/menu/import?hideMissing=1     → apply, and take every dish
 *                                                    not in the file off the menu
 *
 * All or nothing: a file with any error changes nothing, and the apply runs in
 * one transaction, so a half-imported menu — some prices new, some old — is
 * never what a customer sees. Hiding is a soft delete (active = false), so
 * order history and favourites survive and a hidden dish can be switched back.
 */
const MAX_BYTES = 512 * 1024;

export const POST = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dryRun") === "1";
  const hideMissing = url.searchParams.get("hideMissing") === "1";

  const text = await req.text();
  if (text.length > MAX_BYTES) throw new HttpError(413, "That file is too large for a menu");

  const branches = await db.branch.findMany({ select: { id: true, slug: true, name: true } });
  const parsed = parseMenuCsv(text, branches.map((b) => b.slug));

  const existing = await db.menuItem.findMany({
    select: { id: true, name: true, active: true, category: { select: { name: true } } },
  });
  const byId = new Map(existing.map((e) => [e.id, e]));
  const byName = new Map(existing.map((e) => [nameKey(e.name), e]));

  // Which dish each row lands on. An id that exists wins — that is how a row
  // renames a dish — then the same name, then a new dish.
  const claimed = new Set<string>();
  const plan = parsed.rows.map((row) => {
    const hit = (row.id && byId.get(row.id)) || byName.get(nameKey(row.name));
    if (hit && claimed.has(hit.id)) {
      parsed.errors.push({ line: row.line, message: `${row.name}: the same dish as an earlier row` });
      return { row, target: null };
    }
    if (hit) claimed.add(hit.id);
    return { row, target: hit ?? null };
  });

  // A name another dish already uses would leave two dishes with one name.
  for (const { row, target } of plan) {
    const other = byName.get(nameKey(row.name));
    if (target && other && other.id !== target.id && !claimed.has(other.id))
      parsed.errors.push({ line: row.line, message: `${row.name}: another dish already has this name` });
  }

  const notInFile = existing.filter((e) => e.active && !claimed.has(e.id));
  const summary = {
    created: plan.filter((p) => !p.target).map((p) => p.row.name),
    updated: plan
      .filter((p) => p.target)
      .map((p) => ({
        name: p.row.name,
        renamedFrom: p.target!.name !== p.row.name ? p.target!.name : null,
        reactivated: !p.target!.active,
      })),
    notInFile: notInFile.map((e) => ({ id: e.id, name: e.name, category: e.category.name })),
    branches: parsed.branches.map((slug) => branches.find((b) => b.slug === slug)?.name ?? slug),
    errors: parsed.errors.sort((a, b) => a.line - b.line),
    warnings: parsed.warnings,
  };

  if (dryRun || parsed.errors.length) {
    if (!dryRun) throw new HttpError(400, `The file has ${parsed.errors.length} problem(s) — nothing was changed`);
    return NextResponse.json({ ok: true, dryRun: true, ...summary });
  }

  const inFile = branches.filter((b) => parsed.branches.includes(b.slug));
  await db.$transaction(
    async (tx) => {
      // Categories in the order the file first mentions them.
      const categoryIds = new Map<string, string>();
      const order = [...new Set(parsed.rows.map((r) => r.category))];
      for (const [i, name] of order.entries()) {
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || `category-${i + 1}`;
        const c = await tx.category.upsert({
          where: { slug },
          create: { name, slug, displayOrder: i + 1 },
          update: { name, displayOrder: i + 1, active: true },
        });
        categoryIds.set(name, c.id);
      }

      const positions = new Map<string, number>();
      for (const { row, target } of plan) {
        const position = (positions.get(row.category) ?? 0) + 1;
        positions.set(row.category, position);
        const data = {
          categoryId: categoryIds.get(row.category)!,
          name: row.name,
          nameHindi: row.nameHindi,
          description: row.description,
          veg: row.veg,
          spicy: row.spicy,
          bestseller: row.bestseller,
          recommended: row.recommended,
          ...(row.emoji ? { imageEmoji: row.emoji } : {}),
          basePrice: rowBasePrice(row),
          displayOrder: position,
          active: true,
        };
        const item = target
          ? await tx.menuItem.update({ where: { id: target.id }, data })
          : await tx.menuItem.create({ data });

        await syncVariants(
          tx,
          item.id,
          row.portions
            ? [
                { name: PORTIONS.half, priceDelta: 0, isDefault: true },
                { name: PORTIONS.full, priceDelta: rowFullDelta(row), isDefault: false },
              ]
            : []
        );

        if (row.addOns) {
          await tx.addOn.deleteMany({ where: { menuItemId: item.id } });
          for (const a of row.addOns) await tx.addOn.create({ data: { ...a, menuItemId: item.id } });
        }

        for (const b of inFile) await writeBranchRow(tx, item.id, b.id, row.prices[b.slug] ?? null);
        // A new dish is visible at branches the file says nothing about, at
        // its base price — as a dish added in the editor is.
        if (!target)
          for (const b of branches.filter((x) => !parsed.branches.includes(x.slug)))
            await tx.branchMenuItem.create({ data: { branchId: b.id, menuItemId: item.id } });
      }

      if (hideMissing) {
        if (notInFile.length)
          await tx.menuItem.updateMany({
            where: { id: { in: notInFile.map((e) => e.id) } },
            data: { active: false },
          });
        // The old menu's categories that nothing is left in — "Starters",
        // "Breads" — are hidden too, so the dashboard shows the menu as it now
        // is. A category with a dish on the menu is never touched.
        await tx.category.updateMany({
          where: { id: { notIn: [...categoryIds.values()] }, items: { none: { active: true } } },
          data: { active: false },
        });
      }
    },
    { timeout: 120_000, maxWait: 10_000 }
  );

  await audit({ uid: s.uid, name: s.name }, "MENU_IMPORTED", "MenuItem", undefined, {
    created: summary.created.length,
    updated: summary.updated.length,
    hidden: hideMissing ? notInFile.map((e) => e.name) : [],
  });
  return NextResponse.json({
    ok: true,
    created: summary.created.length,
    updated: summary.updated.length,
    hidden: hideMissing ? notInFile.length : 0,
  });
});

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Whether one branch sells one dish, and at what price.
 *
 * A branch that does not sell it has it taken off its menu; the old price is
 * left in place, so putting it back from the dashboard does not bring it back
 * at ₹0. Today's stock switch ("In stock" / "Off") is left alone — the file
 * says what is on the menu, not what has run out — except that a dish a
 * branch starts selling starts in stock.
 */
async function writeBranchRow(tx: Tx, menuItemId: string, branchId: string, price: MenuRow["prices"][string]) {
  const where = { branchId_menuItemId: { branchId, menuItemId } };
  if (!price) {
    await tx.branchMenuItem.upsert({
      where,
      create: { branchId, menuItemId, onMenu: false },
      update: { onMenu: false },
    });
    return;
  }
  const priced =
    price.price !== undefined
      ? { priceOverride: price.price, variantPricesJson: "{}" }
      : {
          priceOverride: price.half!,
          variantPricesJson: JSON.stringify({ [PORTIONS.half]: price.half, [PORTIONS.full]: price.full }),
        };
  const before = await tx.branchMenuItem.findUnique({ where, select: { onMenu: true } });
  await tx.branchMenuItem.upsert({
    where,
    create: { branchId, menuItemId, onMenu: true, available: true, ...priced },
    update: { onMenu: true, ...(before?.onMenu === false ? { available: true } : {}), ...priced },
  });
}
