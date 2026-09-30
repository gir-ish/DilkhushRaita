/**
 * What a campaign actually puts on the wire, and — only if asked — one real
 * message to one number.
 *
 *   npx tsx scripts/campaign-test.mts                       # every template, exact text
 *   npx tsx scripts/campaign-test.mts websitePromotion 9876543210
 *   npx tsx scripts/campaign-test.mts websitePromotion 9876543210 --send
 *
 * Dry by default. Nothing is sent, and no credit spent, without --send.
 *
 * This exists because of the one failure that cannot be seen from the code or
 * from the gateway's answer: an Indian operator compares every message against
 * the text registered on the DLT portal for that template ID, and silently
 * drops anything that differs — after the credit is spent, while the gateway
 * reports "submitted successfully" and the panel shows it as sent. So the only
 * useful question is "what exactly did we send", and this prints it character
 * for character, ready to paste beside the portal's own copy.
 */
import { readFileSync } from "node:fs";
import {
  CAMPAIGN_TEMPLATES,
  NAME_FALLBACK,
  SMS_TEMPLATES,
  creditsFor,
  fillTemplate,
  type CampaignTemplate,
} from "../src/lib/sms-templates";

/* .env, read the way the app reads it — including a trailing "# comment". */
function parseEnvValue(rest: string): string {
  const v = rest.trim();
  for (const q of ['"', "'"]) {
    if (v.startsWith(q)) {
      const end = v.indexOf(q, 1);
      return end === -1 ? v.slice(1) : v.slice(1, end);
    }
  }
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}
for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = parseEnvValue(m[2]);
    }
  } catch {
    /* not there is fine */
  }
}

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const key = args.find((a) => !a.startsWith("--") && !/^\d/.test(a)) as CampaignTemplate | undefined;
const number = args.find((a) => /^\d/.test(a))?.replace(/\D/g, "");

/** What each campaign fills its slots with for a plain, nameless recipient. */
function sample(t: CampaignTemplate): string[] {
  if (t === "specialOffer") return ["Weekend Thali", "THALI50"];
  if (t === "customerOffer") return [NAME_FALLBACK, "120"];
  return [NAME_FALLBACK];
}

function show(t: CampaignTemplate) {
  const meta = SMS_TEMPLATES[t];
  const message = fillTemplate(t, sample(t));
  console.log(`\n── ${meta.name}  (${t})`);
  console.log(`   id         ${meta.id}`);
  console.log(`   category   ${meta.category}${meta.category === "promotional" ? "  ← never reaches a DND number" : ""}`);
  console.log(`   registered ${meta.text}`);
  console.log(`   outgoing   ${message}`);
  console.log(`   length     ${message.length} chars → ${creditsFor(message)} credit(s)`);
  return message;
}

if (!key) {
  console.log("Every campaign template, exactly as it goes out:");
  for (const t of CAMPAIGN_TEMPLATES) show(t);
  console.log(
    "\nCompare 'registered' against the wording on the DLT portal for that id,\n" +
      "character for character. A single differing comma is enough for the\n" +
      "operator to drop the message after charging for it.\n"
  );
  process.exit(0);
}

if (!CAMPAIGN_TEMPLATES.includes(key)) {
  console.error(`Unknown template "${key}". One of: ${CAMPAIGN_TEMPLATES.join(", ")}`);
  process.exit(1);
}

const message = show(key);

if (!number) {
  console.log("\nAdd a number to see the request, or a number and --send to send it.\n");
  process.exit(0);
}

const senderId = process.env.STPL_SENDER_ID?.trim();
const apiKey = process.env.STPL_API_KEY?.trim();
if (!senderId) {
  console.error("\n✗ STPL_SENDER_ID is not set in .env — nothing can be sent.");
  process.exit(1);
}

const ten = number.length === 12 && number.startsWith("91") ? number.slice(2) : number;
if (!/^[6-9]\d{9}$/.test(ten)) {
  console.error(`\n✗ "${number}" is not an Indian mobile number.`);
  process.exit(1);
}

/* Built by hand, exactly as src/lib/sms-gateway.ts builds it: URLSearchParams
   would write spaces as "+", which this gateway does not decode back. */
const query = [
  ...(apiKey ? [`apikey=${encodeURIComponent(apiKey)}`] : []),
  `senderid=${encodeURIComponent(senderId)}`,
  `templateid=${encodeURIComponent(SMS_TEMPLATES[key].id)}`,
  `number=${encodeURIComponent("91" + ten)}`,
  `message=${encodeURIComponent(message)}`,
  "format=JSON",
].join("&");

console.log(`\n   sender     ${senderId}`);
console.log(`   to         91${ten}`);
console.log(`   url        https://smsfortius.org/V2/apikey.php?${query.replace(/apikey=[^&]*/, "apikey=***")}`);

if (!SEND) {
  console.log("\nDry run — nothing sent, no credit spent. Add --send to send it for real.\n");
  process.exit(0);
}

console.log(`\nSending ${creditsFor(message)} credit(s) to 91${ten}…`);
const res = await fetch(`https://smsfortius.org/V2/apikey.php?${query}`, {
  signal: AbortSignal.timeout(30_000),
});
const text = await res.text();
console.log(`HTTP ${res.status}: ${text}`);
console.log(
  "\nA success here means the gateway accepted it, and nothing more. If it does\n" +
    "not arrive, look at the panel's Delivery Report: 'DND' means a promotional\n" +
    "message to a number on the Do Not Disturb register, and anything about the\n" +
    "template means the wording above does not match what is registered.\n"
);
