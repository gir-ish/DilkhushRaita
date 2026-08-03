import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";

export const GET = handler(async () => {
  await requireStaff("BRANCH_MANAGER");
  const categories = await db.category.findMany({
    orderBy: { displayOrder: "asc" },
    include: { _count: { select: { items: true } } },
  });
  return NextResponse.json({ categories });
});

const Body = z.object({
  name: z.string().min(1).max(50),
  displayOrder: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const POST = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const body = Body.parse(await req.json());
  const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  const category = await db.category.create({ data: { ...body, slug } });
  await audit({ uid: s.uid, name: s.name }, "CATEGORY_CREATED", "Category", category.id, body);
  return NextResponse.json({ ok: true, category });
});
