import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireCustomer } from "@/lib/guard";
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
  const ticket = await db.supportTicket.create({
    data: { userId: session.uid, orderId: body.orderId ?? null, type: body.type, message: body.message },
  });
  return NextResponse.json({ ok: true, ticket });
});
