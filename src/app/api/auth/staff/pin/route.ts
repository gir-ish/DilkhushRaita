import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { deviceLabelFrom, deviceOwner, trustThisDevice } from "@/lib/staff-device";
import { audit } from "@/lib/audit";

/** Only the owner gets a PIN — it is a convenience for the person at the till. */
const PIN_ROLE = "OWNER";

/**
 * What this browser can offer on the sign-in screen.
 *
 * Deliberately unauthenticated: the login page has to ask before anyone has
 * signed in. It reveals only whether *this* device is paired and the first
 * name to greet — never the email, and nothing at all to a browser that has
 * not been paired.
 */
export const GET = handler(async () => {
  const device = await deviceOwner();
  if (!device || device.user.role !== PIN_ROLE || !device.user.pinHash)
    return NextResponse.json({ pinReady: false });
  return NextResponse.json({
    pinReady: true,
    name: device.user.name?.split(" ")[0] ?? "Owner",
  });
});

const Body = z.object({
  // 4-6 digits. Longer is better, but this has to be typeable one-handed
  // while someone is waiting to pay.
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits"),
  currentPin: z.string().optional(),
});

/** Set or change the PIN. Requires a live staff session, i.e. a full sign-in. */
export const POST = handler(async (req: Request) => {
  const session = await requireStaff();
  if (session.role !== PIN_ROLE)
    throw new HttpError(403, "Only the owner account can use a PIN");

  const body = Body.parse(await req.json());
  if (/^(\d)\1+$/.test(body.pin))
    throw new HttpError(400, "That PIN is too easy to guess — avoid all-same digits");

  const user = await db.user.findUnique({ where: { id: session.uid } });
  if (!user) throw new HttpError(401, "Please sign in again");

  // Changing an existing PIN needs the old one, so a walk-up to an unlocked
  // dashboard cannot quietly replace it.
  if (user.pinHash) {
    const ok = body.currentPin && (await bcrypt.compare(body.currentPin, user.pinHash));
    if (!ok) throw new HttpError(403, "Enter your current PIN to change it");
  }

  await db.user.update({
    where: { id: user.id },
    data: { pinHash: await bcrypt.hash(body.pin, 10) },
  });
  await trustThisDevice(user.id, deviceLabelFrom(req.headers.get("user-agent")));
  await audit({ uid: user.id, name: user.name ?? undefined }, "STAFF_PIN_SET", "User", user.id);

  return NextResponse.json({ ok: true });
});
