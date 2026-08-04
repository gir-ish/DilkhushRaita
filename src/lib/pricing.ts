import { round2 } from "./utils";

export interface PricedLine {
  unitPrice: number; // variant + add-ons included (server-derived)
  qty: number;
}

export interface FeeConfig {
  baseDeliveryFee: number;
  perKmFee: number;
  freeKm: number;
  freeDeliveryAbove?: number | null;
  packagingFee: number;
  taxPercent: number;
}

export function subtotalOf(lines: PricedLine[]) {
  return round2(lines.reduce((s, l) => s + l.unitPrice * l.qty, 0));
}

export function deliveryFeeFor(
  cfg: FeeConfig,
  distanceKm: number | null | undefined,
  subtotal: number,
  freeDelivery: boolean
): number {
  if (freeDelivery) return 0;
  if (cfg.freeDeliveryAbove != null && subtotal >= cfg.freeDeliveryAbove) return 0;
  const extraKm = Math.max(0, (distanceKm ?? 0) - cfg.freeKm);
  return round2(cfg.baseDeliveryFee + extraKm * cfg.perKmFee);
}

export interface TotalsInput {
  lines: PricedLine[];
  cfg: FeeConfig;
  // DINE_IN behaves like PICKUP for money: no delivery fee (see line below).
  orderType: "DELIVERY" | "PICKUP" | "DINE_IN";
  distanceKm?: number | null;
  discount?: number; // from coupon engine, already capped
  freeDelivery?: boolean; // coupon or loyalty benefit
  loyaltyCredit?: number; // ₹ value of redeemed points (capped by caller)
}

export interface Totals {
  subtotal: number;
  discount: number;
  deliveryFee: number;
  packagingFee: number;
  tax: number;
  loyaltyCredit: number;
  total: number;
}

/**
 * Single source of truth for order maths. Runs ONLY on the server.
 * Tax is charged on (subtotal - discount); loyalty credit applies last and
 * can never push the total below zero.
 */
export function computeTotals(input: TotalsInput): Totals {
  const subtotal = subtotalOf(input.lines);
  const discount = round2(Math.min(input.discount ?? 0, subtotal));
  const deliveryFee =
    input.orderType === "DELIVERY"
      ? deliveryFeeFor(input.cfg, input.distanceKm, subtotal, !!input.freeDelivery)
      : 0;
  const packagingFee = input.lines.length > 0 ? round2(input.cfg.packagingFee) : 0;
  const tax = round2(((subtotal - discount) * input.cfg.taxPercent) / 100);
  const preCredit = round2(subtotal - discount + deliveryFee + packagingFee + tax);
  const loyaltyCredit = round2(Math.min(input.loyaltyCredit ?? 0, preCredit));
  const total = round2(preCredit - loyaltyCredit);
  return { subtotal, discount, deliveryFee, packagingFee, tax, loyaltyCredit, total };
}
