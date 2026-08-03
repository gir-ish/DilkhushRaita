import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { createSessionCookie } from "@/lib/session";
import { STAFF_ROLES, type Role } from "@/lib/constants";
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
  await audit({ uid: user.id, name: user.name ?? undefined }, "STAFF_LOGIN", "User", user.id);
  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, role: user.role },
  });
});
