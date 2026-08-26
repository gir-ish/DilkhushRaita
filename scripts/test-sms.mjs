/**
 * Sends one real SMS through the configured gateway, to prove the account
 * works before customers depend on it.
 *
 *   node scripts/test-sms.mjs 9876543210
 *
 * Reads the same variables the app does, so run it on the machine whose .env
 * you mean to test — the live one is the server, not your laptop. It spends
 * one SMS credit. The API key is never printed.
 *
 * Worth doing because the failure that matters is invisible from the code: a
 * message whose wording does not match the DLT template registered for your
 * sender is accepted by the gateway, reported as submitted, and then dropped
 * by the operator. Only a handset can tell you it arrived.
 */
import { readFileSync } from "node:fs";

/*
 * Reads .env the way Next does, so this tests the configuration the app will
 * actually run with rather than a separate one.
 *
 * The quoting matters more than it looks. A value often carries a trailing
 * note — KEY="…"   # where this came from — and taking the rest of the line at
 * face value sends that note along with the key. The gateway then answers
 * "Invalid Api Key" against credentials that were perfectly good, and the hunt
 * starts in the wrong place.
 */
function parseEnvValue(rest) {
  const v = rest.trim();
  for (const q of ['"', "'"]) {
    if (v.startsWith(q)) {
      const end = v.indexOf(q, 1);
      return end === -1 ? v.slice(1) : v.slice(1, end);
    }
  }
  // Unquoted: everything up to a whitespace-preceded comment marker.
  const hash = v.search(/\s#/);
  return (hash === -1 ? v : v.slice(0, hash)).trim();
}

for (const file of [".env.local", ".env"]) {
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/);
      if (!m) continue;
      if (process.env[m[1]] !== undefined) continue; // first file wins, as Next does
      process.env[m[1]] = parseEnvValue(m[2]);
    }
  } catch {
    // A missing .env.local is normal.
  }
}

/*
 * --dry composes everything and prints it, then stops before the request.
 *
 * Costs nothing, and answers the only question that matters when a message is
 * accepted but never arrives: is the text about to go out character-for-
 * character the text DLT approved? Run it on whichever machine's .env you
 * suspect.
 */
const DRY = process.argv.includes("--dry");
const raw = (process.argv[2] ?? "").replace(/\D/g, "");
const digits = raw.startsWith("91") && raw.length === 12 ? raw.slice(2) : raw;
if (digits.length !== 10) {
  console.error("Usage: node scripts/test-sms.mjs 9876543210");
  process.exit(1);
}

const provider = process.env.OTP_PROVIDER ?? "console";
const senderId = (process.env.STPL_SENDER_ID ?? "").trim();
const apiKey = (process.env.STPL_API_KEY ?? "").trim();
const templateId = (process.env.STPL_TEMPLATE_ID ?? "").trim();
const template =
  (process.env.STPL_MESSAGE ?? "").trim() ||
  "{otp} is your OTP for DilKhush Dhaba. Valid for 10 minutes. Do not share it with anyone.";

console.log(`provider     : ${provider}${provider === "stpl" ? "" : "   ⚠️  not 'stpl' — the app will NOT use this gateway"}`);
console.log(`sender id    : ${senderId || "(missing)"}${senderId && senderId.length !== 6 ? `   ⚠️  ${senderId.length} chars, gateway expects 6` : ""}`);
console.log(`api key      : ${apiKey ? `set (${apiKey.length} chars)` : "(not set — sending without one)"}`);
console.log(`template id  : ${templateId || "(not set — gateway will guess the template)"}`);

if (!senderId) {
  console.error("\nSTPL_SENDER_ID is not set. Nothing to send with.");
  process.exit(1);
}

// A fixed, obviously-fake code: this is a delivery test, and a real-looking
// OTP in a log or a screenshot is a habit worth not starting.
const code = "123456";
let message = template.replace(/\{otp\}/gi, code);
if ((message.match(/\{#var#\}/g) ?? []).length === 1) message = message.replace("{#var#}", code);
if (message.includes("{#var#}") || /\{otp\}/i.test(message)) {
  console.error(
    "\nSTPL_MESSAGE still has an unfilled placeholder. Put {otp} where the code\n" +
      "goes and a literal value in every other {#var#} slot — otherwise the\n" +
      "customer reads \"{#var#}\" and the operator drops the message anyway."
  );
  process.exit(1);
}
console.log(`message      : ${message}`);
console.log(`to           : +91${digits}\n`);

if (DRY) {
  console.log("--- DRY RUN: nothing sent, no credit spent ---");
  console.log(
    "length         :",
    message.length,
    message.length > 160 ? "(over 160 → 2 credits per send)" : "(1 credit per send)"
  );
  const approved =
    `Dear Customer, your OTP for registration on Dilkhush Raita is${code}. ` +
    `This OTP is valid for 10 minutes. Please do not share it with anyone. ` +
    `Visit https://dilkhushraita.com/`;
  if (message === approved) {
    console.log("template match : YES — identical to the approved wording");
  } else {
    console.log("template match : NO — the operator will drop this");
    for (let i = 0; i < Math.max(message.length, approved.length); i++) {
      if (message[i] !== approved[i]) {
        console.log(`  first difference at character ${i}`);
        console.log(`    this server : ${JSON.stringify(message.slice(Math.max(0, i - 25), i + 25))}`);
        console.log(`    approved    : ${JSON.stringify(approved.slice(Math.max(0, i - 25), i + 25))}`);
        break;
      }
    }
  }
  const q =
    `senderid=${encodeURIComponent(senderId)}` +
    `&number=${encodeURIComponent("91" + digits)}` +
    `&message=${encodeURIComponent(message)}&format=JSON`;
  console.log("query (key omitted):");
  console.log("  " + q);
  console.log('uses "+" for spaces (bad):', q.includes("+"));
  process.exit(0);
}

const url = new URL("https://smsfortius.org/V2/apikey.php");
url.searchParams.set("senderid", senderId);
url.searchParams.set("number", `91${digits}`);
url.searchParams.set("message", message);
url.searchParams.set("format", "JSON");
if (apiKey) url.searchParams.set("apikey", apiKey);
if (templateId) url.searchParams.set("templateid", templateId);

const ERRORS = {
  "001": "the gateway rejected the API key — check STPL_API_KEY",
  "002": "invalid route id",
  // Undocumented, seen live: the sender ID is not one registered to this
  // account. The gateway checks this before it accepts a message.
  "003": "the gateway does not recognise this sender ID — check STPL_SENDER_ID",
  "004": "no message text reached the gateway",
  "005": "schedule time is in the past",
  "006": "invalid date/time format",
  "007": "no valid destination number",
  "008": "ACCOUNT OUT OF CREDIT — top up",
  "009": "PARENT ACCOUNT OUT OF BALANCE — top up",
  "010": "message campaign failed at the vendor",
};

try {
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    console.error(`Gateway did not return JSON (HTTP ${res.status}):\n${text.slice(0, 400)}`);
    process.exit(1);
  }

  console.log("gateway reply:", JSON.stringify(data));
  // "011" is the signal. `status` is documented as a boolean but comes back as
  // the string "Success" from the live gateway, so all the observed shapes are
  // accepted — see the note in src/lib/otp.ts.
  const status = typeof data.status === "string" ? data.status.toLowerCase() : data.status;
  const ok =
    res.ok && (data.code === "011" || status === true || status === "true" || status === "success");
  if (!ok) {
    const why = (data.code ? ERRORS[data.code] : undefined) ?? data.description ?? "unrecognised error";
    console.error(`\n❌ Refused — code ${data.code ?? "?"}: ${why}`);
    process.exit(1);
  }

  console.log(`\n✅ Accepted by the gateway. Credits used: ${data.data?.totalcredit ?? "?"}`);
  console.log("Now check the handset. If nothing arrives within a minute or two, the");
  console.log("gateway took it but the operator dropped it — which almost always means");
  console.log("STPL_MESSAGE does not match the DLT template registered for this sender.");
} catch (e) {
  console.error(e?.name === "TimeoutError" ? "Timed out talking to the gateway." : `Network error: ${e?.message ?? e}`);
  process.exit(1);
}
