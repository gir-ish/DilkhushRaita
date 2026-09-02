import { normalizePhone } from "./utils";

/**
 * Promotional SMS — the "Website Promotion" campaign sent from the Marketing
 * page.
 *
 * Kept entirely separate from the OTP path in src/lib/otp.ts, and not sharing
 * its code, because the two are different things that happen to use one
 * gateway. An OTP is transactional: one code, one number that just asked for
 * it, on a template registered as transactional. This is promotional: one fixed
 * message to a list, on its own DLT template, and every recipient is billed.
 * Mixing them is how a promotion ends up sent on the OTP template, which gets
 * it dropped and gets the sender ID complained about.
 *
 * The message lives here rather than in the environment on purpose. It carries
 * no secret and never changes between machines — it changes only when DLT
 * approves a new version — so a constant in version control is both safer than
 * a pasted line and the only copy that can be reviewed in a diff. The
 * environment holds credentials and IDs, which is what an environment is for.
 */

/**
 * The wording approved as DLT template 1777178765648170151, character for
 * character as it appears in the provider's portal.
 *
 * It carries no {#var#} — the whole message is fixed text, so there is nothing
 * to substitute and nothing that can be left unfilled.
 *
 * DO NOT EDIT to improve the phrasing. An Indian operator compares every
 * message against the registered template and silently drops anything that
 * differs, after the credit has been spent. Change it in the portal first, get
 * it approved, then change it here to match.
 */
export const PROMO_MESSAGE =
  "Dilkhush Raita Wala Dhaba is now online! Enjoy delicious dhaba-style food, " +
  "fresh flavors and your favorite dishes from the comfort of home. " +
  "Explore our menu and order now at https://dilkhushraita.com/";

/** 160 GSM-7 characters in one credit; longer messages are billed per 153. */
export function creditsFor(message: string): number {
  return message.length <= 160 ? 1 : Math.ceil(message.length / 153);
}

export interface RecipientList {
  /** Valid, unique, in the order first seen. */
  numbers: string[];
  /** Entries that could not be used, with the reason, to show back. */
  rejected: { raw: string; why: string }[];
  /** How many duplicates were collapsed. */
  duplicates: number;
}

/**
 * Turns whatever was pasted or uploaded into numbers the gateway will accept.
 *
 * Splits on line breaks, commas, semicolons and tabs — but NOT on a plain
 * space, because Indian numbers are routinely written with spaces inside them:
 * "+91 98765 43210". Splitting on those turns one number into three unusable
 * fragments, which is exactly the paste most likely to come off a phone's
 * contact list. Spaces are stripped from within each piece instead.
 *
 * Duplicates are collapsed rather than reported as errors: the same number
 * twice is a spreadsheet artefact, not a decision, and sending twice would cost
 * twice while annoying once.
 */
export function parseRecipients(raw: string, max = 5000): RecipientList {
  const seen = new Set<string>();
  const numbers: string[] = [];
  const rejected: { raw: string; why: string }[] = [];
  let duplicates = 0;

  for (const piece of raw.split(/[\r\n,;\t]+/)) {
    const token = piece.replace(/\s+/g, "");
    if (!token) continue;

    if (numbers.length >= max) {
      rejected.push({ raw: token.slice(0, 20), why: `over the ${max} limit for one campaign` });
      continue;
    }
    const normalised = normalizePhone(token);
    if (!normalised) {
      rejected.push({ raw: token.slice(0, 20), why: "not a valid Indian mobile number" });
      continue;
    }
    if (seen.has(normalised)) {
      duplicates++;
      continue;
    }
    seen.add(normalised);
    numbers.push(normalised);
  }

  return { numbers, rejected, duplicates };
}

/**
 * How the gateway is fed.
 *
 * It accepts comma-separated numbers, but one enormous URL is fragile — query
 * strings have practical length limits at every hop — and a single failure
 * would take the whole campaign with it. Batches keep a failure to its own
 * slice and let progress be reported honestly.
 */
export const BATCH_SIZE = 50;

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export interface PromoConfig {
  senderId: string;
  templateId: string;
  apiKey?: string;
}

/**
 * Credentials and IDs, which DO belong in the environment: they differ between
 * machines and one of them is a secret.
 */
export function promoConfig(): PromoConfig | null {
  const senderId = process.env.STPL_SENDER_ID?.trim();
  const templateId = process.env.STPL_PROMO_TEMPLATE_ID?.trim();
  if (!senderId || !templateId) return null;
  return { senderId, templateId, apiKey: process.env.STPL_API_KEY?.trim() || undefined };
}

/** What the gateway said about one batch. */
export interface BatchResult {
  ok: boolean;
  detail?: string;
}

/**
 * Sends one batch.
 *
 * The query is assembled by hand with encodeURIComponent so spaces travel as
 * %20. URLSearchParams writes them as "+", which this gateway does not decode
 * back — the operator then sees "Dilkhush+Raita+Wala..." , finds it different
 * from the registered template, and drops it while still charging. That is not
 * hypothetical; it is what silently broke every OTP for a day.
 */
export async function sendPromoBatch(
  cfg: PromoConfig,
  numbers: string[],
  message: string
): Promise<BatchResult> {
  const query = [
    ...(cfg.apiKey ? [`apikey=${encodeURIComponent(cfg.apiKey)}`] : []),
    `senderid=${encodeURIComponent(cfg.senderId)}`,
    `templateid=${encodeURIComponent(cfg.templateId)}`,
    `number=${encodeURIComponent(numbers.map((n) => n.replace(/^\+/, "")).join(","))}`,
    `message=${encodeURIComponent(message)}`,
    "format=JSON",
  ].join("&");

  try {
    const res = await fetch(`https://smsfortius.org/V2/apikey.php?${query}`, {
      signal: AbortSignal.timeout(30_000),
    });
    const text = await res.text();
    let data: { status?: boolean | string; code?: string; description?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, detail: `gateway did not return JSON (HTTP ${res.status})` };
    }
    // "011" is the reliable signal. `status` is documented as a boolean and
    // arrives as the string "Success"; both are accepted.
    const status = typeof data.status === "string" ? data.status.toLowerCase() : data.status;
    const ok =
      res.ok && (data.code === "011" || status === true || status === "true" || status === "success");
    if (ok) return { ok: true };

    const KNOWN: Record<string, string> = {
      "001": "the gateway rejected the API key",
      "003": "the gateway does not recognise this sender ID",
      "007": "no valid destination number in the batch",
      "008": "ACCOUNT OUT OF CREDIT",
      "009": "PARENT ACCOUNT OUT OF BALANCE",
    };
    return {
      ok: false,
      detail: (data.code ? KNOWN[data.code] : undefined) ?? data.description ?? `code ${data.code ?? "?"}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error" };
  }
}
