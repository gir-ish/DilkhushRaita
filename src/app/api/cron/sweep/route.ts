import { NextResponse } from "next/server";
import { handler, HttpError } from "@/lib/guard";
import { sweepOrders } from "@/lib/order-sweep";

/**
 * The heartbeat: chase unaccepted orders, close off yesterday's leftovers.
 *
 * Meant for a cPanel cron entry running every minute:
 *
 *   * * * * * curl -fsS "https://www.dilkhushraita.com/api/cron/sweep?key=…"
 *
 * The dashboard runs the same sweep while a screen is open, but that is the
 * fallback, not the mechanism — the entire point of chasing an order nobody
 * has accepted is that nobody is looking at a screen.
 *
 * Guarded by a shared secret rather than a session, because cron has no login
 * and the alternative is an endpoint the whole internet can use to close the
 * day's orders. With CRON_SECRET unset it refuses everyone, which fails in
 * the safe direction: no sweep rather than an open one.
 */

export const dynamic = "force-dynamic";

function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const url = new URL(req.url);
  const given = url.searchParams.get("key") ?? req.headers.get("authorization")?.replace(/^Bearer /i, "");
  if (!given || given.length !== secret.length) return false;
  // Constant time: a key guessed a character at a time is still guessed.
  let diff = 0;
  for (let i = 0; i < secret.length; i++) diff |= secret.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

export const GET = handler(async (req: Request) => {
  if (!authorised(req)) throw new HttpError(401, "Not authorised");
  const { nag, close } = await sweepOrders();
  return NextResponse.json({ ok: true, nag, close });
});

/** Same thing, for crons and uptime pingers that would rather POST. */
export const POST = GET;
