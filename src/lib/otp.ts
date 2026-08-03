import { createHash, randomInt } from "crypto";

/**
 * Modular OTP/SMS provider. Select with the OTP_PROVIDER env variable:
 *
 *   console  — DEV ONLY. Prints the OTP to the server console and (outside
 *              production) returns it in the API response for the login screen.
 *
 *   fast2sms — Fast2SMS "OTP route" (fast2sms.com). Easiest real-SMS start in
 *              India: no DLT template approval needed because the message text
 *              is their fixed "Your OTP: XXXXXX" template.
 *              Env: FAST2SMS_API_KEY
 *
 *   msg91    — MSG91 OTP API (msg91.com). Production-grade, needs a DLT-
 *              approved OTP template containing the ##otp## variable.
 *              Env: MSG91_AUTH_KEY, MSG91_TEMPLATE_ID
 *
 * The OTP itself is always generated, stored (hashed) and verified by OUR
 * server (expiry, attempt limits, rate limits in the API routes) — providers
 * are only used to deliver the SMS. Add another gateway (Twilio, Kaleyra,
 * AWS SNS…) by adding one object to `providers` below.
 */

export interface OtpProvider {
  name: string;
  send(phone: string, code: string): Promise<{ ok: boolean; devCode?: string }>;
}

const consoleProvider: OtpProvider = {
  name: "console",
  async send(phone, code) {
    console.log(`\n[OTP][DEV] ${phone} → code: ${code}\n`);
    return { ok: true, devCode: code };
  },
};

const fast2smsProvider: OtpProvider = {
  name: "fast2sms",
  async send(phone, code) {
    // phone arrives normalised as +91XXXXXXXXXX; Fast2SMS wants the 10 digits.
    const numbers = phone.replace(/^\+91/, "");
    try {
      const res = await fetch("https://www.fast2sms.com/dev/bulkV2", {
        method: "POST",
        headers: {
          authorization: process.env.FAST2SMS_API_KEY ?? "",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          route: "otp",
          variables_values: code,
          numbers,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as { return?: boolean; message?: unknown };
      if (!res.ok || data.return !== true) {
        console.error("[OTP][fast2sms] send failed:", res.status, data);
        return { ok: false };
      }
      return { ok: true };
    } catch (e) {
      console.error("[OTP][fast2sms] network error:", e);
      return { ok: false };
    }
  },
};

const msg91Provider: OtpProvider = {
  name: "msg91",
  async send(phone, code) {
    // MSG91 v5 OTP API; template must contain the ##otp## variable.
    const mobile = phone.replace("+", ""); // 91XXXXXXXXXX
    try {
      const url = new URL("https://control.msg91.com/api/v5/otp");
      url.searchParams.set("template_id", process.env.MSG91_TEMPLATE_ID ?? "");
      url.searchParams.set("mobile", mobile);
      url.searchParams.set("otp", code);
      url.searchParams.set("otp_expiry", "5");
      const res = await fetch(url, {
        method: "POST",
        headers: { authkey: process.env.MSG91_AUTH_KEY ?? "" },
      });
      const data = (await res.json().catch(() => ({}))) as { type?: string; message?: unknown };
      if (!res.ok || data.type !== "success") {
        console.error("[OTP][msg91] send failed:", res.status, data);
        return { ok: false };
      }
      return { ok: true };
    } catch (e) {
      console.error("[OTP][msg91] network error:", e);
      return { ok: false };
    }
  },
};

const providers: Record<string, OtpProvider> = {
  console: consoleProvider,
  fast2sms: fast2smsProvider,
  msg91: msg91Provider,
};

export function otpProvider(): OtpProvider {
  return providers[process.env.OTP_PROVIDER ?? "console"] ?? consoleProvider;
}

export function generateOtp(): string {
  return randomInt(100000, 1000000).toString();
}

export function hashOtp(phone: string, code: string): string {
  return createHash("sha256")
    .update(`${phone}:${code}:${process.env.SESSION_SECRET}`)
    .digest("hex");
}
