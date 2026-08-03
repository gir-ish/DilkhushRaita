import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";

const Patch = z.object({
  name: z.string().min(1).max(50).optional(),
  displayOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER");
    const body = Patch.parse(await req.json());
    const category = await db.category.update({ where: { id }, data: body });
    await audit({ uid: s.uid, name: s.name }, "CATEGORY_UPDATED", "Category", id, body);
    return NextResponse.json({ ok: true, category });
  }
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER");
    const count = await db.menuItem.count({ where: { categoryId: id } });
    if (count > 0)
      throw new HttpError(400, "Move or delete this category's items first");
    await db.category.delete({ where: { id } });
    await audit({ uid: s.uid, name: s.name }, "CATEGORY_DELETED", "Category", id);
    return NextResponse.json({ ok: true });
  }
);
