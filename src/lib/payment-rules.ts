import { db } from "./db";
import { withinTimeWindow } from "./utils";

/**
 * Which ways a customer may pay on the website — the owner's call, not a
 * deploy's.
 *
 * Cash can be switched off altogether, capped above a cart total ("anything
 * over ₹2,000 is prepaid"), or offered only during certain hours ("after nine
 * at night, online only"). Online can be switched off too, for the evening the
 * payment gateway is misbehaving.
 *
 * None of it touches the counter: staff take whatever is handed to them.
 */
export interface PaymentRules {
  codEnabled: boolean;
  onlineEnabled: boolean;
  /** Above this cart total, cash is not offered. Null = no ceiling. */
  codMaxOrderValue: number | null;
  /** Cash is offered only inside this daily window (IST). Null = all day. */
  codFrom: string | null;
  codTo: string | null;
}

export const DEFAULT_PAYMENT_RULES: PaymentRules = {
  codEnabled: true,
  onlineEnabled: true,
  codMaxOrderValue: null,
  codFrom: null,
  codTo: null,
};

export interface PaymentOption {
  allowed: boolean;
  /** Shown to the customer when it is not — so they know what to do instead. */
  reason?: string;
}

export interface PaymentOptions {
  cod: PaymentOption;
  online: PaymentOption;
}

const rupees = (n: number) => "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 2 });

/**
 * What this customer may choose for this cart, right now.
 *
 * Worked out in one place so the checkout screen and the order it posts can
 * never disagree — the screen greys an option out with the reason, and the
 * same function refuses it server-side if someone posts it anyway.
 */
export function paymentOptions(
  rules: PaymentRules,
  ctx: {
    /** What the customer would pay. */
    total: number;
    /** "HH:mm" in IST. */
    nowHHmm: string;
    /** Whether a gateway is configured at all (PAYMENT_PROVIDER). */
    onlineConfigured: boolean;
    /** This customer is prepaid-only after abusing cash on delivery. */
    codBlockedForCustomer?: boolean;
  }
): PaymentOptions {
  const cod: PaymentOption = { allowed: true };
  if (!rules.codEnabled) {
    cod.allowed = false;
    cod.reason = "Cash is not being accepted right now";
  } else if (ctx.codBlockedForCustomer) {
    cod.allowed = false;
    cod.reason = "This account is set to online payment only";
  } else if (rules.codMaxOrderValue != null && ctx.total > rules.codMaxOrderValue) {
    cod.allowed = false;
    cod.reason = `Orders above ${rupees(rules.codMaxOrderValue)} must be paid online`;
  } else if (!withinTimeWindow(ctx.nowHHmm, rules.codFrom, rules.codTo)) {
    cod.allowed = false;
    cod.reason = `Cash is accepted ${rules.codFrom}–${rules.codTo} only`;
  }

  const online: PaymentOption = { allowed: true };
  if (!ctx.onlineConfigured) {
    online.allowed = false;
    online.reason = "Online payment is not set up yet";
  } else if (!rules.onlineEnabled) {
    online.allowed = false;
    online.reason = "Online payment is switched off right now";
  }

  return { cod, online };
}

const SINGLETON = "singleton";
const TTL_MS = 30_000;
let cache: { rules: PaymentRules; at: number } | null = null;

export function invalidatePaymentRules() {
  cache = null;
}

/** Read on every quote, so it is cached briefly like the other shop settings. */
export async function paymentRules(): Promise<PaymentRules> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rules;
  try {
    const row = await db.paymentSettings.findUnique({ where: { id: SINGLETON } });
    const rules: PaymentRules = row
      ? {
          codEnabled: row.codEnabled,
          onlineEnabled: row.onlineEnabled,
          codMaxOrderValue: row.codMaxOrderValue,
          codFrom: row.codFrom,
          codTo: row.codTo,
        }
      : DEFAULT_PAYMENT_RULES;
    cache = { rules, at: Date.now() };
    return rules;
  } catch (e) {
    // Never let a settings read stop someone paying.
    console.error("[payment-rules] could not read settings, using defaults:", e);
    return DEFAULT_PAYMENT_RULES;
  }
}

/** Reads the row for editing, creating it from the defaults on first use. */
export async function paymentSettingsRow() {
  return db.paymentSettings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON, codEnabled: true, onlineEnabled: true },
  });
}
