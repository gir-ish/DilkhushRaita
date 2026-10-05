import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { readDeliveryReport } from "@/lib/delivery-report";

/**
 * The gateway's delivery report, read back in.
 *
 * The API tells us only that a message was accepted; whether it arrived lives
 * in a CSV you download from the panel. Uploading it here turns that into
 * something the next campaign can act on: a number the operator refused every
 * time is marked, and campaigns stop paying to text it.
 *
 * Marks, rather than deletes. A number can come back into service, the
 * marking is visible in the contact book, and it can be undone there.
 */

const MAX_BYTES = 32 * 1024 * 1024;

export const POST = handler(async (req: Request) => {
  const s = await requireStaff("MARKETING");

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose the delivery report CSV to upload.");
  if (file.size === 0) throw new HttpError(400, "That file is empty.");
  if (file.size > MAX_BYTES)
    throw new HttpError(413, `That file is ${(file.size / 1024 / 1024).toFixed(1)}MB — the limit is 32MB.`);

  const summary = readDeliveryReport(await file.text());
  if (summary.numbers === 0)
    throw new HttpError(
      400,
      "No numbers could be read. This should be the report CSV from the SMS panel, with Mobile and Status columns."
    );

  /*
   * What happened to every number, kept so a later campaign can be sent only
   * to the ones that demonstrably receive. Added to rather than replaced: a
   * second report covers a different period, and a number that worked in
   * either of them works.
   */
  let reachable = 0;
  for (const r of summary.all) {
    const existing = await db.phoneDelivery.findUnique({ where: { phone: r.phone } });
    await db.phoneDelivery.upsert({
      where: { phone: r.phone },
      create: {
        phone: r.phone,
        delivered: r.delivered,
        failed: r.failed,
        pending: r.pending,
        lastError: r.error,
        lastDeliveredAt: r.delivered > 0 ? new Date() : null,
      },
      update: {
        delivered: { increment: r.delivered },
        failed: { increment: r.failed },
        pending: { increment: r.pending },
        ...(r.error ? { lastError: r.error } : {}),
        ...(r.delivered > 0 ? { lastDeliveredAt: new Date() } : {}),
      },
    });
    if (r.delivered > 0 || (existing?.delivered ?? 0) > 0) reachable++;
  }

  /*
   * Marking, on the other hand, only touches numbers already in the contact
   * book. A report covers every message the account sent, including ones to
   * customers who were never in the book, and inventing contacts from a
   * delivery report is not what was asked for.
   */
  const phones = summary.undeliverable.map((u) => u.phone);
  let marked = 0;
  for (let i = 0; i < phones.length; i += 200) {
    const slice = summary.undeliverable.slice(i, i + 200);
    for (const u of slice) {
      const { count } = await db.contact.updateMany({
        where: { phone: u.phone, undeliverable: false },
        data: { undeliverable: true, lastError: u.error },
      });
      marked += count;
    }
  }

  await audit({ uid: s.uid, name: s.name }, "DELIVERY_REPORT_IMPORTED", "Contact", undefined, {
    filename: file.name,
    rows: summary.rows,
    numbers: summary.numbers,
    delivered: summary.delivered,
    failed: summary.failed,
    pending: summary.pending,
    undeliverable: summary.undeliverable.length,
    marked,
  });

  return NextResponse.json({
    ok: true,
    filename: file.name,
    rows: summary.rows,
    numbers: summary.numbers,
    delivered: summary.delivered,
    failed: summary.failed,
    pending: summary.pending,
    undeliverableFound: summary.undeliverable.length,
    marked,
    /** Numbers now known to receive, from this report and any before it. */
    reachable,
    byError: summary.byError,
    /** What this saves on the next full campaign, at one credit each. */
    creditsSavedPerCampaign: marked,
  });
});
