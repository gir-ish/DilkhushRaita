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
 *   sptl     — SPTL / smsfortius.org. A general-purpose SMS API rather than a
 *              dedicated OTP route, so unlike the two above WE write the
 *              message text — and it has to match a DLT-approved template
 *              word for word or the operator drops it.
 *              Env: SPTL_API_KEY, SPTL_SENDER_ID, SPTL_TEMPLATE_ID,
 *                   SPTL_MESSAGE
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

/**
 * How long to wait on a gateway before giving up, in ms.
 *
 * Node's fetch has no timeout of its own, so a gateway that accepts a
 * connection and then goes quiet would hold the customer's sign-in request
 * open until something else gave out. Ten seconds is far longer than any of
 * these APIs need and still short enough to fail visibly.
 */
const SEND_TIMEOUT_MS = 10_000;

function timeout() {
  return AbortSignal.timeout(SEND_TIMEOUT_MS);
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
        signal: timeout(),
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
        signal: timeout(),
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

/**
 * What each documented failure code means, so a dead gateway says why in the
 * log instead of just "send failed". The two balance codes are the ones worth
 * recognising on sight: nothing is wrong with the integration, the account has
 * simply run out of money and every login on the site is failing because of it.
 */
const SPTL_ERRORS: Record<string, string> = {
  "001": "no API key sent — set SPTL_API_KEY",
  "002": "invalid route id",
  "004": "no message text reached the gateway",
  "005": "schedule time is in the past",
  "006": "invalid date/time format",
  "007": "no valid destination number",
  "008": "ACCOUNT OUT OF CREDIT — top up, no OTP can be sent until you do",
  "009": "PARENT ACCOUNT OUT OF BALANCE — top up, no OTP can be sent until you do",
  "010": "message campaign failed at the vendor",
};

/** Default message. Override with SPTL_MESSAGE to match your approved template. */
const SPTL_DEFAULT_MESSAGE = "{otp} is your OTP for DilKhush Dhaba. Valid for 5 minutes. Do not share it with anyone.";

const sptlProvider: OtpProvider = {
  name: "sptl",
  async send(phone, code) {
    const senderId = process.env.SPTL_SENDER_ID?.trim();
    if (!senderId) {
      console.error("[OTP][sptl] SPTL_SENDER_ID is not set — cannot send");
      return { ok: false };
    }
    // The gateway documents this as exactly six characters. Catching it here
    // turns a silently undelivered SMS into a line in the log that says why.
    if (senderId.length !== 6)
      console.error(`[OTP][sptl] SPTL_SENDER_ID is ${senderId.length} characters; the gateway expects 6`);

    /*
     * The text is ours to write, which makes it ours to get wrong. Indian
     * operators match every message against the DLT template registered for
     * this sender and silently bin anything that differs, so SPTL_MESSAGE must
     * be the approved wording with {otp} where the variable sits.
     */
    const template = process.env.SPTL_MESSAGE?.trim() || SPTL_DEFAULT_MESSAGE;
    const message = template.replace(/\{otp\}/gi, code);

    // Documented as accepted with or without the country code; ours is
    // normalised to +91XXXXXXXXXX, and the leading + is not part of either form.
    const number = phone.replace(/^\+/, "");

    const url = new URL("https://smsfortius.org/V2/apikey.php");
    // URLSearchParams percent-encodes as it builds, which is what the API asks
    // for — the message carries spaces and punctuation.
    url.searchParams.set("senderid", senderId);
    url.searchParams.set("number", number);
    url.searchParams.set("message", message);
    url.searchParams.set("format", "JSON");
    // Documented as conditional: some accounts are keyed, others authenticate
    // by route, so it is sent only when configured.
    const apiKey = process.env.SPTL_API_KEY?.trim();
    if (apiKey) url.searchParams.set("apikey", apiKey);
    // Optional per the docs, but without it the gateway guesses which template
    // this message matches. Set it and the match is exact.
    const templateId = process.env.SPTL_TEMPLATE_ID?.trim();
    if (templateId) url.searchParams.set("templateid", templateId);

    try {
      const res = await fetch(url, { method: "GET", signal: timeout() });
      const text = await res.text();
      let data: { status?: boolean | string; code?: string; data?: unknown } = {};
      try {
        data = JSON.parse(text);
      } catch {
        // A gateway that answers with a PHP notice or an HTML error page is
        // still a failure, and the body is the only clue as to why.
        console.error(`[OTP][sptl] non-JSON reply (${res.status}):`, text.slice(0, 200));
        return { ok: false };
      }

      // "011" is the documented success code. `status` has been seen as both a
      // real boolean and the string "true" from PHP back ends, so accept both
      // rather than fail a delivery that actually happened.
      const ok =
        res.ok && (data.status === true || data.status === "true" || data.code === "011");
      if (!ok) {
        const why = data.code ? (SPTL_ERRORS[data.code] ?? "unrecognised error code") : "no code returned";
        // Never the URL: it carries the API key.
        console.error(`[OTP][sptl] send failed (${res.status}) code=${data.code ?? "?"}: ${why}`);
        return { ok: false };
      }
      return { ok: true };
    } catch (e) {
      const why = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error";
      console.error(`[OTP][sptl] ${why}:`, e);
      return { ok: false };
    }
  },
};

const providers: Record<string, OtpProvider> = {
  console: consoleProvider,
  fast2sms: fast2smsProvider,
  msg91: msg91Provider,
  sptl: sptlProvider,
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
