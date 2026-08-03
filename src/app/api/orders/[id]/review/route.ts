import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";

const Body = z.object({
  foodRating: z.number().int().min(1).max(5),
  packagingRating: z.number().int().min(1).max(5).optional(),
  deliveryRating: z.number().int().min(1).max(5).optional(),
  overallRating: z.number().int().min(1).max(5),
  comment: z.string().max(1000).optional(),
});

export const POST = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireCustomer();
    const body = Body.parse(await req.json());
    const order = await db.order.findFirst({ where: { id, userId: session.uid } });
    if (!order) throw new HttpError(404, "Order not found");
    if (order.status !== "DELIVERED") throw new HttpError(400, "You can review after delivery");
    const existing = await db.review.findUnique({ where: { orderId: id } });
    if (existing) throw new HttpError(409, "You already reviewed this order");
    const review = await db.review.create({
      data: { ...body, orderId: id, userId: session.uid },
    });
    return NextResponse.json({ ok: true, review });
  }
);
