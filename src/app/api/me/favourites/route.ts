import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireCustomer } from "@/lib/guard";

export const GET = handler(async () => {
  const session = await requireCustomer();
  const favourites = await db.favourite.findMany({
    where: { userId: session.uid },
    include: { menuItem: { select: { id: true, name: true, basePrice: true, imageEmoji: true, veg: true } } },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    favourites: favourites.map((f) => ({ ...f.menuItem, favSince: f.createdAt })),
    ids: favourites.map((f) => f.menuItemId),
  });
});

const Body = z.object({ menuItemId: z.string() });

/** Toggle favourite. */
export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const { menuItemId } = Body.parse(await req.json());
  const existing = await db.favourite.findUnique({
    where: { userId_menuItemId: { userId: session.uid, menuItemId } },
  });
  if (existing) {
    await db.favourite.delete({ where: { id: existing.id } });
    return NextResponse.json({ ok: true, favourite: false });
  }
  await db.favourite.create({ data: { userId: session.uid, menuItemId } });
  return NextResponse.json({ ok: true, favourite: true });
});
