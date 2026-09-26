import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";

/**
 * One contact: correct a name, stop texting them, or take them off the list.
 *
 * Opting out is kept rather than deleted, because a number that has asked not
 * to be texted must survive the next upload of the same phone book — deleting
 * it would let it walk straight back in.
 */

const Body = z.object({
  name: z.string().max(60).nullish(),
  optedOut: z.boolean().optional(),
  note: z.string().max(200).nullish(),
});

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const s = await requireStaff("MARKETING");
    const { id } = await params;
    const body = Body.parse(await req.json());

    const contact = await db.contact.findUnique({ where: { id } });
    if (!contact) throw new HttpError(404, "That contact no longer exists.");

    const saved = await db.contact.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name?.trim() || null } : {}),
        ...(body.optedOut !== undefined ? { optedOut: body.optedOut } : {}),
        ...(body.note !== undefined ? { note: body.note?.trim() || null } : {}),
      },
    });

    if (body.optedOut !== undefined && body.optedOut !== contact.optedOut)
      await audit({ uid: s.uid, name: s.name }, body.optedOut ? "CONTACT_OPTED_OUT" : "CONTACT_OPTED_IN", "Contact", id, {
        phone: contact.phone,
      });

    return NextResponse.json({ ok: true, contact: saved });
  }
);

export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const s = await requireStaff("MARKETING");
    const { id } = await params;
    const contact = await db.contact.findUnique({ where: { id } });
    if (!contact) throw new HttpError(404, "That contact no longer exists.");

    await db.contact.delete({ where: { id } });
    await audit({ uid: s.uid, name: s.name }, "CONTACT_DELETED", "Contact", id, {
      phone: contact.phone,
      name: contact.name,
    });
    return NextResponse.json({ ok: true });
  }
);
