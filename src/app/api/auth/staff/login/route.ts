import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import {
  clearIdentityFailures,
  clientIp,
  identityLock,
  rateLimit,
  recordFailureWithLockout,
  triesLeft,
} from "@/lib/rate-limit";
import { createSessionCookie } from "@/lib/session";
import { STAFF_ROLES, type Role } from "@/lib/constants";
import { deviceLabelFrom, trustThisDevice } from "@/lib/staff-device";
import { audit } from "@/lib/audit";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

/** "1 hour 58 minutes", not "7080000ms" — this is read by whoever is locked out. */
function lockedMessage(ms: number): string {
  const mins = Math.ceil(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  const when = h > 0 ? `${h} hour${h === 1 ? "" : "s"}${m ? ` ${m} min` : ""}` : `${m} min`;
  return (
    `Too many failed sign-ins. This account is locked for ${when}. ` +
    `If you have a PIN set on this device you can still use it.`
  );
}

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
   * Three wrong passwords inside five minutes, then two hours shut. The window
   * and the lockout do different jobs: the window decides how fast someone may
   * guess, the lockout makes the penalty outlast it, so waiting five minutes
   * and carrying on is not a strategy.
   *
   * Wrong tries only, and a real sign-in clears both. Counting every attempt
   * would hand anyone who knows this email address a way to shut the owner out
   * of their own dashboard for two hours on demand.
   */
  const FAILS = 3;
  const WINDOW = 5 * 60 * 1000;
  const LOCKOUT = 2 * 60 * 60 * 1000;

  const lock = identityLock("staff-login", body.email);
  if (lock.locked) throw new HttpError(429, lockedMessage(lock.retryAfterMs));

  const fail = () => {
    const after = recordFailureWithLockout("staff-login", body.email, FAILS, WINDOW, LOCKOUT);
    if (after.locked) return new HttpError(429, lockedMessage(after.retryAfterMs));
    // Saying how many are left is the difference between a typo and a lockout
    // arriving as a surprise.
    const left = triesLeft("staff-login", body.email, FAILS, WINDOW);
    return new HttpError(
      401,
      `Invalid email or password. ${left} ${left === 1 ? "try" : "tries"} left before this account is locked for 2 hours.`
    );
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
