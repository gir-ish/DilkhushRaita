import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { pushConfigured, pushToUsers } from "@/lib/push";

/**
 * This browser asking to be woken for new orders, and asking to stop.
 *
 * A subscription belongs to a browser, not a person: an owner with a phone
 * and a till has two, and turning one off must leave the other alone. The
 * endpoint the push service hands out IS the browser, so it is the key.
 */

const Body = z.object({
  endpoint: z.string().url().max(1000),
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(200) }),
  label: z.string().max(60).optional(),
});

export const GET = handler(async () => {
  const s = await requireStaff();
  const devices = await db.pushSubscription.findMany({
    where: { userId: s.uid },
    select: { id: true, label: true, createdAt: true, lastSentAt: true },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({
    // Without keys on the server there is nothing to offer, and the button
    // says so rather than failing when it is pressed.
    configured: pushConfigured(),
    publicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? null,
    devices,
  });
});

export const POST = handler(async (req: Request) => {
  const s = await requireStaff();
  if (!pushConfigured())
    throw new HttpError(503, "Order alerts are not set up on the server yet.");
  const body = Body.parse(await req.json());

  /*
   * The same browser re-subscribing must not become a second row — and if it
   * signed in as somebody else, the row follows the new person, because the
   * notification lands on this device and this is who is using it.
   */
  await db.pushSubscription.upsert({
    where: { endpoint: body.endpoint },
    update: {
      userId: s.uid,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      label: body.label?.slice(0, 60) ?? "",
      failures: 0,
    },
    create: {
      endpoint: body.endpoint,
      p256dh: body.keys.p256dh,
      auth: body.keys.auth,
      userId: s.uid,
      label: body.label?.slice(0, 60) ?? "",
    },
  });

  return NextResponse.json({ ok: true });
});

export const DELETE = handler(async (req: Request) => {
  const s = await requireStaff();
  const endpoint = new URL(req.url).searchParams.get("endpoint");
  // Only ever this person's own device, and only the one named.
  await db.pushSubscription.deleteMany({
    where: { userId: s.uid, ...(endpoint ? { endpoint } : {}) },
  });
  return NextResponse.json({ ok: true });
});

/** A test push, so "is it working?" is answered before an order depends on it. */
export const PUT = handler(async () => {
  const s = await requireStaff();
  const sent = await pushToUsers([s.uid], {
    title: "🔔 Alerts are on",
    body: "This is what a new order will look like, even with the site closed.",
    url: "/admin/online",
    tag: "dk-test",
  });
  if (sent === 0)
    throw new HttpError(
      400,
      "Nothing was sent. Turn alerts on for this device first — or it may have been switched off in the browser's settings."
    );
  return NextResponse.json({ ok: true, sent });
});
