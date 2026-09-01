import { readFileSync } from "fs";
import path from "path";
import { normalizePhone } from "./utils";

/**
 * Bulk promotional SMS, for the marketing page.
 *
 * Kept apart from the OTP path on purpose. That one sends a code to one number
 * that just asked for it; this one sends the same message to a list, on a
 * different DLT template, and every recipient costs money. The two share a
 * gateway and nothing else.
 *
 * The rules here are mostly about not spending more than intended: an SMS
 * campaign is one button that can empty a balance, and a mistyped list or a
 * double-click should not be able to.
 */

/** 160 GSM-7 characters per credit; longer messages are billed per 153. */
export function creditsFor(message: string): number {
  const len = message.length;
  if (len <= 160) return 1;
  return Math.ceil(len / 153);
}

export interface RecipientList {
  /** Valid, unique, in the order first seen. */
  numbers: string[];
  /** Entries that were not usable, with the reason, for showing back. */
  rejected: { raw: string; why: string }[];
  /** How many duplicates were collapsed. */
  duplicates: number;
}

/**
 * Turns whatever was pasted in — a CSV column, one per line, comma separated,
 * with or without +91 — into numbers the gateway will accept.
 *
 * Duplicates are collapsed rather than reported as errors: the same number
 * twice in a pasted list is a spreadsheet artefact, not a decision, and sending
 * twice would cost twice and annoy once.
 */
export function parseRecipients(raw: string, max = 5000): RecipientList {
  const seen = new Set<string>();
  const numbers: string[] = [];
  const rejected: { raw: string; why: string }[] = [];
  let duplicates = 0;

  /*
   * Split on line breaks, commas, semicolons and tabs — but NOT on a plain
   * space, because Indian numbers are routinely written with spaces inside
   * them: "+91 98765 43210". Splitting on those turns one number into three
   * unusable fragments, which is exactly the paste most likely to arrive from
   * a phone's contact list.
   *
   * Spaces are then removed from within each piece instead. The cost is that
   * two numbers separated only by a space on one line read as one long number
   * and get reported back as unusable, which is visible and fixable, rather
   * than silently dropped.
   */
  for (const piece of raw.split(/[\r\n,;\t]+/)) {
    const token = piece.replace(/\s+/g, "");
    if (!token) continue;
    if (numbers.length >= max) {
      rejected.push({ raw: token, why: `over the ${max} limit for one campaign` });
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
 * The approved promotional wording.
 *
 * Same arrangement as the OTP template and for the same reason: a long line
 * pasted into a server .env lost characters out of its middle once already, and
 * a promotional message that does not match its DLT template is dropped by the
 * operator after being paid for. A file arrives over git byte-exact.
 */
export function promoTemplate(): string | null {
  const inline = process.env.STPL_PROMO_MESSAGE?.trim();
  if (inline) return inline;
  const file = process.env.STPL_PROMO_MESSAGE_FILE?.trim();
  if (!file) return null;
  try {
    return readFileSync(path.resolve(process.cwd(), file), "utf8").trim() || null;
  } catch (e) {
    console.error(`[sms][promo] could not read STPL_PROMO_MESSAGE_FILE (${file}):`, e);
    return null;
  }
}

/**
 * Fills the template for one recipient.
 *
 * `{name}` is the only variable a campaign has, and it must always resolve to
 * something: an operator matches the fixed text around a variable, and a blank
 * where a word belongs changes that text.
 */
export function renderPromo(template: string, name?: string | null): string {
  const safe = (name ?? "").trim().replace(/[^\x20-\x7E]/g, "").slice(0, 20);
  let out = template.replace(/\{name\}/gi, safe || "Customer");
  // A lone DLT slot is unambiguous, exactly as in the OTP path.
  if ((out.match(/\{#var#\}/g) ?? []).length === 1)
    out = out.replace("{#var#}", safe || "Customer");
  return out;
}

/** Nothing half-built ever goes to the gateway, since every send is billed. */
export function promoIsSendable(message: string): { ok: true } | { ok: false; why: string } {
  if (!message.trim()) return { ok: false, why: "The message is empty." };
  if (message.includes("{#var#}") || /\{name\}/i.test(message))
    return {
      ok: false,
      why:
        "The message still has an unfilled placeholder. Every {#var#} needs a literal value, " +
        "or the operator drops it after charging for it.",
    };
  if (/[^\x20-\x7E]/.test(message))
    return {
      ok: false,
      why:
        "The message has characters the gateway cannot send as plain text. " +
        "Remove any emoji, rupee signs or Hindi and use plain English.",
    };
  return { ok: true };
}

/**
 * How the gateway is fed.
 *
 * It accepts comma-separated numbers, but a single enormous URL is fragile —
 * query strings have practical length limits at every hop — and one failure
 * would take the whole campaign with it. Batches keep a failure to its own
 * slice and let progress be reported honestly.
 */
export const BATCH_SIZE = 50;

export function batches<T>(items: T[], size = BATCH_SIZE): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
