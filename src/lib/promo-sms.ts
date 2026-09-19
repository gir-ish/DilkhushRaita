import { normalizePhone } from "./utils";
import {
  NAME_FALLBACK,
  SMS_TEMPLATES,
  creditsFor,
  fillTemplate,
  firstName,
  type CampaignTemplate,
} from "./sms-templates";

/**
 * Campaigns from the Marketing page: Website Promotion, Special Offer and the
 * Points Reminder.
 *
 * Kept apart from the order messages and from the OTP path. An OTP and an order
 * update are transactional — one message to one person about something they
 * just did — while these go to a list, are billed per recipient, cannot reach a
 * number on the Do Not Disturb register, and must respect a customer who has
 * switched promotions off.
 */

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

/** One person a campaign might go to, with what is known about them. */
export interface CampaignRecipient {
  /** +91XXXXXXXXXX */
  phone: string;
  /** Their name as stored, if they are a customer. */
  name?: string | null;
  /** Points earned on their most recent order — the Points Reminder's second slot. */
  points?: number | null;
  /** True when they have turned promotional messages off in their account. */
  optedOut?: boolean;
}

/** The coupon a Special Offer announces. */
export interface CampaignOffer {
  name: string;
  code: string;
}

export interface CampaignGroup {
  /** The exact text every number in this group receives. */
  message: string;
  numbers: string[];
  /** Credits for ONE copy of this message. */
  creditsEach: number;
}

export interface CampaignPlan {
  groups: CampaignGroup[];
  recipients: number;
  credits: number;
  skipped: { phone: string; why: string }[];
}

/**
 * Works out exactly what each recipient will receive, and what it costs.
 *
 * With a first name in the greeting (the Points Reminder), messages differ
 * from person to person, so a campaign cannot always be one text sent fifty
 * numbers at a time. Recipients are grouped by the message they get instead —
 * everyone called Rahul shares a batch — so batching still does the heavy
 * lifting. The Website Promotion and Special Offer are the same for everyone:
 * one group.
 *
 * Nobody who turned promotions off is included, however they came to be on the
 * list. That switch is in their account page and it has to mean something.
 */
export function planCampaign(
  template: CampaignTemplate,
  recipients: CampaignRecipient[],
  offer?: CampaignOffer
): CampaignPlan {
  const byMessage = new Map<string, CampaignGroup>();
  const skipped: { phone: string; why: string }[] = [];

  // The offer is the same for everyone, so a bad one fails the whole campaign
  // up front rather than every recipient separately.
  let offerMessage: string | null = null;
  if (template === "specialOffer") {
    if (!offer) throw new Error("Choose the coupon this offer announces.");
    offerMessage = fillTemplate("specialOffer", [offer.name, offer.code]);
  }

  for (const r of recipients) {
    if (r.optedOut) {
      skipped.push({ phone: r.phone, why: "turned promotional messages off" });
      continue;
    }

    let message: string;
    if (template === "specialOffer") {
      message = offerMessage!;
    } else if (template === "customerOffer") {
      // "You earned 0 points" is not a message anyone should get, and a number
      // that is not a customer has no points to report.
      if (!r.points || r.points <= 0) {
        skipped.push({ phone: r.phone, why: "has not earned any points" });
        continue;
      }
      message = fillTemplate("customerOffer", [firstName(r.name) ?? NAME_FALLBACK, String(r.points)]);
    } else {
      // No blanks in this one: the same text for everyone.
      message = fillTemplate("websitePromotion", []);
    }

    const g = byMessage.get(message) ?? { message, numbers: [], creditsEach: creditsFor(message) };
    g.numbers.push(r.phone);
    byMessage.set(message, g);
  }

  const groups = [...byMessage.values()];
  return {
    groups,
    recipients: groups.reduce((n, g) => n + g.numbers.length, 0),
    credits: groups.reduce((n, g) => n + g.numbers.length * g.creditsEach, 0),
    skipped,
  };
}

/** The template a campaign sends on — for the gateway and the audit log. */
export function campaignTemplate(template: CampaignTemplate) {
  return SMS_TEMPLATES[template];
}
