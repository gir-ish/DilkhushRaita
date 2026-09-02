import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import {
  BATCH_SIZE,
  PROMO_MESSAGE,
  batches,
  creditsFor,
  parseRecipients,
  promoConfig,
  sendPromoBatch,
} from "@/lib/promo-sms";

/**
 * The promotional campaign, sent from the Marketing page.
 *
 * The only endpoint here that spends money per request, so it is deliberately
 * awkward to fire by accident: marketing or owner only, a dry run that costs
 * nothing, and a live send that refuses unless the caller repeats back exactly
 * how many messages and credits they were shown. A list edited or grown since
 * the preview does not quietly go out at a different price.
 */

const Body = z.object({
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

export const POST = handler(async (req: Request) => {
  const session = await requireStaff("MARKETING");
  const body = Body.parse(await req.json());

  const cfg = promoConfig();
  if (!cfg)
    throw new HttpError(
      503,
      "SMS is not configured. STPL_SENDER_ID and STPL_PROMO_TEMPLATE_ID must both be set."
    );

  // Fixed, approved, and in version control — there is nothing to build and
  // nothing that can arrive half-substituted.
  const message = PROMO_MESSAGE;

  let raw = body.recipients;
  if (body.source === "customers") {
    // The shop's own customers: the numbers with the clearest claim to consent,
    // because they were given in order to place an order.
    const customers = await db.user.findMany({
      where: { role: "CUSTOMER", blocked: false, phone: { not: null } },
      select: { phone: true },
      take: MAX_PER_CAMPAIGN,
    });
    raw = customers.map((c) => c.phone).join(",");
  }

  const list = parseRecipients(raw, MAX_PER_CAMPAIGN);
  const perMessage = creditsFor(message);
  const credits = list.numbers.length * perMessage;

  const summary = {
    message,
    length: message.length,
    creditsPerMessage: perMessage,
    recipients: list.numbers.length,
    credits,
    duplicatesRemoved: list.duplicates,
    rejected: list.rejected.slice(0, 50),
    rejectedCount: list.rejected.length,
    batches: Math.ceil(list.numbers.length / BATCH_SIZE),
  };

  // A dry run answers "what would this cost" and touches nothing.
  if (body.dryRun) return NextResponse.json({ ok: true, dryRun: true, ...summary });

  if (list.numbers.length === 0) throw new HttpError(400, "No valid numbers to send to.");

  /*
   * The list must be the one the operator approved. Between previewing and
   * sending, a paste can be edited or the customer table can grow; refusing a
   * mismatch means the figure they saw is the figure they pay.
   */
  if (!body.expect) throw new HttpError(400, "Preview the campaign before sending it.");
  if (body.expect.count !== list.numbers.length || body.expect.credits !== credits)
    throw new HttpError(
      409,
      `The list changed since you previewed it — it is now ${list.numbers.length} numbers ` +
        `and ${credits} credits. Preview again and check before sending.`
    );

  // A double-clicked button is the most likely way this gets sent twice.
  if (!rateLimit("marketing:campaign", 1, 60 * 1000))
    throw new HttpError(429, "A campaign was just sent. Wait a minute before sending another.");

  let sent = 0;
  const failures: string[] = [];

  for (const group of batches(list.numbers)) {
    const result = await sendPromoBatch(cfg, group, message);
    if (result.ok) sent += group.length;
    else failures.push(`${group.length} number${group.length === 1 ? "" : "s"}: ${result.detail}`);
  }

  await audit(
    { uid: session.uid, name: session.name },
    "MARKETING_CAMPAIGN_SENT",
    "Campaign",
    undefined,
    { recipients: list.numbers.length, sent, credits: sent * perMessage, failedBatches: failures.length }
  );

  return NextResponse.json({
    ok: failures.length === 0,
    sent,
    attempted: list.numbers.length,
    creditsSpent: sent * perMessage,
    failures,
  });
});
