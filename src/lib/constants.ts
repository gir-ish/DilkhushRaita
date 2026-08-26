// Pseudo-enum values shared between DB, API and UI.

export const ROLES = [
  "CUSTOMER",
  "OWNER",
  "BRANCH_MANAGER",
  "KITCHEN",
  "CASHIER",
  "DELIVERY_MANAGER",
  "DELIVERY_AGENT",
  "MARKETING",
] as const;
export type Role = (typeof ROLES)[number];

export const STAFF_ROLES: Role[] = [
  "OWNER",
  "BRANCH_MANAGER",
  "KITCHEN",
  "CASHIER",
  "DELIVERY_MANAGER",
  "MARKETING",
];

export const ORDER_STATUSES = [
  "PLACED",
  "ACCEPTED",
  "REJECTED",
  "PREPARING",
  "READY",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
  "DELIVERED",
  "CANCELLED",
  "REFUND_INITIATED",
  "REFUNDED",
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_TYPES = ["DELIVERY", "PICKUP", "DINE_IN"] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

export const ORDER_TYPE_LABELS: Record<string, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Self-pickup",
  DINE_IN: "Dine-in",
};

/** Statuses an order never leaves — nothing further is expected of anyone. */
export const TERMINAL_STATUSES: OrderStatus[] = [
  "DELIVERED",
  "REJECTED",
  "CANCELLED",
  "REFUND_INITIATED",
  "REFUNDED",
];

// Allowed status transitions (staff-driven).
export const STATUS_TRANSITIONS: Record<string, OrderStatus[]> = {
  PLACED: ["ACCEPTED", "REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["ASSIGNED", "OUT_FOR_DELIVERY", "DELIVERED"], // DELIVERED directly for pickup
  ASSIGNED: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  REJECTED: ["REFUND_INITIATED"],
  CANCELLED: ["REFUND_INITIATED"],
  REFUND_INITIATED: ["REFUNDED"],
};

/**
 * Statuses that close a dine-in tab.
 *
 * Deliberately excludes DELIVERED: food is served before the customer pays, so
 * a served tab is still open and still billable. Only payment — or the order
 * being cancelled/refunded — closes it.
 */
export const TAB_CLOSED_STATUSES: OrderStatus[] = [
  "REJECTED",
  "CANCELLED",
  "REFUND_INITIATED",
  "REFUNDED",
];

/** Only meaningful when something physically leaves the restaurant. */
export const DELIVERY_ONLY_STATUSES: OrderStatus[] = ["ASSIGNED", "OUT_FOR_DELIVERY"];

/**
 * Next statuses allowed from `status` for an order of `type`.
 *
 * A dine-in or pickup order is never assigned to a rider or sent out for
 * delivery, so those options are removed rather than offered and then
 * rejected. Used by the dashboard AND enforced server-side, so a crafted
 * request cannot push a dine-in order onto the delivery track.
 */
export function nextStatusesFor(status: string, orderType: string): OrderStatus[] {
  const all = STATUS_TRANSITIONS[status] ?? [];
  if (orderType === "DELIVERY") return all;
  return all.filter((s) => !DELIVERY_ONLY_STATUSES.includes(s));
}

export const STATUS_LABELS: Record<string, string> = {
  PLACED: "Order placed",
  ACCEPTED: "Accepted by restaurant",
  REJECTED: "Rejected",
  PREPARING: "Being prepared",
  READY: "Ready for pickup",
  ASSIGNED: "Delivery partner assigned",
  OUT_FOR_DELIVERY: "Out for delivery",
  DELIVERED: "Delivered",
  CANCELLED: "Cancelled",
  REFUND_INITIATED: "Refund initiated",
  REFUNDED: "Refunded",
};

export const ACTIVE_STATUSES = [
  "PLACED",
  "ACCEPTED",
  "PREPARING",
  "READY",
  "ASSIGNED",
  "OUT_FOR_DELIVERY",
];

export const REJECTION_REASONS = [
  "Item unavailable",
  "Location not serviceable",
  "Kitchen overloaded",
  "Restaurant closing",
  "Payment issue",
  "Incorrect address",
] as const;

export const TICKET_TYPES = [
  "MISSING_ITEM",
  "WRONG_ITEM",
  "LATE",
  "QUALITY",
  "PAYMENT",
  "COUPON",
  "PACKAGING",
  "OTHER",
] as const;

// Loyalty: 1 point per ₹10 spent (x tier multiplier); 100 points = ₹50.
export const POINTS_PER_10_RUPEES = 1;
export const POINT_VALUE_RUPEES = 0.5;
export const MIN_POINTS_TO_REDEEM = 100;

// Ten, because the DLT-approved SMS tells the customer ten. The template is the
// harder of the two to change, and a code that dies while the message still
// says it is good reads as a broken site.
export const OTP_EXPIRY_MINS = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECS = 30;
export const OTP_MAX_PER_HOUR = 5;

export const ROAD_DISTANCE_FACTOR = 1.35; // straight-line → road estimate
export const AVG_DELIVERY_SPEED_KMPH = 22;
