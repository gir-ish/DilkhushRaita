import { NextResponse } from "next/server";
import { randomInt } from "crypto";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { hashOtp } from "@/lib/otp";
import { emailConfigured, pinResetEmail, sendEmail } from "@/lib/email";
import { deviceOwner } from "@/lib/staff-device";

const TTL_MINUTES = 10;

/**
 * Emails a one-time code to the owner's own address so they can set a new PIN.
 *
 * The address is never taken from the request — it is read from the account
 * this device is paired with. Otherwise anyone could point the reset at a
 * mailbox they control.
 *
 * The code is generated, hashed and checked by us; Gmail only carries it. That
 * is the same arrangement the SMS OTP already uses (src/lib/otp.ts).
 */
export const POST = handler(async (req: Request) => {
  const device = await deviceOwner();
  if (!device) throw new HttpError(401, "This device is not paired. Sign in with your password instead.");
  if (!device.user.email) throw new HttpError(400, "This account has no email address on file");
  if (!emailConfigured())
    throw new HttpError(503, "Email is not configured on the server — sign in with your password instead.");

  // Enough to retry a lost mail, not enough to use as a mail bomb.
  if (!rateLimit(`pin-forgot:${device.user.id}`, 3, 30 * 60 * 1000))
    throw new HttpError(429, "A code was already sent. Check your inbox, or try again in a while.");
  if (!rateLimit(`pin-forgot-ip:${clientIp(req)}`, 6, 30 * 60 * 1000))
    throw new HttpError(429, "Too many requests. Try again later.");

  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const identifier = `pin:${device.user.email.toLowerCase()}`;

  // Any earlier code stops working the moment a new one is sent.
  await db.otpCode.updateMany({
    where: { phone: identifier, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await db.otpCode.create({
    data: {
      phone: identifier,
      codeHash: hashOtp(identifier, code),
      expiresAt: new Date(Date.now() + TTL_MINUTES * 60 * 1000),
    },
  });

  const mail = pinResetEmail(code, TTL_MINUTES);
  const sent = await sendEmail({ to: device.user.email, ...mail });
  if (!sent.ok) throw new HttpError(502, sent.error ?? "Could not send the email");

  // Masked so the screen confirms which inbox to open without publishing the
  // address to anyone holding the device.
  const [name, domain] = device.user.email.split("@");
  const masked = `${name.slice(0, 2)}${"•".repeat(Math.max(name.length - 2, 1))}@${domain}`;
  return NextResponse.json({ ok: true, sentTo: masked, expiresInMinutes: TTL_MINUTES });
});
