import { db } from "./db";

/**
 * How much a customer may order on the website at once.
 *
 * A limit belongs on the website — a stranger tapping "+" two hundred times is
 * not an order anyone wants to cook — but it is the owner's number to set, so
 * it lives in the database rather than in this file.
 *
 * The counter is deliberately not held to it: staff are standing with the
 * customer, taking a party order for fifty rotis. COUNTER_LIMITS is what they
 * get instead — high enough to be out of the way, not so high that a mistyped
 * quantity becomes a five-figure bill.
 */
export interface OrderLimits {
  /** Most of any one dish in a single order. */
  maxQtyPerItem: number;
  /** Most different dishes in a single order. */
  maxItemsPerOrder: number;
}

export const DEFAULT_ORDER_LIMITS: OrderLimits = { maxQtyPerItem: 20, maxItemsPerOrder: 50 };
export const COUNTER_LIMITS: OrderLimits = { maxQtyPerItem: 999, maxItemsPerOrder: 200 };

/** What the owner may set it to — the ceiling the request bodies also allow. */
export const LIMIT_BOUNDS = { qty: { min: 1, max: 999 }, items: { min: 1, max: 200 } };

const SINGLETON = "singleton";
const TTL_MS = 30_000;
let cache: { limits: OrderLimits; at: number } | null = null;

export function invalidateOrderLimits() {
  cache = null;
}

/** Read on every cart quote, so it is cached briefly like the loyalty rates. */
export async function orderLimits(): Promise<OrderLimits> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.limits;
  try {
    const row = await db.orderSettings.findUnique({ where: { id: SINGLETON } });
    const limits: OrderLimits = row
      ? { maxQtyPerItem: row.maxQtyPerItem, maxItemsPerOrder: row.maxItemsPerOrder }
      : DEFAULT_ORDER_LIMITS;
    cache = { limits, at: Date.now() };
    return limits;
  } catch (e) {
    // A settings read must never be what stops someone ordering.
    console.error("[order-limits] could not read settings, using defaults:", e);
    return DEFAULT_ORDER_LIMITS;
  }
}

/** Reads the row for editing, creating it from the defaults on first use. */
export async function orderSettingsRow() {
  return db.orderSettings.upsert({
    where: { id: SINGLETON },
    update: {},
    create: { id: SINGLETON, ...DEFAULT_ORDER_LIMITS },
  });
}
