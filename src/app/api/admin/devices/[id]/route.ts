import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";

/** Unpair one browser — the phone left in a rickshaw. */
export const DELETE = handler(
  async (_req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireStaff();
    if (session.role !== "OWNER") throw new HttpError(403, "Owner only");

    // Scoped to this user, so an id from somewhere else cannot be unpaired.
    const device = await db.staffDevice.findFirst({ where: { id, userId: session.uid } });
    if (!device) throw new HttpError(404, "Device not found");

    await db.staffDevice.delete({ where: { id: device.id } });
    await audit({ uid: session.uid, name: session.name }, "STAFF_DEVICE_REMOVED", "User", session.uid, {
      device: device.label,
    });
    return NextResponse.json({ ok: true });
  }
);
