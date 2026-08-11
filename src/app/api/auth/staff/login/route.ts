import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createSessionCookie } from "@/lib/session";
import { STAFF_ROLES, type Role } from "@/lib/constants";
import { deviceLabelFrom, trustThisDevice } from "@/lib/staff-device";
import { audit } from "@/lib/audit";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(6).max(100),
});

export const POST = handler(async (req: Request) => {
  if (!rateLimit(`staff-login:${clientIp(req)}`, 10, 15 * 60 * 1000))
    throw new HttpError(429, "Too many attempts. Try again in 15 minutes.");

  const body = Body.parse(await req.json());
  const user = await db.user.findUnique({ where: { email: body.email.toLowerCase() } });
  if (!user || !user.passwordHash || !STAFF_ROLES.includes(user.role as Role))
    throw new HttpError(401, "Invalid email or password");
  if (user.blocked) throw new HttpError(403, "Account disabled");
  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) throw new HttpError(401, "Invalid email or password");

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
