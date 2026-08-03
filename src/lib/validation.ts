import { z } from "zod";

export const VariantSchema = z.object({
  name: z.string().min(1).max(40),
  priceDelta: z.number(),
  isDefault: z.boolean().default(false),
});

export const AddOnSchema = z.object({
  name: z.string().min(1).max(60),
  price: z.number().min(0),
  veg: z.boolean().default(true),
  required: z.boolean().default(false),
});

export const ItemBody = z.object({
  categoryId: z.string(),
  name: z.string().min(1).max(80),
  nameHindi: z.string().max(80).nullish(),
  description: z.string().max(500).default(""),
  imageEmoji: z.string().max(8).default("🍛"),
  // Either an uploaded photo (/api/menu-images/<file>) or an external URL.
  // A bare z.string().url() would reject our own relative paths.
  imageUrl: z
    .string()
    .max(500)
    .refine(
      (v) => v.startsWith("/api/menu-images/") || /^https?:\/\//.test(v),
      "Must be an uploaded photo or an http(s) URL"
    )
    .nullish(),
  basePrice: z.number().min(0),
  veg: z.boolean().default(true),
  vegan: z.boolean().default(false),
  spicy: z.boolean().default(false),
  bestseller: z.boolean().default(false),
  recommended: z.boolean().default(false),
  prepTimeMins: z.number().int().min(1).max(120).default(20),
  ingredients: z.string().max(500).default(""),
  allergens: z.string().max(300).default(""),
  active: z.boolean().default(true),
  displayOrder: z.number().int().default(0),
  variants: z.array(VariantSchema).max(6).default([]),
  addOns: z.array(AddOnSchema).max(12).default([]),
});

export const BranchPatch = z.object({
  name: z.string().min(1).max(80).optional(),
  address: z.string().min(3).max(300).optional(),
  pincode: z.string().regex(/^\d{6}$/).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  phone: z.string().min(8).max(16).optional(),
  email: z.string().email().nullish(),
  isOpenOverride: z.enum(["AUTO", "FORCE_OPEN", "FORCE_CLOSED"]).optional(),
  onlineOrderingEnabled: z.boolean().optional(),
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  deliveryRadiusKm: z.number().min(0.5).max(50).optional(),
  serviceablePincodes: z.array(z.string().regex(/^\d{6}$/)).max(100).optional(),
  minOrderValue: z.number().min(0).optional(),
  baseDeliveryFee: z.number().min(0).optional(),
  perKmFee: z.number().min(0).optional(),
  freeKm: z.number().min(0).optional(),
  freeDeliveryAbove: z.number().min(0).nullish(),
  packagingFee: z.number().min(0).optional(),
  taxPercent: z.number().min(0).max(30).optional(),
  prepTimeMins: z.number().int().min(5).max(120).optional(),
  busyMode: z.boolean().optional(),
  busyExtraMins: z.number().int().min(0).max(90).optional(),
  busyPauseDelivery: z.boolean().optional(),
  busyPauseScheduled: z.boolean().optional(),
  maxActiveOrders: z.number().int().min(1).max(500).optional(),
  hours: z
    .array(
      z.object({
        dayOfWeek: z.number().int().min(0).max(6),
        openTime: z.string().regex(/^\d{2}:\d{2}$/),
        closeTime: z.string().regex(/^\d{2}:\d{2}$/),
        closed: z.boolean().default(false),
      })
    )
    .optional(),
});

export const CouponBody = z.object({
  code: z.string().min(3).max(20).regex(/^[A-Z0-9]+$/i, "Letters and numbers only"),
  name: z.string().min(2).max(80),
  description: z.string().max(300).default(""),
  rewardType: z.enum(["PERCENT", "FLAT", "FREE_DELIVERY", "FREE_ITEM"]),
  value: z.number().min(0).default(0),
  maxDiscount: z.number().min(0).nullish(),
  freeItemId: z.string().nullish(),
  minCartValue: z.number().min(0).nullish(),
  maxCartValue: z.number().min(0).nullish(),
  branchId: z.string().nullish(),
  orderTypes: z.array(z.enum(["DELIVERY", "PICKUP"])).default(["DELIVERY", "PICKUP"]),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).default([]),
  startTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  endTime: z.string().regex(/^\d{2}:\d{2}$/).nullish(),
  startAt: z.string().nullish(),
  endAt: z.string().nullish(),
  firstOrderOnly: z.boolean().default(false),
  minCompletedOrders: z.number().int().min(0).nullish(),
  minLifetimeSpend: z.number().min(0).nullish(),
  loyaltyTierId: z.string().nullish(),
  inactiveDays: z.number().int().min(1).nullish(),
  paymentMethod: z.enum(["COD", "ONLINE"]).nullish(),
  totalLimit: z.number().int().min(1).nullish(),
  perCustomerLimit: z.number().int().min(1).default(1),
  autoApply: z.boolean().default(false),
  stackable: z.boolean().default(false),
  priority: z.number().int().default(0),
  active: z.boolean().default(true),
});

export function couponToDb(body: z.infer<typeof CouponBody>) {
  const { orderTypes, daysOfWeek, startAt, endAt, code, ...rest } = body;
  return {
    ...rest,
    code: code.toUpperCase(),
    orderTypesJson: JSON.stringify(orderTypes),
    daysOfWeekJson: JSON.stringify(daysOfWeek),
    startAt: startAt ? new Date(startAt) : null,
    endAt: endAt ? new Date(endAt) : null,
  };
}
