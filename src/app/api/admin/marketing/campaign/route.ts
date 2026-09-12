import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import { CAMPAIGN_TEMPLATES, SMS_TEMPLATES } from "@/lib/sms-templates";
import { gatewayConfig, sendSms } from "@/lib/sms-gateway";
import {
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
  /** Whatever was pasted or uploaded. Parsed and validated server-side. */
  recipients: z.string().max(200_000).default(""),
  /** "customers" builds the list from the shop's own customers instead. */
  source: z.enum(["paste", "customers"]).default("paste"),
  dryRun: z.boolean().default(true),
  /** What the dashboard showed before the operator pressed send. */
  expect: z.object({ count: z.number().int(), credits: z.number().int() }).optional(),
});

/** A hard ceiling per campaign, so one paste cannot empty the balance. */
const MAX_PER_CAMPAIGN = 5000;

/**
 * Points earned on each customer's most recent order that earned any — the
 * Points Reminder says "you earned N points on your order", so it has to be a
 * real figure from a real order, not a running balance.
 */
async function latestPointsFor(userIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (userIds.length === 0) return out;
  const orders = await db.order.findMany({
    where: { userId: { in: userIds }, pointsEarned: { gt: 0 } },
    orderBy: { placedAt: "desc" },
    select: { userId: true, pointsEarned: true },
  });
  for (const o of orders) if (!out.has(o.userId)) out.set(o.userId, o.pointsEarned);
  return out;
}

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
    profile: { select: { notifyPromos: true } },
  } as const;

  if (body.source === "customers") {
    const customers = await db.user.findMany({
      where: { role: "CUSTOMER", blocked: false, phone: { not: null } },
      select: customerSelect,
      take: MAX_PER_CAMPAIGN,
    });
    const points =
      body.template === "customerOffer" ? await latestPointsFor(customers.map((c) => c.id)) : null;
    recipients = customers.map((c) => ({
      phone: c.phone!,
      name: c.name,
      points: points?.get(c.id) ?? null,
      optedOut: c.profile?.notifyPromos === false,
    }));
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
    const points =
      body.template === "customerOffer" ? await latestPointsFor(known.map((u) => u.id)) : null;

    recipients = list.numbers.map((phone) => {
      const u = byPhone.get(phone);
      return {
        phone,
        name: u?.name ?? null,
        points: u ? points?.get(u.id) ?? null : null,
        optedOut: u?.profile?.notifyPromos === false,
      };
    });
  }

  let plan;
  try {
    plan = planCampaign(body.template, recipients, offer);
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

  for (const group of plan.groups) {
    for (const batch of batches(group.numbers)) {
      const result = await sendSms(cfg, template.id, batch, group.message);
      if (result.ok) {
        sent += batch.length;
        creditsSpent += batch.length * group.creditsEach;
      } else {
        failures.push(`${batch.length} number${batch.length === 1 ? "" : "s"}: ${result.detail}`);
      }
    }
  }

  await audit(
    { uid: session.uid, name: session.name },
    "MARKETING_CAMPAIGN_SENT",
    "Campaign",
    undefined,
    {
      template: body.template,
      templateId: template.id,
      recipients: plan.recipients,
      sent,
      credits: creditsSpent,
      skipped: plan.skipped.length,
      failedBatches: failures.length,
    }
  );

  return NextResponse.json({
    ok: failures.length === 0,
    sent,
    attempted: plan.recipients,
    creditsSpent,
    failures,
  });
});
