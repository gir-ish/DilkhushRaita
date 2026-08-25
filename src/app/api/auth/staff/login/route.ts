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
import { STAFF_ROLES, type Role } from "@/lib/constants";
import { deviceLabelFrom, trustThisDevice } from "@/lib/staff-device";
import { audit } from "@/lib/audit";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

export const POST = handler(async (req: Request) => {
  /*
   * A flood guard, not the security boundary — that is the per-account count
   * below, which a forged address cannot walk around.
   *
   * Kept deliberately loose because every till, tablet and phone in one shop
   * shares a single public address: at ten, three people fumbling a password
   * between them could shut the whole counter out for a quarter of an hour.
   */
  if (!rateLimit(`staff-login:${clientIp(req)}`, 40, 15 * 60 * 1000))
    throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");

  const body = Body.parse(await req.json());

  /*
   * The count that actually stops a brute force.
   *
   * The limit above is keyed on an address the caller can forge a fresh one of
   * on every request, so by itself it stops nobody — rotating the header walks
   * straight through it. Guessing this account's password means naming this
   * account every time, and that is what is counted here.
   *
   * Wrong tries only, cleared on a real sign-in: counting every attempt would
   * let anyone lock the owner out of their own dashboard on demand.
   */
  const FAILS = 10;
  const WINDOW = 15 * 60 * 1000;
  if (!identityAllowed("staff-login", body.email, FAILS, WINDOW))
    throw new HttpError(429, "Too many failed attempts on this account. Try again in 15 minutes.");

  const fail = () => {
    recordIdentityFailure("staff-login", body.email, WINDOW);
    return new HttpError(401, "Invalid email or password");
  };

  const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user || !user.passwordHash || !STAFF_ROLES.includes(user.role as Role)) throw fail();
  if (user.blocked) throw new HttpError(403, "Account disabled");
  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) throw fail();

  clearIdentityFailures("staff-login", body.email);
  await createSessionCookie({
    uid: user.id,
    role: user.role as Role,
    name: user.name ?? undefined,
  });
  // A full sign-in is what earns a browser the right to use a PIN later. Only
  // the owner gets one, so only the owner's browsers are paired.
  let devicePin = false;
  if (user.role === "OWNER") {
    const device = await trustThisDevice(user.id, deviceLabelFrom(req.headers.get("user-agent")));
    devicePin = !!device.pinHash;
  }
  await audit({ uid: user.id, name: user.name ?? undefined }, "STAFF_LOGIN", "User", user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role },
    // Lets the login screen offer "set a PIN" the first time on this browser.
    canSetPin: user.role === "OWNER",
    hasPin: devicePin,
  });
});
