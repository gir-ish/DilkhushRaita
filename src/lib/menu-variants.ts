import type { db } from "@/lib/db";

export type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * Brings an item's portions in line with `wanted`, keeping each surviving
 * portion's id.
 *
 * Carts hold the id of the portion a customer picked. Deleting and recreating
 * every portion on each save — what the item editor used to do — gave "Half"
 * a new id whenever the owner corrected a price, and every cart holding that
 * dish then failed at checkout with "the selected portion is unavailable".
 */
export async function syncVariants(
  tx: Tx,
  menuItemId: string,
  wanted: { name: string; priceDelta: number; isDefault: boolean }[]
) {
  const current = await tx.menuItemVariant.findMany({ where: { menuItemId } });
  const byName = new Map(current.map((v) => [v.name.trim().toLowerCase(), v]));
  const kept = new Set<string>();
  for (const v of wanted) {
    const match = byName.get(v.name.trim().toLowerCase());
    if (match && !kept.has(match.id)) {
      kept.add(match.id);
      await tx.menuItemVariant.update({
        where: { id: match.id },
        data: { name: v.name.trim(), priceDelta: v.priceDelta, isDefault: v.isDefault, active: true },
      });
    } else {
      const created = await tx.menuItemVariant.create({
        data: { name: v.name.trim(), priceDelta: v.priceDelta, isDefault: v.isDefault, menuItemId },
      });
      kept.add(created.id);
    }
  }
  const gone = current.filter((v) => !kept.has(v.id)).map((v) => v.id);
  if (gone.length) await tx.menuItemVariant.deleteMany({ where: { id: { in: gone } } });
}
