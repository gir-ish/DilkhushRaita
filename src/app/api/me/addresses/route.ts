import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { normalizePhone } from "@/lib/utils";

export const GET = handler(async () => {
  const session = await requireCustomer();
  const addresses = await db.address.findMany({
    where: { userId: session.uid },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
  });
  return NextResponse.json({ addresses });
});

const Body = z.object({
  label: z.string().max(30).default("Home"),
  line1: z.string().min(3).max(150),
  line2: z.string().max(150).nullish(),
  landmark: z.string().max(100).nullish(),
  pincode: z.string().regex(/^\d{6}$/, "Enter a valid 6-digit PIN code"),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  instructions: z.string().max(300).nullish(),
  // Optional: someone else receives this delivery (parent, colleague, hostel).
  contactName: z.string().max(60).nullish(),
  contactPhone: z.string().max(15).nullish(),
  isDefault: z.boolean().default(false),
});

export const POST = handler(async (req: Request) => {
  const session = await requireCustomer();
  const body = Body.parse(await req.json());

  // Stored normalised (+91XXXXXXXXXX) so the agent's tel: link always works,
  // whatever format the customer typed.
  let contactPhone: string | null = null;
  if (body.contactPhone?.trim()) {
    contactPhone = normalizePhone(body.contactPhone);
    if (!contactPhone)
      throw new HttpError(400, "Enter a valid 10-digit contact number, or leave it blank");
  }

  if (body.isDefault)
    await db.address.updateMany({ where: { userId: session.uid }, data: { isDefault: false } });
  const address = await db.address.create({
    data: {
      ...body,
      contactPhone,
      contactName: body.contactName?.trim() || null,
      userId: session.uid,
    },
  });
  return NextResponse.json({ ok: true, address });
});
