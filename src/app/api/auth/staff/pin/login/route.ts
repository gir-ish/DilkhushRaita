import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createSessionCookie } from "@/lib/session";
import { deviceOwner, touchDevice } from "@/lib/staff-device";
import { audit } from "@/lib/audit";
import type { Role } from "@/lib/constants";

const Body = z.object({ pin: z.string().regex(/^\d{4,6}$/) });

/**
 * Sign in with the PIN.
 *
 * Two things have to be true, not one: the browser must already be paired
 * (dk_device cookie → StaffDevice row) and that device's own PIN must match. A
 * PIN seen over someone's shoulder is worth nothing on another machine, and
 * every device has a different one.
 *
 * Guessing is capped hard. Ten thousand combinations is nothing to a script,
 * so five wrong tries locks this device out for fifteen minutes; the owner can
 * still get in with email and password meanwhile.
 */
export const POST = handler(async (req: Request) => {
  const device = await deviceOwner();
  if (!device || !device.pinHash)
    throw new HttpError(401, "This device is not set up for PIN sign-in");

  // Keyed by device, not just IP: a till behind a shared connection should not
  // be lockable by someone else on the same network.
  const key = `pin-login:${device.id}:${clientIp(req)}`;
  if (!rateLimit(key, 5, 15 * 60 * 1000))
    throw new HttpError(429, "Too many wrong PINs. Wait 15 minutes or sign in with your password.");

  const body = Body.parse(await req.json());
  // This device's own PIN, not an account-wide one.
  const ok = await bcrypt.compare(body.pin, device.pinHash);
  if (!ok) {
    console.error(`[auth] wrong PIN on device ${device.id} (${device.label})`);
    throw new HttpError(401, "Incorrect PIN");
  }
  if (device.user.blocked) throw new HttpError(403, "Account disabled");

  await createSessionCookie({
    uid: device.user.id,
    role: device.user.role as Role,
    name: device.user.name ?? undefined,
  });
  await touchDevice(device.id);
  await audit(
    { uid: device.user.id, name: device.user.name ?? undefined },
    "STAFF_LOGIN_PIN",
    "User",
    device.user.id,
    { device: device.label }
  );

  return NextResponse.json({
    ok: true,
    user: { id: device.user.id, name: device.user.name, role: device.user.role },
  });
});
