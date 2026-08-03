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

export const OTP_EXPIRY_MINS = 5;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_COOLDOWN_SECS = 30;
export const OTP_MAX_PER_HOUR = 5;

export const ROAD_DISTANCE_FACTOR = 1.35; // straight-line → road estimate
export const AVG_DELIVERY_SPEED_KMPH = 22;
