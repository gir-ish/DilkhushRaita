import { db } from "./db";
import { NAME_FALLBACK, SMS_TEMPLATES, fillTemplate, firstName } from "./sms-templates";
import { gatewayConfig, sendSms } from "./sms-gateway";
import { hhmm, withinTimeWindow } from "./utils";

/**
 * "Hi Rahul, you earned 120 Dilkhush Points on your order!" — sent by itself
 * after a big order, once the points are actually on the customer's account.
 *
 * That moment is when the order completes: a delivery handed over, a parcel
 * collected, a table billed. The owner switches it on or off and sets how big
 * "big" is (Marketing page).
 *
 * It uses a promotional template, so it follows the rules promotions do: not
 * to a customer who turned promotions off, and not outside 9am–9pm, when
 * operators refuse promotional SMS. Nothing is queued for the morning — an
 * order from last night is old news by then.
 */
export interface SmsSettingsView {
  pointsSmsEnabled: boolean;
  pointsSmsMinOrder: number;
}
export const DEFAULT_SMS_SETTINGS: SmsSettingsView = { pointsSmsEnabled: true, pointsSmsMinOrder: 1000 };

/** Promotional SMS hours in India (TRAI): 9am to 9pm. */
export const PROMO_WINDOW = { from: "09:00", to: "21:00" } as const;

export async function smsSettings(): Promise<SmsSettingsView> {
  const row = await db.smsSettings.findUnique({ where: { id: "singleton" } });
  return row ? { pointsSmsEnabled: row.pointsSmsEnabled, pointsSmsMinOrder: row.pointsSmsMinOrder } : DEFAULT_SMS_SETTINGS;
}

/**
 * Whether this order earns a points SMS, and exactly what it says. Decided
 * without a gateway or a database, so every rule can be tested.
 */
export function pointsSmsFor(
  settings: SmsSettingsView,
  o: {
    total: number;
    earned: number;
    name: string | null;
    phone: string | null;
    notifyPromos: boolean;
    nowHHmm: string;
  }
): { templateId: string; phone: string; message: string } | { skip: string } {
  if (!settings.pointsSmsEnabled) return { skip: "points SMS are switched off" };
  if (!(o.total > settings.pointsSmsMinOrder)) return { skip: `order is not above ₹${settings.pointsSmsMinOrder}` };
  if (!(o.earned > 0)) return { skip: "no points earned" };
  if (!o.phone) return { skip: "no phone number" };
  if (!o.notifyPromos) return { skip: "customer turned promotional messages off" };
  if (!withinTimeWindow(o.nowHHmm, PROMO_WINDOW.from, PROMO_WINDOW.to))
    return { skip: "outside promotional hours (9am–9pm)" };
  return {
    templateId: SMS_TEMPLATES.customerOffer.id,
    phone: o.phone,
    message: fillTemplate("customerOffer", [firstName(o.name) ?? NAME_FALLBACK, String(o.earned)]),
  };
}

/** Sends it, if it is due. Never throws: an SMS must not break completing an order. */
export async function sendPointsSms(orderId: string, earned: number): Promise<void> {
  try {
    const cfg = gatewayConfig();
    if (!cfg) return;
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        total: true,
        user: { select: { name: true, phone: true, profile: { select: { notifyPromos: true } } } },
      },
    });
    if (!order) return;
    const plan = pointsSmsFor(await smsSettings(), {
      total: order.total,
      earned,
      name: order.user?.name ?? null,
      phone: order.user?.phone ?? null,
      notifyPromos: order.user?.profile?.notifyPromos !== false,
      nowHHmm: hhmm(new Date()),
    });
    if ("skip" in plan) return;
    const r = await sendSms(cfg, plan.templateId, [plan.phone], plan.message, 15_000);
    if (!r.ok) console.error(`[sms][points] ${order.orderNumber}: ${r.detail ?? "send failed"}`);
  } catch (e) {
    console.error("[sms][points] could not send:", e);
  }
}
