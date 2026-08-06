import {
  MIN_POINTS_TO_REDEEM,
  POINTS_PER_10_RUPEES,
  POINT_VALUE_RUPEES,
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
  minPointsToRedeem: number;
}

export const DEFAULT_LOYALTY_RATES: LoyaltyRates = {
  pointsPer10Rupees: POINTS_PER_10_RUPEES,
  pointValueRupees: POINT_VALUE_RUPEES,
  minPointsToRedeem: MIN_POINTS_TO_REDEEM,
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
 * How many points can be applied to an order: requires a minimum balance,
 * and never redeems past the payable amount.
 */
export function redeemablePoints(
  balance: number,
  payable: number,
  rates: LoyaltyRates = DEFAULT_LOYALTY_RATES
) {
  if (balance < rates.minPointsToRedeem) return 0;
  const maxByAmount = Math.floor(payable / rates.pointValueRupees);
  return Math.min(balance, maxByAmount);
}
