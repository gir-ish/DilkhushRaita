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

export function pointsEarned(subtotal: number, multiplier = 1) {
  return Math.floor((subtotal / 10) * POINTS_PER_10_RUPEES * multiplier);
}

/** ₹ value of a points balance. */
export function pointsValue(points: number) {
  return points * POINT_VALUE_RUPEES;
}

/**
 * How many points can be applied to an order: requires a minimum balance,
 * and never redeems past the payable amount.
 */
export function redeemablePoints(balance: number, payable: number) {
  if (balance < MIN_POINTS_TO_REDEEM) return 0;
  const maxByAmount = Math.floor(payable / POINT_VALUE_RUPEES);
  return Math.min(balance, maxByAmount);
}
