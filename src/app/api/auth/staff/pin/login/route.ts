import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import {
  clearIdentityFailures,
  clientIp,
  identityAllowed,
  rateLimit,
  recordIdentityFailure,
} from "@/lib/rate-limit";
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

  /*
   * Counted against the device alone.
   *
   * A four-digit PIN is ten thousand guesses, which a script finishes in
   * seconds, so this cap is the only thing standing in front of it. It used to
   * include the caller's address in the key — but that address comes from a
   * header the caller writes, so a new one per request meant a new allowance
   * per request and the cap never closed. The device is the thing being
   * attacked and the thing it is now counted against.
   */
  const TRIES = 5;
  const WINDOW = 15 * 60 * 1000;
  if (!identityAllowed("pin-login", device.id, TRIES, WINDOW))
    throw new HttpError(429, "Too many wrong PINs. Wait 15 minutes or sign in with your password.");
  // Still capped per address as well, so one source cannot spin the CPU on
  // bcrypt for everyone else.
  if (!rateLimit(`pin-login:ip:${clientIp(req)}`, 30, WINDOW))
    throw new HttpError(429, "Too many attempts. Try again shortly.");

  const body = Body.parse(await req.json());
  // This device's own PIN, not an account-wide one.
  const ok = await bcrypt.compare(body.pin, device.pinHash);
  if (!ok) {
    recordIdentityFailure("pin-login", device.id, WINDOW);
    console.error(`[auth] wrong PIN on device ${device.id} (${device.label})`);
    throw new HttpError(401, "Incorrect PIN");
  }
  clearIdentityFailures("pin-login", device.id);
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
