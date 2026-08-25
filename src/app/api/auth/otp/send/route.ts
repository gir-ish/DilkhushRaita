import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError } from "@/lib/guard";
import { generateOtp, hashOtp, otpProvider } from "@/lib/otp";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { normalizePhone } from "@/lib/utils";
import {
  OTP_EXPIRY_MINS,
  OTP_MAX_PER_HOUR,
  OTP_RESEND_COOLDOWN_SECS,
} from "@/lib/constants";

const Body = z.object({ phone: z.string().min(10).max(15) });

// TEMPORARY: real SMS delivery isn't wired up yet (MSG91/DLT pending).
// Set OTP_BYPASS="false" the moment a real OTP_PROVIDER is configured —
// while true, ANYONE can sign in as ANY phone number with no verification.
const OTP_BYPASS = process.env.OTP_BYPASS === "true";

export const POST = handler(async (req: Request) => {
  const body = Body.parse(await req.json());
  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(400, "Enter a valid Indian mobile number");

  const ip = clientIp(req);
  if (!rateLimit(`otp:ip:${ip}`, 15, 60 * 60 * 1000))
    throw new HttpError(429, "Too many requests. Try again later.");

  /*
   * Circuit breaker on the SMS bill.
   *
   * Every send costs money. The per-number cap below is held in the database
   * and cannot be dodged, but nothing stopped one script walking through a
   * list of numbers and paying for a message on each — the address-keyed limit
   * above reads a header the caller writes, so rotating it buys a fresh
   * allowance every time.
   *
   * A whole-system ceiling is the backstop: a real dhaba does not send
   * hundreds of login codes an hour, so if that is happening it is not
   * customers. Raise OTP_MAX_PER_HOUR_GLOBAL if the shop genuinely outgrows it.
   */
  const globalCap = Number(process.env.OTP_MAX_PER_HOUR_GLOBAL) || 200;
  if (!rateLimit("otp:global", globalCap, 60 * 60 * 1000)) {
    console.error("[otp] global hourly send cap reached — possible SMS abuse");
    throw new HttpError(429, "We cannot send codes right now. Please try again later.");
  }

  if (OTP_BYPASS) {
    // No SMS sent, no code generated — the verify step will skip checking too.
    return NextResponse.json({ ok: true, bypass: true });
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const recent = await db.otpCode.findMany({
    where: { phone, createdAt: { gte: hourAgo } },
    orderBy: { createdAt: "desc" },
  });
  if (recent.length >= OTP_MAX_PER_HOUR)
    throw new HttpError(429, "OTP limit reached for this number. Try again in an hour.");
  const last = recent[0];
  if (last) {
    const since = (Date.now() - last.createdAt.getTime()) / 1000;
    if (since < OTP_RESEND_COOLDOWN_SECS)
      throw new HttpError(
        429,
        `Please wait ${Math.ceil(OTP_RESEND_COOLDOWN_SECS - since)}s before resending`
      );
  }

  const code = generateOtp();
  await db.otpCode.create({
    data: {
      phone,
      codeHash: hashOtp(phone, code),
      expiresAt: new Date(Date.now() + OTP_EXPIRY_MINS * 60 * 1000),
    },
  });
  const sent = await otpProvider().send(phone, code);
  if (!sent.ok) throw new HttpError(502, "Could not send OTP. Please try again.");

  return NextResponse.json({
    ok: true,
    resendIn: OTP_RESEND_COOLDOWN_SECS,
    expiresInMins: OTP_EXPIRY_MINS,
    // DEV ONLY — present only with the console provider outside production.
    ...(sent.devCode && process.env.NODE_ENV !== "production"
      ? { devOtp: sent.devCode }
      : {}),
  });
});
