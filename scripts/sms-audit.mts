/**
 * Every template the shop has, and a way to send any one of them.
 *
 *   npx tsx scripts/sms-audit.mts                          # list all seven
 *   npx tsx scripts/sms-audit.mts orderConfirmed 9876543210          # dry run
 *   npx tsx scripts/sms-audit.mts orderConfirmed 9876543210 --send   # one credit
 *   npx tsx scripts/sms-audit.mts --all 9876543210 --send            # seven credits
 *
 * Built for one job: finding out which templates the operator delivers and
 * which it silently drops. Every message here goes out exactly the way the
 * app sends it — same endpoint, same parameter order, same encoding — so a
 * template that fails here fails in the app, and one that arrives here is
 * registered correctly.
 *
 * Dry by default. Nothing is sent, and no credit spent, without --send.
 */
import { readFileSync } from "node:fs";
import { SMS_TEMPLATES, creditsFor, fillTemplate, type TemplateKey } from "../src/lib/sms-templates";
import { OTP_TEMPLATE_ID, OTP_TEMPLATE_TEXT, composeOtpMessage } from "../src/lib/otp";

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

interface Entry {
  key: string;
  name: string;
  id: string;
  category: string;
  registered: string;
  outgoing: string;
}

/** Sample values per template, chosen to look like the real thing. */
const SAMPLES: Record<TemplateKey, string[]> = {
  orderConfirmed: ["Girish", "RHN-300926-0001"],
  orderDispatched: ["Girish", "RHN-300926-0001"],
  orderDelivered: ["Girish", "RHN-300926-0001"],
  customerOffer: ["Girish", "120"],
  specialOffer: ["Weekend Thali", "THALI50"],
  websitePromotion: ["Girish"],
};

const ALL: Entry[] = [
  {
    key: "otp",
    name: "Login OTP",
    id: OTP_TEMPLATE_ID,
    category: "transactional",
    registered: OTP_TEMPLATE_TEXT,
    outgoing: composeOtpMessage("1234"),
  },
  ...(Object.keys(SMS_TEMPLATES) as TemplateKey[]).map((key) => {
    const t = SMS_TEMPLATES[key];
    return {
      key,
      name: t.name,
      id: t.id,
      category: t.category as string,
      registered: t.text,
      outgoing: fillTemplate(key, SAMPLES[key]),
    };
  }),
];

const args = process.argv.slice(2);
const SEND = args.includes("--send");
const EVERY = args.includes("--all");
const wanted = args.find((a) => !a.startsWith("--") && !/^\d/.test(a));
const number = args.find((a) => /^\d/.test(a))?.replace(/\D/g, "");

function print(e: Entry, n: number) {
  console.log(`\n${String(n).padStart(2)}. ${e.name}  (${e.key})`);
  console.log(`    id         ${e.id}`);
  console.log(`    category   ${e.category}${e.category === "promotional" ? "   ← blocked for DND numbers" : ""}`);
  console.log(`    registered ${e.registered}`);
  console.log(`    outgoing   ${e.outgoing}`);
  console.log(`    length     ${e.outgoing.length} chars → ${creditsFor(e.outgoing)} credit(s)`);
}

if (!wanted && !EVERY) {
  console.log(`All ${ALL.length} templates, exactly as the app sends them:`);
  ALL.forEach(print);
  const promo = ALL.filter((e) => e.category === "promotional").length;
  console.log(
    `\n${ALL.length} templates — ${ALL.length - promo} transactional, ${promo} promotional.` +
      `\n\nSend one:  npx tsx scripts/sms-audit.mts <key> 9XXXXXXXXX --send` +
      `\nSend all:  npx tsx scripts/sms-audit.mts --all 9XXXXXXXXX --send   (${ALL.length} credits)\n`
  );
  process.exit(0);
}

const senderId = process.env.STPL_SENDER_ID?.trim();
const apiKey = process.env.STPL_API_KEY?.trim();
if (!senderId) {
  console.error("✗ STPL_SENDER_ID is not set in .env.");
  process.exit(1);
}
if (!number) {
  console.error("✗ Give a mobile number to send to.");
  process.exit(1);
}
const ten = number.length === 12 && number.startsWith("91") ? number.slice(2) : number;
if (!/^[6-9]\d{9}$/.test(ten)) {
  console.error(`✗ "${number}" is not an Indian mobile number.`);
  process.exit(1);
}

const chosen = EVERY ? ALL : ALL.filter((e) => e.key === wanted);
if (chosen.length === 0) {
  console.error(`✗ Unknown template "${wanted}". One of: ${ALL.map((e) => e.key).join(", ")}`);
  process.exit(1);
}

/* Built by hand, exactly as the app builds it: URLSearchParams would write a
   space as "+", which this gateway does not decode back. */
const send = async (e: Entry) => {
  const query = [
    ...(apiKey ? [`apikey=${encodeURIComponent(apiKey)}`] : []),
    `senderid=${encodeURIComponent(senderId)}`,
    `templateid=${encodeURIComponent(e.id)}`,
    `number=${encodeURIComponent("91" + ten)}`,
    `message=${encodeURIComponent(e.outgoing)}`,
    "format=JSON",
  ].join("&");
  const res = await fetch(`https://smsfortius.org/V2/apikey.php?${query}`, {
    signal: AbortSignal.timeout(30_000),
  });
  return `HTTP ${res.status}: ${await res.text()}`;
};

chosen.forEach(print);

if (!SEND) {
  console.log(`\nDry run — nothing sent. Add --send to send ${chosen.length} message(s).\n`);
  process.exit(0);
}

console.log(`\nSending ${chosen.length} message(s) to 91${ten}…\n`);
for (const [i, e] of chosen.entries()) {
  const answer = await send(e);
  console.log(`${String(i + 1).padStart(2)}. ${e.name.padEnd(20)} ${answer}`);
  // A moment between sends, so they arrive in order and are easy to tell apart.
  if (i < chosen.length - 1) await new Promise((r) => setTimeout(r, 1500));
}
console.log(
  `\nNow look at the handset and note which of the ${chosen.length} arrived.` +
    `\nEvery one was accepted by the gateway; only the phone can say which the` +
    `\noperator actually delivered.\n`
);
