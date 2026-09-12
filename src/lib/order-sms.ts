import { db } from "./db";
import { NAME_FALLBACK, SMS_TEMPLATES, fillTemplate, firstName, type TemplateKey } from "./sms-templates";
import { gatewayConfig, sendSms } from "./sms-gateway";

/**
 * Order updates by SMS: confirmed, on the way, delivered.
 *
 * Switched off unless NOTIFY_SMS_ENABLED is "true". Every message costs a
 * credit, and turning them on is a decision about the SMS balance rather than a
 * side effect of deploying.
 *
 * These are transactional templates, so they reach numbers on the Do Not
 * Disturb register and do not consult the customer's promotions switch — an
 * update about an order they placed is not marketing.
 */

export type OrderEvent = "confirmed" | "dispatched" | "delivered";

const TEMPLATE_FOR: Record<OrderEvent, TemplateKey> = {
  confirmed: "orderConfirmed",
  dispatched: "orderDispatched",
  delivered: "orderDelivered",
};

export interface OrderForSms {
  orderNumber: string;
  type: string;
  userName: string | null;
  contactName: string | null;
  phone: string | null;
}

/**
 * What would be sent for this order and event, or why nothing would.
 *
 * Pure, so the decision can be tested without a database or a gateway.
 */
export function orderSmsFor(
  event: OrderEvent,
  order: OrderForSms
): { templateId: string; message: string; phone: string } | { skip: string } {
  if (!order.phone) return { skip: "no phone number on the order" };

  /*
   * Only orders that actually travel get told they are travelling.
   *
   * "On the way" can only be reached by a delivery order anyway. "Has been
   * delivered" is a statement about a rider, so a pickup or dine-in order does
   * not get it: the customer was standing at the counter when it happened.
   * Counter orders never reach "confirmed" by this route either — they are
   * written straight to ACCEPTED by the till, with the customer in front of it.
   */
  if (event !== "confirmed" && order.type !== "DELIVERY")
    return { skip: `not sent for ${order.type.toLowerCase()} orders` };

  const key = TEMPLATE_FOR[event];
  // The account holder's first name; if that is unusable, the name given for
  // the delivery; failing both, a greeting that is still a greeting.
  const name = firstName(order.userName) ?? firstName(order.contactName) ?? NAME_FALLBACK;
  const message = fillTemplate(key, [name, order.orderNumber]);
  return { templateId: SMS_TEMPLATES[key].id, message, phone: order.phone };
}

/**
 * Sends the update for an order that has just changed state.
 *
 * Never throws and never delays the change itself: it is called without being
 * awaited, after the database has already been updated, so a slow or failing
 * gateway cannot hold up the cashier's click or roll back the order.
 */
export async function sendOrderSms(orderId: string, event: OrderEvent): Promise<void> {
  if (process.env.NOTIFY_SMS_ENABLED !== "true") return;
  try {
    const cfg = gatewayConfig();
    if (!cfg) {
      console.error("[sms][order] STPL_SENDER_ID is not set — order messages are on but cannot send");
      return;
    }
    const order = await db.order.findUnique({
      where: { id: orderId },
      select: {
        orderNumber: true,
        type: true,
        contactName: true,
        user: { select: { name: true, phone: true } },
      },
    });
    if (!order) return;

    const plan = orderSmsFor(event, {
      orderNumber: order.orderNumber,
      type: order.type,
      userName: order.user?.name ?? null,
      contactName: order.contactName,
      phone: order.user?.phone ?? null,
    });
    if ("skip" in plan) return;

    // Shorter than a campaign's: one message, and nobody is waiting on it.
    const result = await sendSms(cfg, plan.templateId, [plan.phone], plan.message, 15_000);
    if (!result.ok)
      console.error(`[sms][order] ${event} for ${order.orderNumber} not sent: ${result.detail}`);
  } catch (e) {
    console.error(`[sms][order] ${event} for order ${orderId} failed:`, e);
  }
}
