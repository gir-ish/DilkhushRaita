import { createHash, randomInt, timingSafeEqual } from "crypto";
import otpTemplate from "../../config/otp-template.json";
import { OTP_EXPIRY_MINS, OTP_LENGTH } from "./constants";

/**
 * Modular OTP/SMS provider. Select with the OTP_PROVIDER env variable:
 *
 *   console  — DEV ONLY. Prints the OTP to the server console and (outside
 *              production) returns it in the API response for the login screen.
 *
 *   stpl     — STPL / smsfortius.org. The shop's gateway, and the only one
 *              that sends a real message. A general-purpose SMS API rather
 *              than a dedicated OTP route, so WE write the message text — and
 *              it has to match a DLT-approved template word for word or the
 *              operator drops it.
 *              Env: STPL_API_KEY, STPL_SENDER_ID. The template — ID and
 *              wording — is config/otp-template.json.
 *
 * Fast2SMS and MSG91 were carried here from before the shop had an account of
 * its own. Two unused gateways is two more ways for OTP_PROVIDER to name
 * something that quietly does not send, so they are gone.
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
 * The approved OTP template: its ID and wording, from config/otp-template.json.
 *
 * Both come from the one file on purpose. They used to be split — the ID in the
 * server's .env, the wording in a text file — and a deploy that changes one
 * without the other sends the new wording under the old ID, which the
 * operator drops after the credit is spent, and nobody can sign in.
 */
export const OTP_TEMPLATE_ID: string = otpTemplate.id;
export const OTP_TEMPLATE_TEXT: string = otpTemplate.text;

/**
 * The OTP SMS with the code and the minutes filled in.
 *
 * The registered text reads "Valid for{#var#}minutes" — no spaces around the
 * slot — so the minutes go in with a space either side: " 5 ", and the
 * customer reads "Valid for 5 minutes". A slot may hold spaces; the fixed text
 * around it is unchanged, which is all the operator compares.
 */
export function composeOtpMessage(code: string, minutes: number = OTP_EXPIRY_MINS): string {
  const slots = OTP_TEMPLATE_TEXT.match(/\{#var#\}/g)?.length ?? 0;
  if (slots !== 2) throw new Error(`The OTP template has ${slots} slots; it should have 2 (code, minutes)`);
  const values = [code, ` ${minutes} `];
  let i = 0;
  return OTP_TEMPLATE_TEXT.replace(/\{#var#\}/g, () => values[i++]);
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

/**
 * Not a gateway — a test double, so a developer can sign in without spending a
 * real SMS on every attempt.
 *
 * It refuses outright in production. Reporting a code as sent while printing
 * it to the server log would tell customers to watch a phone that will never
 * ring and leave the thing guarding their account sitting in a log file.
 */
const consoleProvider: OtpProvider = {
  name: "console",
  async send(phone, code) {
    if (process.env.NODE_ENV === "production") {
      console.error(
        '[OTP] OTP_PROVIDER is "console" in production — that prints codes to the log ' +
          'instead of sending them. Refusing. Set OTP_PROVIDER="stpl".'
      );
      return { ok: false };
    }
    console.log(`\n[OTP][DEV] ${phone} → code: ${code}\n`);
    return { ok: true, devCode: code };
  },
};


/**
 * What each documented failure code means, so a dead gateway says why in the
 * log instead of just "send failed". The two balance codes are the ones worth
 * recognising on sight: nothing is wrong with the integration, the account has
 * simply run out of money and every login on the site is failing because of it.
 */
const STPL_ERRORS: Record<string, string> = {
  "001": "no API key sent — set STPL_API_KEY",
  "002": "invalid route id",
  // Undocumented, seen live: the sender ID is not one registered to this
  // account. The gateway checks this before it accepts a message.
  "003": "the gateway does not recognise this sender ID — check STPL_SENDER_ID",
  "004": "no message text reached the gateway",
  "005": "schedule time is in the past",
  "006": "invalid date/time format",
  "007": "no valid destination number",
  "008": "ACCOUNT OUT OF CREDIT — top up, no OTP can be sent until you do",
  "009": "PARENT ACCOUNT OUT OF BALANCE — top up, no OTP can be sent until you do",
  "010": "message campaign failed at the vendor",
};

const stplProvider: OtpProvider = {
  name: "stpl",
  async send(phone, code) {
    const senderId = process.env.STPL_SENDER_ID?.trim();
    if (!senderId) {
      console.error("[OTP][stpl] STPL_SENDER_ID is not set — cannot send");
      return { ok: false };
    }
    // The gateway documents this as exactly six characters. Catching it here
    // turns a silently undelivered SMS into a line in the log that says why.
    if (senderId.length !== 6)
      console.error(`[OTP][stpl] STPL_SENDER_ID is ${senderId.length} characters; the gateway expects 6`);

    // The approved wording, filled in. Nothing about it comes from the
    // environment, so nothing on the server can put it out of step with its ID.
    const message = composeOtpMessage(code);

    // Documented as accepted with or without the country code; ours is
    // normalised to +91XXXXXXXXXX, and the leading + is not part of either form.
    const number = phone.replace(/^\+/, "");

    /*
     * The query string is built by hand, and that is the whole point.
     *
     * URLSearchParams writes a space as "+", which is correct for a form body
     * and is what this code used to send. The gateway does not turn it back
     * into a space: the operator then compares "Dear+Customer,+your+OTP..."
     * against the registered DLT template, finds it different, and drops the
     * message — while the API still answers "submitted successfully". The same
     * text pasted into a browser arrived every time, because a browser sends
     * %20. That difference is the entire bug.
     *
     * encodeURIComponent never emits "+", and %20 is what the vendor's own
     * documented example uses: message=Hello%20There.
     */
    const apiKey = process.env.STPL_API_KEY?.trim();
    const templateId = OTP_TEMPLATE_ID;
    const query = [
      // Conditional per the docs: some accounts are keyed, others authenticate
      // by route, so it is sent only when configured.
      ...(apiKey ? [`apikey=${encodeURIComponent(apiKey)}`] : []),
      `senderid=${encodeURIComponent(senderId)}`,
      // Always sent: without it the gateway guesses which template this
      // message matches, and a wrong guess is a dropped message.
      `templateid=${encodeURIComponent(templateId)}`,
      `number=${encodeURIComponent(number)}`,
      `message=${encodeURIComponent(message)}`,
      `format=JSON`,
    ].join("&");
    const url = `https://smsfortius.org/V2/apikey.php?${query}`;

    try {
      const res = await fetch(url, { method: "GET", signal: timeout() });
      const text = await res.text();
      let data: {
        status?: boolean | string;
        code?: string;
        description?: string;
        data?: unknown;
      } = {};
      try {
        data = JSON.parse(text);
      } catch {
        // A gateway that answers with a PHP notice or an HTML error page is
        // still a failure, and the body is the only clue as to why.
        console.error(`[OTP][stpl] non-JSON reply (${res.status}):`, text.slice(0, 200));
        return { ok: false };
      }

      /*
       * "011" is the documented success code and the reliable signal.
       *
       * `status` is not: the documentation shows a boolean true, the live
       * gateway answers with the string "Success", and PHP back ends of this
       * shape commonly return "true" as well. All three are accepted, because
       * treating a delivered message as failed would have the customer asking
       * for a second code while the first is already on its way.
       */
      const status = typeof data.status === "string" ? data.status.toLowerCase() : data.status;
      const ok =
        res.ok &&
        (data.code === "011" || status === true || status === "true" || status === "success");
      if (!ok) {
        const why =
          (data.code ? STPL_ERRORS[data.code] : undefined) ??
          data.description ??
          "unrecognised error";
        // Never the URL: it carries the API key.
        console.error(`[OTP][stpl] send failed (${res.status}) code=${data.code ?? "?"}: ${why}`);
        return { ok: false };
      }
      return { ok: true };
    } catch (e) {
      const why = e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error";
      console.error(`[OTP][stpl] ${why}:`, e);
      return { ok: false };
    }
  },
};

const providers: Record<string, OtpProvider> = {
  console: consoleProvider,
  stpl: stplProvider,
  // The vendor writes itself STPL; this transposition is easy to make and is
  // not worth a site-wide outage.
  sptl: stplProvider,
  smsfortius: stplProvider,
};

/**
 * Refuses to send, loudly, when OTP_PROVIDER names a gateway that does not
 * exist.
 *
 * Falling back to the console provider — the old behaviour — is the worst
 * possible answer in production: it reports the code as sent and prints it to
 * the server log, so every customer is told to check a phone that will never
 * ring, and the thing protecting their account sits in a log file. One
 * misspelling and nobody can sign in, with nothing to say why.
 */
const misconfiguredProvider: OtpProvider = {
  name: "misconfigured",
  async send() {
    console.error(
      `[OTP] OTP_PROVIDER="${process.env.OTP_PROVIDER}" is not a known gateway. ` +
        `Expected one of: ${Object.keys(providers).join(", ")}. Refusing to send.`
    );
    return { ok: false };
  },
};

export function otpProvider(): OtpProvider {
  const name = process.env.OTP_PROVIDER ?? "console";
  const chosen = providers[name];
  if (chosen) return chosen;
  // In development an unknown name is a typo you want to see immediately; in
  // production it is an outage you want reported rather than hidden.
  return process.env.NODE_ENV === "production" ? misconfiguredProvider : consoleProvider;
}

export function generateOtp(): string {
  return randomInt(0, 10 ** OTP_LENGTH).toString().padStart(OTP_LENGTH, "0");
}

export function hashOtp(phone: string, code: string): string {
  return createHash("sha256")
    .update(`${phone}:${code}:${process.env.SESSION_SECRET}`)
    .digest("hex");
}

/**
 * Compare a stored OTP hash with a freshly computed one without leaking, in how
 * long the comparison takes, how much of it matched.
 *
 * Both sides are fixed-length SHA-256 hex here, so `!==` was not a practical
 * way in — but this is the comparison guarding account takeover, and there is
 * no reason for it to be the timing-variable kind.
 */
export function otpHashMatches(storedHash: string, candidateHash: string): boolean {
  const a = Buffer.from(storedHash, "utf8");
  const b = Buffer.from(candidateHash, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Is the "skip verification entirely" switch on?
 *
 * OTP_BYPASS was a launch convenience: with it set, /api/auth/otp/send sends
 * nothing and /api/auth/otp/verify checks nothing, so posting any phone number
 * signs you in as its owner. That is the whole account system turned off by one
 * word in a file — and the file gets copied between machines by hand.
 *
 * So production refuses it outright rather than trusting whoever last edited
 * the environment. This mirrors the console provider, which likewise will not
 * run in production: a flag whose failure mode is "anyone is anyone" should
 * take more than a typo to switch on.
 */
export function otpBypassEnabled(): boolean {
  if (process.env.OTP_BYPASS !== "true") return false;
  if (process.env.NODE_ENV === "production") {
    console.error(
      "[OTP] OTP_BYPASS=true is IGNORED in production — it would let anyone sign " +
        "in as any phone number without a code. Unset it to silence this."
    );
    return false;
  }
  return true;
}
