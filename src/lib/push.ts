import webpush from "web-push";
import { db } from "./db";

/**
 * Waking a closed browser.
 *
 * The dashboard's chime needs a tab open, which is no use once the laptop is
 * shut and the owner is upstairs. A web push goes to the browser's push
 * service — Google's or Apple's — which wakes the service worker on the
 * device whether or not the site is open, and it shows the notification.
 *
 * Keys are VAPID: a public one the browser is subscribed with, and a private
 * one that proves the message came from us. Without them configured, every
 * function here does nothing rather than throwing, because an order must
 * never fail to be placed because a notification could not be sent.
 */

export interface PushMessage {
  title: string;
  body: string;
  /** Where clicking it should land. */
  url?: string;
  /** Collapses older notifications about the same thing. */
  tag?: string;
}

let configured: boolean | null = null;

function ready(): boolean {
  if (configured !== null) return configured;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    console.warn("[push] VAPID keys are not set — order alerts will not be sent");
    configured = false;
    return false;
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || "mailto:owner@dilkhushraita.com",
    publicKey,
    privateKey
  );
  configured = true;
  return true;
}

/** True when the server can send at all — the settings page asks before offering it. */
export function pushConfigured(): boolean {
  return ready();
}

/**
 * How many times a device may fail before it is dropped.
 *
 * A browser that has been reinstalled, or whose permission was revoked, keeps
 * its row until the push service says 404/410 — which it does promptly. This
 * is the belt to that braces: a device failing for any other reason three
 * times running is not coming back.
 */
const MAX_FAILURES = 3;

/**
 * Sends to every device belonging to these people.
 *
 * Never throws and never awaited by anything that takes money or an order:
 * the worst a broken push service may do is log.
 */
export async function pushToUsers(userIds: string[], message: PushMessage): Promise<number> {
  if (!ready() || userIds.length === 0) return 0;

  const subs = await db.pushSubscription.findMany({ where: { userId: { in: userIds } } });
  if (subs.length === 0) return 0;

  const payload = JSON.stringify(message);
  let sent = 0;

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          // Long enough to survive a phone that is asleep, short enough that a
          // stale "new order" never arrives the next morning.
          { TTL: 3600, urgency: "high" }
        );
        sent++;
        await db.pushSubscription.update({
          where: { id: sub.id },
          data: { lastSentAt: new Date(), failures: 0 },
        });
      } catch (e) {
        const status = (e as { statusCode?: number }).statusCode;
        // 404/410 is the push service saying this browser is gone for good.
        if (status === 404 || status === 410) {
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          return;
        }
        const failures = sub.failures + 1;
        if (failures >= MAX_FAILURES) {
          await db.pushSubscription.delete({ where: { id: sub.id } }).catch(() => {});
          return;
        }
        await db.pushSubscription
          .update({ where: { id: sub.id }, data: { failures } })
          .catch(() => {});
        // The message, not just the status: a TLS or DNS failure has no
        // status, and "?" on its own tells whoever reads the log nothing.
        console.error(
          `[push] ${status ?? "no status"} for ${sub.endpoint.slice(0, 40)}… — ${
            e instanceof Error ? e.message : String(e)
          }`
        );
      }
    })
  );

  return sent;
}

/** The roles that want to know a new order has landed. */
const ORDER_ROLES = ["OWNER", "BRANCH_MANAGER", "CASHIER", "KITCHEN"];

/**
 * Everyone who should hear about an order at this branch.
 *
 * A branch manager assigned to Rohini is not woken for an NSP order; an owner,
 * who is assigned to neither, hears about both.
 */
export async function staffForBranch(branchId: string): Promise<string[]> {
  const staff = await db.user.findMany({
    where: { role: { in: ORDER_ROLES }, blocked: false },
    select: { id: true, role: true, branchAssignments: { select: { branchId: true } } },
  });
  return staff
    .filter(
      (s) =>
        s.role === "OWNER" ||
        s.branchAssignments.length === 0 ||
        s.branchAssignments.some((a) => a.branchId === branchId)
    )
    .map((s) => s.id);
}

/**
 * A website order has landed and nobody has accepted it yet.
 *
 * Fire-and-forget on purpose: the customer's order is already saved, and a
 * push service having a bad minute must not turn that into an error on their
 * screen.
 */
export async function pushNewOrder(order: {
  id: string;
  orderNumber: string;
  branchId: string;
  total: number;
  type: string;
  customerName: string | null;
}): Promise<void> {
  if (!ready()) return;
  try {
    const kind =
      order.type === "DELIVERY" ? "Delivery" : order.type === "PICKUP" ? "Pickup" : "Dine-in";
    await pushToUsers(await staffForBranch(order.branchId), {
      title: `🛎️ New order ${order.orderNumber}`,
      body: `${kind} · ₹${order.total.toFixed(0)}${order.customerName ? ` · ${order.customerName}` : ""} — tap to accept`,
      url: "/admin/online",
      // One notification per order, however many times this is called.
      tag: `order-${order.id}`,
    });
  } catch (e) {
    console.error("[push] new order alert failed", e);
  }
}
