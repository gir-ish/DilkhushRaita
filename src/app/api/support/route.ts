import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { TICKET_TYPES } from "@/lib/constants";

export const GET = handler(async () => {
  const session = await requireCustomer();
  const tickets = await db.supportTicket.findMany({
    where: { userId: session.uid },
    orderBy: { createdAt: "desc" },
    take: 20,
  });
  return NextResponse.json({ tickets });
});

const Body = z.object({
  orderId: z.string().nullish(),
  type: z.enum(TICKET_TYPES),
  message: z.string().min(5).max(2000),
});

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = Body.parse(await req.json());

  /*
   * A ticket may name an order, but only one of the caller's own.
   *
   * The id was written straight through, so anyone could raise "my order was
   * missing an item" against a stranger's order number — and the staff screen
   * shows the linked order, which puts another customer's address and phone in
   * front of whoever picks the ticket up. Cheap to check, and it also stops
   * tickets pointing at orders that do not exist.
   */
  if (body.orderId) {
    const own = await db.order.findFirst({
      where: { id: body.orderId, userId: session.uid },
      select: { id: true },
    });
    if (!own) throw new HttpError(404, "Order not found");
  }

  const ticket = await db.supportTicket.create({
    data: { userId: session.uid, orderId: body.orderId ?? null, type: body.type, message: body.message },
  });
  return NextResponse.json({ ok: true, ticket });
});
