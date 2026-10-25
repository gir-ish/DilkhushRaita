import { db } from "./db";
import { audit } from "./audit";
import { pushToUsers, staffForBranch } from "./push";
import { onOrderDelivered } from "./order-effects";
import { istDayKeyOf, istDayStart } from "./expenses";
import { ORDER_TYPE_LABELS } from "./constants";

/**
 * The two things nobody is around to do.
 *
 * An order that lands while the counter is busy gets one alert, and if that
 * alert is missed the order simply sits there — the customer is waiting and
 * the shop does not know. And at the end of a night, orders that were made
 * and handed over are left open, because the last thing anyone does at
 * closing time is tap through a screen.
 *
 * Both are swept here, from the cron endpoint and opportunistically whenever
 * staff load the dashboard, so neither depends on a browser being open.
 */

/** How long after landing an unaccepted order is first chased. */
export const NAG_AFTER_MS = 60_000;
/** …and the gap between chases after that. */
export const NAG_EVERY_MS = 60_000;
/**
 * How many times, before it gives up.
 *
 * An hour of a phone buzzing once a minute is as much as a missed order can
 * fairly ask for. After that the order is still in the queue, still marked
 * unaccepted and still on the dashboard — it just stops shouting, because an
 * alarm nobody has silenced in an hour is an alarm nobody is hearing.
 */
export const MAX_NAGS = 60;

/**
 * The hour, Indian time, at which the previous day is closed off.
 *
 * Not midnight: a kitchen that runs past twelve would have the night's orders
 * swept out from under it mid-service. Ten in the morning is after the shop
 * has woken up and long before it is busy.
 */
export const SWEEP_HOUR = 10;

/** Statuses an order can still be moved on from. */
const OPEN_STATUSES = ["PLACED", "ACCEPTED", "PREPARING", "READY", "ASSIGNED", "OUT_FOR_DELIVERY"];

/** The system is the actor for both of these; no person pressed anything. */
const SYSTEM = { uid: "system", name: "Automatic" };

/* --------------------------------------------------------------- decisions */

/*
 * The rules, with nothing else attached.
 *
 * Everything below this comment decides; everything after it writes. Keeping
 * the two apart is what makes "is a Tuesday 2am order swept on Tuesday or on
 * Wednesday" a question that can be answered by a test rather than by seeding
 * a database and waiting.
 */

/** The hour of the day in India, whatever the server thinks the time is. */
export function istHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      hour12: false,
      timeZone: "Asia/Kolkata",
    }).format(now)
  );
}

/**
 * Midnight today, Indian time — everything placed before it is a previous
 * day's business. Null before the sweep hour, meaning nothing is due yet.
 */
export function staleCutoff(now: Date): Date | null {
  if (istHour(now) < SWEEP_HOUR) return null;
  return istDayStart(istDayKeyOf(now));
}

export type StaleVerdict = "complete" | "cancel" | "hold";

/**
 * What to do with an order still open from a previous day.
 *
 * `hold` is for the one case a machine should not touch: paid for, and never
 * accepted by anyone. Completing it books a sale for food nobody cooked;
 * cancelling it refunds a customer who may well have eaten. A person decides.
 */
export function decideStale(order: { status: string; paymentStatus: string }): StaleVerdict {
  if (order.status !== "PLACED") return "complete";
  return order.paymentStatus === "PAID" ? "hold" : "cancel";
}

/** Whether an unaccepted order is due to be chased again. */
export function nagDue(
  order: { placedAt: Date; nagCount: number; lastNaggedAt: Date | null },
  now: Date
): boolean {
  if (order.nagCount >= MAX_NAGS) return false;
  if (now.getTime() - order.placedAt.getTime() < NAG_AFTER_MS) return false;
  if (!order.lastNaggedAt) return true;
  return now.getTime() - order.lastNaggedAt.getTime() >= NAG_EVERY_MS;
}

/* ----------------------------------------------------------------- nagging */

export interface NagResult {
  /** Orders still waiting to be accepted. */
  waiting: number;
  /** …of those, how many were chased on this pass. */
  chased: number;
  /** …and how many have been chased as often as they ever will be. */
  exhausted: number;
}

/**
 * Chase every website order nobody has accepted yet.
 *
 * Only ONLINE orders: a counter order is placed by the person standing at the
 * till, who does not need telling about it.
 *
 * The push carries the same tag as the original alert, so it replaces that
 * alert rather than stacking — one order means one notification on the phone,
 * however many times it has been chased — while the service worker's
 * `renotify` makes each one buzz again.
 */
export async function nagUnacceptedOrders(now: Date = new Date()): Promise<NagResult> {
  const waiting = await db.order.findMany({
    where: {
      status: "PLACED",
      channel: "ONLINE",
      placedAt: { lte: new Date(now.getTime() - NAG_AFTER_MS) },
    },
    select: {
      id: true,
      orderNumber: true,
      branchId: true,
      total: true,
      type: true,
      placedAt: true,
      nagCount: true,
      lastNaggedAt: true,
      contactName: true,
      user: { select: { name: true } },
    },
    orderBy: { placedAt: "asc" },
  });

  let chased = 0;
  let exhausted = 0;

  for (const o of waiting) {
    if (o.nagCount >= MAX_NAGS) {
      exhausted++;
      continue;
    }
    // A sweep may run more often than once a minute — from the cron and from
    // a dashboard load in the same breath. The order decides when it is next
    // due, not the sweep.
    if (!nagDue(o, now)) continue;

    const mins = Math.max(1, Math.round((now.getTime() - o.placedAt.getTime()) / 60_000));
    const kind = ORDER_TYPE_LABELS[o.type] ?? o.type;
    const who = o.user?.name ?? o.contactName;

    await pushToUsers(await staffForBranch(o.branchId), {
      title: `⏰ Still not accepted — ${o.orderNumber}`,
      body: `Waiting ${mins} minute${mins === 1 ? "" : "s"} · ${kind} · ₹${o.total.toFixed(0)}${who ? ` · ${who}` : ""}`,
      url: "/admin/online",
      tag: `order-${o.id}`,
    });

    await db.order.update({
      where: { id: o.id },
      data: { lastNaggedAt: now, nagCount: { increment: 1 } },
    });
    chased++;
  }

  return { waiting: waiting.length, chased, exhausted };
}

/* ----------------------------------------------------------------- closing */

export interface SweepResult {
  /** False when it is not yet the hour to sweep. */
  ran: boolean;
  /** Orders finished off as delivered. */
  completed: number;
  /** Orders cancelled because nobody ever accepted them. */
  cancelled: number;
  /**
   * Orders left alone because money is involved and a person must decide.
   * Paid, and never accepted: closing it quietly would either keep the money
   * for food nobody cooked or refund it unasked, and neither is a machine's
   * call to make.
   */
  needsAttention: { id: string; orderNumber: string; total: number }[];
}

/**
 * Close off everything left open from a previous day.
 *
 * What it does depends on how far the order got, because the two cases are
 * nothing alike. An order that was accepted, cooked and handed over is only
 * open because nobody tapped the last button, so it is marked delivered and
 * settles exactly as it would have: COD takings recorded, loyalty points
 * awarded. An order still sitting at PLACED was never accepted by anyone and
 * never made, so calling it delivered would invent a sale that never happened
 * — it is cancelled instead.
 */
export async function closeStaleOrders(now: Date = new Date()): Promise<SweepResult> {
  const idle: SweepResult = { ran: false, completed: 0, cancelled: 0, needsAttention: [] };
  const today = staleCutoff(now);
  if (!today) return idle;

  const stale = await db.order.findMany({
    where: { status: { in: OPEN_STATUSES }, placedAt: { lt: today } },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      total: true,
      paymentStatus: true,
      placedAt: true,
    },
    orderBy: { placedAt: "asc" },
  });

  const result: SweepResult = { ran: true, completed: 0, cancelled: 0, needsAttention: [] };

  for (const o of stale) {
    const verdict = decideStale(o);

    if (verdict === "hold") {
      result.needsAttention.push({ id: o.id, orderNumber: o.orderNumber, total: o.total });
      continue;
    }

    if (verdict === "cancel") {
      await db.order.update({
        where: { id: o.id },
        data: { status: "CANCELLED", cancelledAt: now, autoClosedAt: now },
      });
      await audit(SYSTEM, "ORDER_AUTO_CANCELLED", "Order", o.id, {
        was: o.status,
        placedAt: o.placedAt,
        why: "Never accepted, and the day it was placed is over",
      });
      result.cancelled++;
      continue;
    }

    await db.order.update({
      where: { id: o.id },
      data: { status: "DELIVERED", deliveredAt: now, autoClosedAt: now },
    });
    // The same settling a person's tap would have done: COD marked paid,
    // points awarded, metrics moved on.
    await onOrderDelivered(o.id);
    await audit(SYSTEM, "ORDER_AUTO_DELIVERED", "Order", o.id, {
      was: o.status,
      placedAt: o.placedAt,
      why: "Left open past the end of the day it was placed",
    });
    result.completed++;
  }

  if (result.completed || result.cancelled || result.needsAttention.length)
    await audit(SYSTEM, "ORDERS_SWEPT", "Order", undefined, {
      completed: result.completed,
      cancelled: result.cancelled,
      needsAttention: result.needsAttention.length,
      before: today,
    });

  return result;
}

/* ------------------------------------------------------------ both at once */

/**
 * Run both, never throwing.
 *
 * Called from places that have something better to do — the cron endpoint and
 * the dashboard's own polling — so a failure here must stay here.
 */
export async function sweepOrders(now: Date = new Date()): Promise<{
  nag: NagResult | null;
  close: SweepResult | null;
}> {
  let nag: NagResult | null = null;
  let close: SweepResult | null = null;
  try {
    nag = await nagUnacceptedOrders(now);
  } catch (e) {
    console.error("[sweep] chasing unaccepted orders failed", e);
  }
  try {
    close = await closeStaleOrders(now);
  } catch (e) {
    console.error("[sweep] closing stale orders failed", e);
  }
  return { nag, close };
}

/* ------------------------------------------------------ opportunistic runs */

/**
 * At most one sweep a minute, however many dashboards are open.
 *
 * Four screens polling every ten seconds is twenty-four sweeps a minute, and
 * all but the first would find nothing to do and take a round trip to the
 * database to say so.
 */
let lastRun = 0;

export async function sweepIfDue(now: Date = new Date()): Promise<void> {
  if (now.getTime() - lastRun < NAG_EVERY_MS) return;
  lastRun = now.getTime();
  await sweepOrders(now);
}

/** Tests need each case to start from nothing. */
export function resetSweepThrottle(): void {
  lastRun = 0;
}
