import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireCustomer } from "@/lib/guard";
import { normalizePhone } from "@/lib/utils";

const Patch = z.object({
  label: z.string().max(30).optional(),
  line1: z.string().min(3).max(150).optional(),
  line2: z.string().max(150).nullish(),
  landmark: z.string().max(100).nullish(),
  pincode: z.string().regex(/^\d{6}$/, "Enter a valid 6-digit PIN code").optional(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  instructions: z.string().max(300).nullish(),
  contactName: z.string().max(60).nullish(),
  contactPhone: z.string().max(15).nullish(),
  isDefault: z.boolean().optional(),
});

/** Edit a saved address. */
export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireCustomer();
    // Scoped by userId so one customer cannot edit another's address.
    const address = await db.address.findFirst({ where: { id, userId: session.uid } });
    if (!address) throw new HttpError(404, "Address not found");

    const body = Patch.parse(await req.json());

    // Explicit null clears the contact; undefined leaves it untouched.
    let contactPhone: string | null | undefined;
    if (body.contactPhone !== undefined) {
      if (body.contactPhone === null || body.contactPhone.trim() === "") {
        contactPhone = null;
      } else {
        const p = normalizePhone(body.contactPhone);
        if (!p) throw new HttpError(400, "Enter a valid 10-digit contact number, or leave it blank");
        contactPhone = p;
      }
    }

    if (body.isDefault)
      await db.address.updateMany({ where: { userId: session.uid }, data: { isDefault: false } });

    const updated = await db.address.update({
      where: { id },
      data: {
        ...body,
        ...(contactPhone !== undefined ? { contactPhone } : {}),
        ...(body.contactName !== undefined
          ? { contactName: body.contactName?.trim() || null }
          : {}),
      },
    });

    // Past orders keep their own snapshot of the address and contact, so an
    // edit here never rewrites the delivery details of an order already placed.
    return NextResponse.json({ ok: true, address: updated });
  }
);

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
