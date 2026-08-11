import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { hashOtp } from "@/lib/otp";
import { OTP_MAX_ATTEMPTS } from "@/lib/constants";
import { deviceLabelFrom, deviceOwner, trustThisDevice } from "@/lib/staff-device";
import { audit } from "@/lib/audit";

const Body = z.object({
  code: z.string().regex(/^\d{6}$/, "Enter the 6-digit code"),
  pin: z.string().regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits"),
});

/**
 * Verifies the emailed code and sets a new PIN.
 *
 * Does NOT sign the owner in. Proving you can read the mailbox is enough to
 * replace a PIN, but the session still comes from entering that new PIN — so
 * an intercepted email alone never yields a live dashboard.
 */
export const POST = handler(async (req: Request) => {
  const device = await deviceOwner();
  if (!device) throw new HttpError(401, "This device is not paired. Sign in with your password instead.");
  if (!device.user.email) throw new HttpError(400, "This account has no email address on file");

  if (!rateLimit(`pin-reset:${device.id}:${clientIp(req)}`, 10, 30 * 60 * 1000))
    throw new HttpError(429, "Too many attempts. Try again later.");

  const body = Body.parse(await req.json());
  if (/^(\d)\1+$/.test(body.pin))
    throw new HttpError(400, "That PIN is too easy to guess — avoid all-same digits");

  const identifier = `pin:${device.user.email.toLowerCase()}`;
  const otp = await db.otpCode.findFirst({
    where: { phone: identifier, consumedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (!otp) throw new HttpError(400, "Request a code first");
  if (otp.expiresAt < new Date()) throw new HttpError(400, "That code has expired. Request a new one.");
  if (otp.attempts >= OTP_MAX_ATTEMPTS)
    throw new HttpError(429, "Too many wrong codes. Request a new one.");

  if (otp.codeHash !== hashOtp(identifier, body.code)) {
    await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
    const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
    throw new HttpError(400, left > 0 ? `Incorrect code. ${left} attempts left.` : "Too many wrong codes. Request a new one.");
  }

  await db.$transaction([
    db.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } }),
    db.user.update({
      where: { id: device.user.id },
      data: { pinHash: await bcrypt.hash(body.pin, 10) },
    }),
  ]);
  await trustThisDevice(device.user.id, deviceLabelFrom(req.headers.get("user-agent")));
  await audit(
    { uid: device.user.id, name: device.user.name ?? undefined },
    "STAFF_PIN_RESET",
    "User",
    device.user.id,
    { device: device.label }
  );

  return NextResponse.json({ ok: true });
});
