/**
 * Hands a message to the STPL gateway (smsfortius.org), for every template
 * except the OTP one — that keeps its own path in src/lib/otp.ts.
 *
 * Only credentials come from the environment: the sender ID and the API key,
 * which differ between machines and one of which is a secret. The template ID
 * and its wording come from src/lib/sms-templates.ts, together.
 */

export interface GatewayConfig {
  senderId: string;
  apiKey?: string;
}

export function gatewayConfig(): GatewayConfig | null {
  const senderId = process.env.STPL_SENDER_ID?.trim();
  if (!senderId) return null;
  return { senderId, apiKey: process.env.STPL_API_KEY?.trim() || undefined };
}

export interface SendResult {
  ok: boolean;
  detail?: string;
  /**
   * The gateway's own id for this submission.
   *
   * The one thing that makes a send traceable afterwards. "Submitted
   * successfully" is all the API ever says — whether a message reached a
   * handset is only visible in the panel's Delivery Report, and this is the
   * id to look it up by. Thrown away, a campaign that nobody received leaves
   * nothing at all to investigate.
   */
  messageId?: string;
  /** What the gateway says it charged, which is not always what we predicted. */
  credits?: string;
  /** How many destinations it accepted. */
  numbers?: string;
}

/** The documented codes, plus the undocumented 003, named for the log. */
const KNOWN: Record<string, string> = {
  "001": "the gateway rejected the API key",
  "003": "the gateway does not recognise this sender ID",
  "004": "no message text reached the gateway",
  "007": "no valid destination number",
  "008": "ACCOUNT OUT OF CREDIT",
  "009": "PARENT ACCOUNT OUT OF BALANCE",
  "010": "message campaign failed at the vendor",
};

/**
 * Sends one message to one or more numbers.
 *
 * Numbers arrive as +91XXXXXXXXXX and go out as 91XXXXXXXXXX: a literal "+" in a
 * query string is read as a space.
 *
 * The query is built by hand with encodeURIComponent so spaces travel as %20.
 * URLSearchParams writes them as "+", which this gateway does not decode back —
 * the operator then sees "Hello+Rahul,+your+order…", finds it different from the
 * registered template, and drops it while still charging. That is not
 * hypothetical: it is what silently broke every OTP for a day.
 */
export async function sendSms(
  cfg: GatewayConfig,
  templateId: string,
  numbers: string[],
  message: string,
  timeoutMs = 30_000
): Promise<SendResult> {
  if (numbers.length === 0) return { ok: false, detail: "no numbers" };

  const query = [
    ...(cfg.apiKey ? [`apikey=${encodeURIComponent(cfg.apiKey)}`] : []),
    `senderid=${encodeURIComponent(cfg.senderId)}`,
    `templateid=${encodeURIComponent(templateId)}`,
    `number=${encodeURIComponent(numbers.map((n) => n.replace(/^\+/, "")).join(","))}`,
    `message=${encodeURIComponent(message)}`,
    "format=JSON",
  ].join("&");

  try {
    const res = await fetch(`https://smsfortius.org/V2/apikey.php?${query}`, {
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let data: {
      status?: boolean | string;
      code?: string;
      description?: string;
      data?: { messageid?: string; totnumber?: string; totalcredit?: string };
    } = {};
    try {
      data = JSON.parse(text);
    } catch {
      return { ok: false, detail: `gateway did not return JSON (HTTP ${res.status})` };
    }
    // "011" is the reliable signal. `status` is documented as a boolean and
    // arrives as the string "Success"; both are accepted.
    const status = typeof data.status === "string" ? data.status.toLowerCase() : data.status;
    const ok =
      res.ok && (data.code === "011" || status === true || status === "true" || status === "success");
    if (ok) {
      // As in the OTP path: the answer is always "submitted", so what it was
      // submitted AS is the only thing worth keeping. A repeating messageid
      // across different payloads means the gateway is not queueing anything.
      console.log(
        `[sms] submitted to ${numbers.length} number(s) sender=${cfg.senderId} ` +
          `template=${templateId} code=${data.code ?? "?"} ` +
          `messageid=${data.data?.messageid ?? "?"} credits=${data.data?.totalcredit ?? "?"}`
      );
      return {
        ok: true,
        messageId: data.data?.messageid,
        credits: data.data?.totalcredit,
        numbers: data.data?.totnumber,
      };
    }
    return {
      ok: false,
      detail: (data.code ? KNOWN[data.code] : undefined) ?? data.description ?? `code ${data.code ?? "?"}`,
    };
  } catch (e) {
    return { ok: false, detail: e instanceof Error && e.name === "TimeoutError" ? "timed out" : "network error" };
  }
}
