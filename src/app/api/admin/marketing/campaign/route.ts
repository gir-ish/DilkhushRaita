import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { rateLimit } from "@/lib/rate-limit";
import { audit } from "@/lib/audit";
import {
  BATCH_SIZE,
  batches,
  creditsFor,
  parseRecipients,
  promoIsSendable,
  promoTemplate,
  renderPromo,
} from "@/lib/sms-campaign";

/**
 * Bulk promotional SMS.
 *
 * The only endpoint in this application that spends money per request, so it
 * is deliberately hard to fire by accident: owner or marketing only, a dry run
 * that costs nothing, and a live send that refuses unless it is told exactly
 * how many messages and how many credits the caller expects. If the list has
 * changed since they looked at it, the numbers disagree and nothing is sent.
 */

const Body = z.object({
  /** Whatever was pasted or uploaded — parsed and validated server-side. */
  recipients: z.string().min(1).max(200_000),
  /** "customers" fills the list from the shop's own customers instead. */
  source: z.enum(["paste", "customers"]).default("paste"),
  dryRun: z.boolean().default(true),
  /**
   * What the dashboard showed the operator before they pressed send. A live
   * send that disagrees is refused — the list is not what they approved.
   */
  expect: z.object({ count: z.number().int(), credits: z.number().int() }).optional(),
});

/** A hard ceiling per campaign, so one paste cannot empty the balance. */
const MAX_PER_CAMPAIGN = 5000;

export const POST = handler(async (req: Request) => {
  const session = await requireStaff("MARKETING");

  const body = Body.parse(await req.json());

  const template = promoTemplate();
  if (!template)
    throw new HttpError(
      503,
      "No approved promotional wording is configured. Set STPL_PROMO_MESSAGE_FILE " +
        "to the DLT-approved text before sending a campaign."
    );

  const message = renderPromo(template);
  const sendable = promoIsSendable(message);
  if (!sendable.ok) throw new HttpError(400, sendable.why);

  // The shop's own customers, which is the list that carries consent: they
  // gave the number to place an order.
  let raw = body.recipients;
  if (body.source === "customers") {
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
   * The list must be the one the operator was shown.
   *
   * Between previewing and sending, a paste can be edited or the customer
   * table can grow. Refusing a mismatch means the figure they approved is the
   * figure they pay.
   */
  if (!body.expect) throw new HttpError(400, "Preview the campaign before sending it.");
  if (body.expect.count !== list.numbers.length || body.expect.credits !== credits)
    throw new HttpError(
      409,
      `The list changed since you previewed it — it is now ${list.numbers.length} numbers ` +
        `and ${credits} credits. Preview again and check before sending.`
    );

  // One campaign at a time, per process. A double-clicked button is the most
  // likely way this gets sent twice.
  if (!rateLimit("marketing:campaign", 1, 60 * 1000))
    throw new HttpError(429, "A campaign was just sent. Wait a minute before sending another.");

  const senderId = process.env.STPL_SENDER_ID?.trim();
  const apiKey = process.env.STPL_API_KEY?.trim();
  const templateId = process.env.STPL_PROMO_TEMPLATE_ID?.trim();
  if (!senderId || !templateId)
    throw new HttpError(503, "STPL_SENDER_ID and STPL_PROMO_TEMPLATE_ID must both be set.");

  let sent = 0;
  const failures: string[] = [];

  for (const group of batches(list.numbers)) {
    const numbers = group.map((n) => n.replace(/^\+/, "")).join(",");
    // Built by hand with %20 for spaces, exactly as the OTP path is: this
    // gateway does not decode "+" back into a space, and a message whose text
    // differs from its template is dropped after being charged for.
    const query = [
      ...(apiKey ? [`apikey=${encodeURIComponent(apiKey)}`] : []),
      `senderid=${encodeURIComponent(senderId)}`,
      `templateid=${encodeURIComponent(templateId)}`,
      `number=${encodeURIComponent(numbers)}`,
      `message=${encodeURIComponent(message)}`,
      "format=JSON",
    ].join("&");

    try {
      const res = await fetch(`https://smsfortius.org/V2/apikey.php?${query}`, {
        signal: AbortSignal.timeout(30_000),
      });
      const text = await res.text();
      let data: { status?: boolean | string; code?: string; description?: string } = {};
      try {
        data = JSON.parse(text);
      } catch {
        failures.push(`batch of ${group.length}: gateway did not return JSON`);
        continue;
      }
      const status = typeof data.status === "string" ? data.status.toLowerCase() : data.status;
      const ok =
        res.ok && (data.code === "011" || status === true || status === "true" || status === "success");
      if (ok) sent += group.length;
      else failures.push(`batch of ${group.length}: ${data.description ?? `code ${data.code}`}`);
    } catch (e) {
      failures.push(`batch of ${group.length}: ${e instanceof Error ? e.name : "network error"}`);
    }
  }

  await audit({ uid: session.uid, name: session.name }, "MARKETING_CAMPAIGN_SENT", "Campaign", undefined, {
    recipients: list.numbers.length,
    sent,
    credits: sent * perMessage,
    failedBatches: failures.length,
  });

  return NextResponse.json({
    ok: failures.length === 0,
    sent,
    attempted: list.numbers.length,
    creditsSpent: sent * perMessage,
    failures,
  });
});
