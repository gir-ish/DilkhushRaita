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
 * signed in. It reveals only whether *this* device has a PIN and the first name
 * to greet — never the email, and nothing at all to an unpaired browser.
 */
export const GET = handler(async () => {
  const device = await deviceOwner();
  if (!device || device.user.role !== PIN_ROLE || !device.pinHash)
    return NextResponse.json({ pinReady: false });
  return NextResponse.json({
    pinReady: true,
    name: device.user.name?.split(" ")[0] ?? "Owner",
  });
});

const Body = z.object({
  // 4-6 digits. Longer is better, but this has to be typeable one-handed while
  // someone is waiting to pay.
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits"),
  currentPin: z.string().optional(),
});

/**
 * Set or change the PIN **for the browser making the request**.
 *
 * Each device carries its own: the till by the counter and a personal phone
 * should not share a secret, and forgetting the one on a phone must not force
 * the shop to re-learn theirs. Requires a live staff session, so a full
 * email + password sign-in is always what stands behind a new PIN.
 */
export const POST = handler(async (req: Request) => {
  const session = await requireStaff();
  if (session.role !== PIN_ROLE)
    throw new HttpError(403, "Only the owner account can use a PIN");

  const body = Body.parse(await req.json());
  if (/^(\d)\1+$/.test(body.pin))
    throw new HttpError(400, "That PIN is too easy to guess — avoid all-same digits");

  // Pair first if this browser is new, so setting a PIN and trusting the device
  // are one step from the owner's point of view.
  const device =
    (await deviceOwner()) ??
    (await trustThisDevice(session.uid, deviceLabelFrom(req.headers.get("user-agent"))));

  if (device.userId !== session.uid)
    throw new HttpError(403, "This device belongs to another account");

  // Replacing this device's PIN needs the old one, so walking up to an unlocked
  // dashboard is not enough to change it.
  const existing = "pinHash" in device ? device.pinHash : null;
  if (existing) {
    const ok = body.currentPin && (await bcrypt.compare(body.currentPin, existing));
    if (!ok) throw new HttpError(403, "Enter this device's current PIN to change it");
  }

  await db.staffDevice.update({
    where: { id: device.id },
    data: {
      pinHash: await bcrypt.hash(body.pin, 10),
      label: deviceLabelFrom(req.headers.get("user-agent")),
      lastUsedAt: new Date(),
    },
  });
  await audit({ uid: session.uid, name: session.name }, "STAFF_PIN_SET", "StaffDevice", device.id, {
    device: device.label,
  });

  return NextResponse.json({ ok: true });
});
