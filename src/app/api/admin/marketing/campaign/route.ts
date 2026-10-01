import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { CAMPAIGN_TEMPLATES, SMS_TEMPLATES } from "@/lib/sms-templates";
import { gatewayConfig, sendSms } from "@/lib/sms-gateway";
import { hhmm, withinTimeWindow } from "@/lib/utils";
import {
  PROMO_WINDOW,
  batches,
  parseRecipients,
  planCampaign,
  type CampaignOffer,
  type CampaignRecipient,
} from "@/lib/promo-sms";

/**
 * Campaigns from the Marketing page: Website Promotion, Special Offer, Points
 * Reminder.
 *
 * The only endpoint here that spends money per request, so it is deliberately
 * awkward to fire by accident: marketing or owner only, a dry run that costs
 * nothing, and a live send that refuses unless the caller repeats back exactly
 * how many messages and credits they were shown. A list edited or grown since
 * the preview does not quietly go out at a different price.
 */

const Body = z.object({
  template: z.enum(CAMPAIGN_TEMPLATES),
  /** The coupon a Special Offer announces. */
  couponId: z.string().optional(),
  /** Points Reminder: only customers holding at least this many points. */
  minPoints: z.number().int().min(1).max(10_000_000).default(1),
  /** Whatever was pasted or uploaded. Parsed and validated server-side. */
  recipients: z.string().max(200_000).default(""),
  /**
   * Where the list comes from: pasted in, the shop's own customers, or the
   * contact book built from uploaded phone-book exports.
   */
  source: z.enum(["paste", "customers", "contacts", "both"]).default("paste"),
  /** Contact book: only numbers that arrived in this upload. */
  listId: z.string().optional(),
  dryRun: z.boolean().default(true),
  /** What the dashboard showed before the operator pressed send. */
  expect: z.object({ count: z.number().int(), credits: z.number().int() }).optional(),
});

/** A hard ceiling per campaign, so one paste cannot empty the balance. */
const MAX_PER_CAMPAIGN = 5000;

export const POST = handler(async (req: Request) => {
  const session = await requireStaff("MARKETING");
  const body = Body.parse(await req.json());
  const template = SMS_TEMPLATES[body.template];

  const cfg = gatewayConfig();
  if (!cfg) throw new HttpError(503, "SMS is not configured: STPL_SENDER_ID is not set.");

  // ---------------------------------------------------------------- the offer
  let offer: CampaignOffer | undefined;
  if (body.template === "specialOffer") {
    if (!body.couponId) throw new HttpError(400, "Choose the coupon this offer announces.");
    const coupon = await db.coupon.findUnique({
      where: { id: body.couponId },
      select: { name: true, code: true, active: true },
    });
    if (!coupon) throw new HttpError(404, "That coupon no longer exists.");
    // Announcing a code that is switched off sends people to a checkout that
    // turns them away.
    if (!coupon.active) throw new HttpError(400, `Coupon ${coupon.code} is not active. Switch it on first.`);
    offer = { name: coupon.name, code: coupon.code };
  }

  // ----------------------------------------------------------- the recipients
  let rejected: { raw: string; why: string }[] = [];
  let duplicates = 0;
  let recipients: CampaignRecipient[];

  const customerSelect = {
    id: true,
    name: true,
    phone: true,
    // The Points Reminder tells each customer the points they hold now.
    profile: { select: { notifyPromos: true, loyaltyPoints: true } },
  } as const;

  if (body.source === "customers" || body.source === "contacts" || body.source === "both") {
    /*
     * One list, keyed by number, so somebody who is both a customer and a
     * line in the phone book is texted once and paid for once.
     *
     * Customers go in first and are never overwritten: their account carries
     * the name they chose for themselves, the points they hold, and the
     * opt-out they set \u2014 all of which beat whatever an exported phone book
     * had for the same number.
     */
    const wantCustomers = body.source === "customers" || body.source === "both";
    const wantContacts = body.source === "contacts" || body.source === "both";
    const byPhone = new Map<string, CampaignRecipient>();

    if (wantCustomers) {
      const customers = await db.user.findMany({
        where: { role: "CUSTOMER", blocked: false, phone: { not: null } },
        select: customerSelect,
        take: MAX_PER_CAMPAIGN,
      });
      for (const c of customers)
        byPhone.set(c.phone!, {
          phone: c.phone!,
          name: c.name,
          points: c.profile?.loyaltyPoints ?? null,
          optedOut: c.profile?.notifyPromos === false,
        });
    }

    if (wantContacts) {
      /*
       * Every number here was validated when it was uploaded, so nothing is
       * re-checked and nothing is thrown away at send time. A contact who
       * asked not to be texted is already excluded by the query; a customer
       * opt-out on the same number is applied below, because the person is
       * the same person however their number reached the list.
       */
      const contacts = await db.contact.findMany({
        where: { optedOut: false, ...(body.listId ? { listId: body.listId } : {}) },
        orderBy: { createdAt: "asc" },
        take: MAX_PER_CAMPAIGN,
        select: { phone: true, name: true },
      });
      const fresh = contacts.filter((c) => !byPhone.has(c.phone));
      // Only the ones not already in hand need looking up.
      const known = await db.user.findMany({
        where: { phone: { in: fresh.map((c) => c.phone) }, role: "CUSTOMER" },
        select: customerSelect,
      });
      const users = new Map(known.map((u) => [u.phone!, u]));
      for (const c of fresh) {
        if (byPhone.size >= MAX_PER_CAMPAIGN) break;
        const u = users.get(c.phone);
        byPhone.set(c.phone, {
          phone: c.phone,
          name: u?.name ?? c.name,
          points: u?.profile?.loyaltyPoints ?? null,
          optedOut: u?.profile?.notifyPromos === false,
        });
      }
    }

    recipients = [...byPhone.values()];
  } else {
    const list = parseRecipients(body.recipients, MAX_PER_CAMPAIGN);
    rejected = list.rejected;
    duplicates = list.duplicates;

    // Numbers that belong to customers get their real name — and their
    // opt-out, which applies however their number arrived on the list.
    const known = await db.user.findMany({
      where: { phone: { in: list.numbers }, role: "CUSTOMER" },
      select: customerSelect,
    });
    const byPhone = new Map(known.map((u) => [u.phone!, u]));

    recipients = list.numbers.map((phone) => {
      const u = byPhone.get(phone);
      return {
        phone,
        name: u?.name ?? null,
        points: u?.profile?.loyaltyPoints ?? null,
        optedOut: u?.profile?.notifyPromos === false,
      };
    });
  }

  let plan;
  try {
    plan = planCampaign(body.template, recipients, offer, body.minPoints);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : "Could not build the campaign.");
  }

  const summary = {
    template: { key: body.template, name: template.name, id: template.id },
    // A few of the actual messages, so the operator sees names going in rather
    // than taking it on trust.
    samples: plan.groups.slice(0, 3).map((g) => ({
      message: g.message,
      recipients: g.numbers.length,
      creditsEach: g.creditsEach,
    })),
    distinctMessages: plan.groups.length,
    recipients: plan.recipients,
    credits: plan.credits,
    skipped: plan.skipped.slice(0, 50),
    skippedCount: plan.skipped.length,
    duplicatesRemoved: duplicates,
    rejected: rejected.slice(0, 50),
    rejectedCount: rejected.length,
  };

  // A dry run answers "who gets what, and what does it cost", and touches nothing.
  if (body.dryRun) return NextResponse.json({ ok: true, dryRun: true, ...summary });

  if (plan.recipients === 0) throw new HttpError(400, "Nobody to send to.");

  /*
   * The operator will not carry promotional traffic outside its window, so a
   * campaign sent at ten in the evening is credits spent on messages nobody
   * receives. Checked here rather than in the browser: the clock that matters
   * is India's, not the one on the laptop sending it — which on this project
   * has been in Korea.
   */
  const now = hhmm(new Date(), "Asia/Kolkata");
  if (!withinTimeWindow(now, PROMO_WINDOW.from, PROMO_WINDOW.to))
    throw new HttpError(
      400,
      `It is ${now} in India. Promotional messages are only delivered between ` +
        `${PROMO_WINDOW.from} and ${PROMO_WINDOW.to}, so this would be paid for and dropped. ` +
        `Preview it now and send it inside those hours.`
    );

  /*
   * The list must be the one the operator approved. Between previewing and
   * sending, a paste can be edited or the customer table can grow; refusing a
   * mismatch means the figure they saw is the figure they pay.
   */
  if (!body.expect) throw new HttpError(400, "Preview the campaign before sending it.");
  if (body.expect.count !== plan.recipients || body.expect.credits !== plan.credits)
    throw new HttpError(
      409,
      `The list changed since you previewed it — it is now ${plan.recipients} people and ` +
        `${plan.credits} credits. Preview again and check before sending.`
    );

  // A double-clicked button is the most likely way this gets sent twice.
  if (!rateLimit("marketing:campaign", 1, 60 * 1000))
    throw new HttpError(429, "A campaign was just sent. Wait a minute before sending another.");

  let sent = 0;
  let creditsSpent = 0;
  const failures: string[] = [];
  /*
   * The gateway's id for each submission, kept because it is the only way to
   * find out afterwards what actually happened. The API never reports
   * delivery — only the panel's Delivery Report does, and it is searched by
   * this id. A campaign nobody received is otherwise impossible to trace.
   */
  const messageIds: string[] = [];

  for (const group of plan.groups) {
    for (const batch of batches(group.numbers)) {
      const result = await sendSms(cfg, template.id, batch, group.message);
      if (result.ok) {
        sent += batch.length;
        creditsSpent += batch.length * group.creditsEach;
        if (result.messageId) messageIds.push(result.messageId);
      } else {
        failures.push(`${batch.length} number${batch.length === 1 ? "" : "s"}: ${result.detail}`);
      }
    }
  }

  if (body.source === "contacts" && sent > 0)
    await db.contact.updateMany({
      where: { phone: { in: plan.groups.flatMap((g) => g.numbers) } },
      data: { lastSentAt: new Date() },
    });

  await audit(
    { uid: session.uid, name: session.name },
    "MARKETING_CAMPAIGN_SENT",
    "Campaign",
    undefined,
    {
      template: body.template,
      templateId: template.id,
      source: body.source,
      recipients: plan.recipients,
      sent,
      credits: creditsSpent,
      skipped: plan.skipped.length,
      failedBatches: failures.length,
      messageIds: messageIds.slice(0, 50),
    }
  );

  return NextResponse.json({
    ok: failures.length === 0,
    sent,
    attempted: plan.recipients,
    creditsSpent,
    failures,
    messageIds,
  });
});
