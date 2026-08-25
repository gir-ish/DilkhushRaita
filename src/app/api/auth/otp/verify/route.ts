import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { hashOtp } from "@/lib/otp";
import {
  clearIdentityFailures,
  clientIp,
  identityAllowed,
  rateLimit,
  recordIdentityFailure,
} from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/utils";
import { createSessionCookie } from "@/lib/session";
import { OTP_MAX_ATTEMPTS } from "@/lib/constants";

const Body = z.object({
  phone: z.string().min(10).max(15),
  // Optional because bypass mode sends no real code; enforced as 6 digits
  // below whenever OTP_BYPASS is off.
  code: z.string().optional(),
  // Optional in the schema so existing accounts can sign in from any client;
  // required below when the account is being created.
  name: z.string().max(60).optional(),
});

// TEMPORARY — mirrors the flag in otp/send/route.ts. Must both be flipped
// back together once real SMS delivery (MSG91/DLT) is live.
const OTP_BYPASS = process.env.OTP_BYPASS === "true";

export const POST = handler(async (req: Request) => {
  const body = Body.parse(await req.json());
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(400, "Enter a valid Indian mobile number");

  if (!rateLimit(`otpv:${clientIp(req)}`, 30, 60 * 60 * 1000))
    throw new HttpError(429, "Too many attempts. Try again later.");

  /*
   * Counted against the number being claimed.
   *
   * The per-row attempt counter below caps guesses at one issued code, but
   * nothing stopped someone requesting a fresh code and starting over, and the
   * address in the limit above can be changed at will. Taking over an account
   * means guessing codes sent to that number, so that number is what is
   * counted — across every code it is ever issued.
   */
  const OTP_FAILS = 10;
  const OTP_WINDOW = 60 * 60 * 1000;
  if (!identityAllowed("otp-verify", phone, OTP_FAILS, OTP_WINDOW))
    throw new HttpError(429, "Too many incorrect codes for this number. Try again in an hour.");

  if (!OTP_BYPASS) {
    if (!body.code || !/^\d{6}$/.test(body.code))
      throw new HttpError(400, "Enter the 6-digit OTP");

    const otp = await db.otpCode.findFirst({
      where: { phone, consumedAt: null },
      orderBy: { createdAt: "desc" },
    });
    if (!otp) throw new HttpError(400, "Request an OTP first");
    if (otp.expiresAt < new Date()) throw new HttpError(400, "OTP expired. Request a new one.");
    if (otp.attempts >= OTP_MAX_ATTEMPTS)
      throw new HttpError(429, "Too many wrong attempts. Request a new OTP.");

    if (otp.codeHash !== hashOtp(phone, body.code)) {
      await db.otpCode.update({ where: { id: otp.id }, data: { attempts: { increment: 1 } } });
      recordIdentityFailure("otp-verify", phone, OTP_WINDOW);
      const left = OTP_MAX_ATTEMPTS - otp.attempts - 1;
      throw new HttpError(400, left > 0 ? `Incorrect OTP. ${left} attempts left.` : "Too many wrong attempts. Request a new OTP.");
    }

    await db.otpCode.update({ where: { id: otp.id }, data: { consumedAt: new Date() } });
    clearIdentityFailures("otp-verify", phone);
  }

  let user = await db.user.findUnique({ where: { phone } });
  if (!user) {
    const name = body.name?.trim();
    if (!name || name.length < 2)
      throw new HttpError(400, "Please enter your name to create an account");
    user = await db.user.create({
      data: {
        phone,
        name,
        role: "CUSTOMER",
        profile: {
          create: {
            referralCode: "DK" + Math.random().toString(36).slice(2, 8).toUpperCase(),
          },
        },
        metrics: { create: {} },
      },
    });
  } else if (user.blocked) {
    throw new HttpError(403, "This account is blocked. Contact support.");
  } else if (body.name && !user.name) {
    user = await db.user.update({ where: { id: user.id }, data: { name: body.name.trim() } });
  }

  if (user.role !== "CUSTOMER")
    throw new HttpError(403, "Staff accounts must sign in from the dashboard");

  await createSessionCookie({
    uid: user.id,
    role: "CUSTOMER",
    name: user.name ?? undefined,
    phone,
  });
  return NextResponse.json({
    ok: true,
    user: { id: user.id, name: user.name, phone: user.phone },
  });
});
