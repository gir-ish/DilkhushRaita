import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireCustomer();
    const address = await db.address.findFirst({ where: { id, userId: session.uid } });
    if (!address) throw new HttpError(404, "Address not found");
    await db.address.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  }
);
