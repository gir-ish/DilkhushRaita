/**
 * Every template the shop sends, and how to fill one in.
 *
 * These match the STPL panel's template list exactly (as it stood on
 * 14-Sep-2026): the gateway sends only what is added there, under the ID it is
 * added with.
 *
 * Each entry keeps three things together that must never drift apart: the
 * template ID the gateway is told, the DLT reference number, and the exact
 * approved wording. An Indian operator compares every message against the text
 * registered under that ID and drops anything that differs — after the credit
 * has been spent, and while the gateway still answers "submitted successfully".
 * Splitting the ID into an environment variable and the text into code is how a
 * pair ends up mismatched with nothing to show for it, so they live side by
 * side here, in version control, where a change to either shows up in a diff.
 *
 * DO NOT EDIT the wording to improve it. Change the template on the DLT portal,
 * get it approved, and then change the matching entry here character for
 * character.
 *
 * The OTP template is not here. It has its own path in src/lib/otp.ts and its
 * own configuration, and stays apart on purpose: it is the one message that
 * gates signing in.
 */

/**
 * How a {#var#} works.
 *
 * DLT registers a template with blanks in it. The operator checks the fixed
 * text around each blank exactly and lets the blank itself hold anything —
 * within limits: about thirty characters, plain text, no link. So the wording
 * is frozen and only the slots change per message. A slot left empty, or filled
 * with something the operator reads as part of the template, changes the fixed
 * text around it and gets the message dropped.
 */
const VAR = "{#var#}";

export type Category = "transactional" | "promotional";

export interface SmsTemplate {
  /** Short name used in the dashboard. */
  name: string;
  /** Sent to the gateway as templateid. */
  id: string;
  /** The DLT portal's reference for the registration. */
  reference: string;
  /**
   * Transactional messages reach numbers on the Do Not Disturb register.
   * Promotional ones do not, and must also respect a customer's own opt-out.
   */
  category: Category;
  /** The approved wording, with {#var#} where each slot sits. */
  text: string;
  /** What goes in each slot, in order — for the dashboard and for errors. */
  slots: string[];
}

export const SMS_TEMPLATES = {
  /**
   * "Order Confirmation Last" on the STPL panel (added 19-Sep-2026) — the
   * confirmation now sent. "Hi", and "Visit:" where the older ones said
   * "Track:". The panel shows no DLT reference.
   */
  orderConfirmed: {
    name: "Order Confirmation",
    id: "1777178980273698516",
    reference: "",
    category: "transactional",
    text: "Hi {#var#}, your order {#var#} is confirmed by Dilkhush Raita Wala Dhaba. We are preparing it fresh. Visit: https://dilkhushraita.com/",
    slots: ["first name", "order number"],
  },
  // "Order Dispatch One" on the STPL panel (added 19-Sep-2026): "Visit:" where
  // the older one said "Track:". No DLT reference on the panel.
  orderDispatched: {
    name: "Order Dispatch",
    id: "1777178980269575871",
    reference: "",
    category: "transactional",
    text: "Hello {#var#}, your order {#var#} is on the way from Dilkhush Raita Wala Dhaba. Get ready to enjoy! Visit: https://dilkhushraita.com/",
    slots: ["first name", "order number"],
  },
  // "Order Delivery One" on the STPL panel (added 19-Sep-2026): same wording,
  // new ID. No DLT reference on the panel.
  orderDelivered: {
    name: "Order Delivery",
    id: "1777178964812942753",
    reference: "",
    category: "transactional",
    text: "Hello {#var#}, your order {#var#} has been delivered. Thank you for choosing Dilkhush Raita Wala Dhaba. Visit: https://dilkhushraita.com/",
    slots: ["first name", "order number"],
  },
  // "Customer Offer One" on the STPL panel (added 19-Sep-2026): the same
  // wording under a new ID. Sent by the Points Reminder campaign, and by itself
  // after a big order (src/lib/points-sms.ts). No DLT reference on the panel.
  customerOffer: {
    name: "Points Reminder",
    id: "1777178964821207154",
    reference: "",
    category: "promotional",
    text: "Hi {#var#}, you earned {#var#} Dilkhush Points on your order! Use your points to save on your next order: https://dilkhushraita.com/",
    slots: ["first name", "points earned"],
  },
  // "Special Offer One" on the STPL panel (added 14-Sep-2026): the same
  // wording as before, under a new ID. The panel shows no DLT reference.
  specialOffer: {
    name: "Special Offer",
    id: "1777178980277440628",
    reference: "",
    category: "promotional",
    text: "{#var#} is live at Dilkhush Raita Wala Dhaba! Use coupon {#var#} to get a special discount. Order now: https://dilkhushraita.com/",
    slots: ["offer name", "coupon code"],
  },
  /**
   * "Website Promotion One" on the STPL panel (added 19-Sep-2026): greets each
   * customer by first name. The fixed text is 143 characters, so a first name
   * of up to 17 letters keeps it to one credit — see planCampaign, which uses
   * "Friend" rather than let a long name double the cost. The panel shows no
   * DLT reference.
   */
  websitePromotion: {
    name: "Website Promotion",
    id: "1777178980598948711",
    reference: "",
    category: "promotional",
    text: "Hi! {#var#}, craving real dhaba flavours? Dilkhush Raita Wala Dhaba is live! Explore our tasty menu & order fresh food now: https://dilkhushraita.com/",
    slots: ["first name"],
  },
} as const satisfies Record<string, SmsTemplate>;

export type TemplateKey = keyof typeof SMS_TEMPLATES;

/** The templates the Marketing page can send. Order messages are sent by the order flow. */
export const CAMPAIGN_TEMPLATES = ["websitePromotion", "specialOffer", "customerOffer"] as const;
export type CampaignTemplate = (typeof CAMPAIGN_TEMPLATES)[number];

/**
 * What a slot may hold before it is sent.
 *
 * Thirty characters is DLT's usual ceiling for one variable. Everything outside
 * plain printable ASCII is removed, because a single character outside the
 * GSM-7 alphabet pushes the whole message into UCS-2 — cutting the per-credit
 * allowance from 160 characters to 70 — and a coupon named "₹100 off" is exactly
 * such a character. The rupee sign is spelled out first rather than lost. Braces
 * go too: "{#var#}" inside a slot would look like part of the template.
 */
export const MAX_SLOT = 30;

export function cleanSlot(value: string, max = MAX_SLOT): string {
  return value
    .replace(/₹\s*/g, "Rs.")
    .replace(/[–—]/g, "-")
    .replace(/[’‘`]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7E]/g, "")
    .replace(/[{}[\]\\^~|<>]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

/**
 * The first name, and only the first name: "Rahul Kumar Sharma" is "Rahul".
 *
 * Cased so it reads like a greeting — "RAHUL" and "rahul" both become "Rahul" —
 * and held to twenty characters. That keeps the order and points templates in one
 * credit; the Website Promotion has room for seventeen, and its campaign falls
 * back to "Friend" for a longer one. A name with nothing usable in it (written
 * in Devanagari, say) returns null so the caller can fall back rather than
 * send "Hi! , craving…".
 */
export function firstName(name: string | null | undefined): string | null {
  const first = cleanSlot(name ?? "")
    .split(" ")[0]
    ?.replace(/[^A-Za-z'.-]/g, "");
  if (!first || !/[A-Za-z]/.test(first)) return null;
  const cased = first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
  return cased.slice(0, 20);
}

/**
 * Used only when there is no name to be had — a pasted number that is not a
 * customer, or a customer whose name is not in Latin script. "Customer" was the
 * old greeting and is exactly what this replaces.
 */
export const NAME_FALLBACK = "Friend";

/**
 * Fills a template's slots, in order.
 *
 * Refuses rather than guesses: the wrong number of values, or a value that is
 * empty once cleaned, would change the fixed text the operator checks, so the
 * message would be dropped after being paid for.
 */
export function fillTemplate(key: TemplateKey, values: string[]): string {
  const t: SmsTemplate = SMS_TEMPLATES[key];
  if (values.length !== t.slots.length)
    throw new Error(`${t.name} takes ${t.slots.length} value(s) (${t.slots.join(", ")}), got ${values.length}`);

  const cleaned = values.map((v, i) => {
    const c = cleanSlot(v);
    if (!c) throw new Error(`${t.name}: the ${t.slots[i]} is empty once cleaned`);
    return c;
  });

  let i = 0;
  const out = t.text.replace(/\{#var#\}/g, () => cleaned[i++]);
  // Belt and braces: nothing half-built may ever reach the gateway.
  if (out.includes(VAR)) throw new Error(`${t.name}: a slot was left unfilled`);
  return out;
}

/** 160 GSM-7 characters in one credit; past that, billed per 153. */
export function creditsFor(message: string): number {
  return message.length <= 160 ? 1 : Math.ceil(message.length / 153);
}
