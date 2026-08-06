import { db } from "./db";
import { DEFAULT_LOYALTY_RATES, type LoyaltyRates } from "./loyalty";

const SINGLETON = "singleton";

/**
 * Loyalty rates come from the database so the owner can reprice points without
 * a deploy — but they are read on every cart quote, so they are cached briefly
 * rather than fetched each time. A short TTL keeps a dashboard edit visible
 * almost immediately without hammering the database on a busy evening.
 */
const TTL_MS = 30_000;
let cache: { rates: LoyaltyRates; at: number } | null = null;

export function invalidateLoyaltyRates() {
  cache = null;
}

export async function loyaltyRates(): Promise<LoyaltyRates> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.rates;
  try {
    const row = await db.loyaltySettings.findUnique({ where: { id: SINGLETON } });
    const rates: LoyaltyRates = row
      ? {
          pointsPer10Rupees: row.pointsPer10Rupees,
          pointValueRupees: row.pointValueRupees,
          minPointsToRedeem: row.minPointsToRedeem,
        }
      : DEFAULT_LOYALTY_RATES;
    cache = { rates, at: Date.now() };
    return rates;
  } catch (e) {
    // Never let a settings read break checkout — fall back to the constants.
    console.error("[loyalty] could not read settings, using defaults:", e);
    return DEFAULT_LOYALTY_RATES;
  }
}

/** Reads the row for editing, creating it from the defaults on first use. */
export async function loyaltySettingsRow() {
  return db.loyaltySettings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: {
      id: SINGLETON,
      pointsPer10Rupees: DEFAULT_LOYALTY_RATES.pointsPer10Rupees,
      pointValueRupees: DEFAULT_LOYALTY_RATES.pointValueRupees,
      minPointsToRedeem: DEFAULT_LOYALTY_RATES.minPointsToRedeem,
    },
  });
}
