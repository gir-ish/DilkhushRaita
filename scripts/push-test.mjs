#!/usr/bin/env node
/**
 * Sends a notification to every subscribed device, from the server.
 *
 * Nothing about this needs a browser tab, a signed-in session or the
 * dashboard to be open — which is the point. When somebody says "alerts only
 * come while the site is open", this is what tells you whether the server is
 * failing to send or the device is failing to show. Run it with everything
 * closed: if a phone rings, the whole chain works and the problem was never
 * the server.
 *
 *   node scripts/push-test.mjs
 *   node scripts/push-test.mjs "Kitchen, two parathas"   # your own message
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const webpush = require("web-push");
const { PrismaClient } = require("@prisma/client");

/* Plain node does not read .env the way Next does, so do it here. */
function loadEnv() {
  let raw = "";
  try {
    raw = readFileSync(new URL("../.env", import.meta.url), "utf8");
  } catch {
    return;
  }
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/i);
    if (!m) continue;
    const value = m[2].trim().replace(/^["']|["']$/g, "");
    if (!process.env[m[1]]) process.env[m[1]] = value;
  }
}
loadEnv();

const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
const privateKey = process.env.VAPID_PRIVATE_KEY;
if (!publicKey || !privateKey) {
  console.error("✗ No VAPID keys in .env — order alerts are switched off on this server.");
  process.exit(1);
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || "mailto:owner@dilkhushraita.com", publicKey, privateKey);

const db = new PrismaClient();
const subs = await db.pushSubscription.findMany();
if (subs.length === 0) {
  console.error("✗ No devices are subscribed. Turn alerts on from Overview → Order alerts.");
  process.exit(1);
}

const body = process.argv[2] ?? "If you can read this with the site closed, alerts are working.";
const payload = JSON.stringify({
  title: "🛎️ Test from the server",
  body,
  url: "/admin/online",
  // A fresh tag every time, so several tests do not collapse into one.
  tag: `dk-test-${Date.now()}`,
});

console.log(`Sending to ${subs.length} device${subs.length === 1 ? "" : "s"}…\n`);

for (const sub of subs) {
  const who = `${sub.label || "unnamed"} (${sub.endpoint.slice(0, 48)}…)`;
  try {
    const res = await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      payload,
      { TTL: 3600, urgency: "high" }
    );
    console.log(`✓ ${res.statusCode} accepted — ${who}`);
  } catch (e) {
    const status = e?.statusCode;
    console.log(`✗ ${status ?? "no status"} — ${who}`);
    console.log(`    ${e?.body?.trim() || e?.message || e}`);
    if (status === 404 || status === 410)
      console.log("    (that browser is gone; the app drops it on the next real send)");
  }
}

console.log(
  "\nAccepted means the push service took it. If a device still shows nothing,\n" +
    "the message is being suppressed on that device, not lost on the way."
);
process.exit(0);
