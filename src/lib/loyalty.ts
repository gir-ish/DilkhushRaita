import {
  MIN_POINTS_TO_REDEEM,
  POINTS_PER_10_RUPEES,
  POINT_VALUE_RUPEES,
  MAX_REDEEM_PER_ORDER,
  MAX_REDEEM_PERCENT,
} from "./constants";

export interface TierLike {
  id: string;
  name: string;
  minCompletedOrders: number;
  minLifetimeSpend: number;
  pointMultiplier: number;
  freeDelivery: boolean;
  discountPercent: number;
  sortOrder: number;
}

/** Highest tier whose thresholds the customer meets. */
export function tierFor<T extends TierLike>(
  tiers: T[],
  metrics: { completedOrders: number; lifetimeSpend: number }
): T | null {
  const sorted = [...tiers].sort((a, b) => b.sortOrder - a.sortOrder);
  return (
    sorted.find(
      (t) =>
        metrics.completedOrders >= t.minCompletedOrders &&
        metrics.lifetimeSpend >= t.minLifetimeSpend
    ) ?? null
  );
}

/**
 * What a point is worth, and how fast it is earned.
 *
 * Owned by the LoyaltySettings row rather than the code, so the scheme can be
 * repriced from the dashboard. The constants remain the defaults: they are what
 * a fresh install starts on, and the fallback if the row cannot be read.
 */
export interface LoyaltyRates {
  pointsPer10Rupees: number;
  pointValueRupees: number;
  /** The least a customer may hold before points can be spent at all. */
  minPointsToRedeem: number;
  /** The most that may go into one order, in points. 0 = no ceiling. */
  maxRedeemPerOrder: number;
  /** …and as a percentage of that order. 0 = no ceiling. */
  maxRedeemPercent: number;
}

export const DEFAULT_LOYALTY_RATES: LoyaltyRates = {
  pointsPer10Rupees: POINTS_PER_10_RUPEES,
  pointValueRupees: POINT_VALUE_RUPEES,
  minPointsToRedeem: MIN_POINTS_TO_REDEEM,
  maxRedeemPerOrder: MAX_REDEEM_PER_ORDER,
  maxRedeemPercent: MAX_REDEEM_PERCENT,
};

export function pointsEarned(
  subtotal: number,
  multiplier = 1,
  rates: LoyaltyRates = DEFAULT_LOYALTY_RATES
) {
  return Math.floor((subtotal / 10) * rates.pointsPer10Rupees * multiplier);
}

/** ₹ value of a points balance. */
export function pointsValue(points: number, rates: LoyaltyRates = DEFAULT_LOYALTY_RATES) {
  return points * rates.pointValueRupees;
}

/**
 * How many points go into one order.
 *
 * Four limits, and the tightest of them wins:
 *  - the balance: nobody spends points they do not hold;
 *  - the bill: points never pay more than is owed, and never make change;
 *  - a ceiling in points, if the owner set one;
 *  - a ceiling as a share of the bill, if the owner set one.
 *
 * The last two are what stop a long-standing customer clearing an entire
 * bill in one go. Both default to 0, meaning no ceiling, which is how this
 * behaved before either existed.
 */
export function redeemablePoints(
  balance: number,
  payable: number,
  rates: LoyaltyRates = DEFAULT_LOYALTY_RATES
) {
  if (balance < rates.minPointsToRedeem) return 0;

  const limits = [balance, Math.floor(payable / rates.pointValueRupees)];
  if (rates.maxRedeemPerOrder > 0) limits.push(rates.maxRedeemPerOrder);
  if (rates.maxRedeemPercent > 0)
    limits.push(
      Math.floor((payable * rates.maxRedeemPercent) / 100 / rates.pointValueRupees)
    );

  return Math.max(Math.min(...limits), 0);
}
