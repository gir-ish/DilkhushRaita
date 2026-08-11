import nodemailer, { type Transporter } from "nodemailer";

/**
 * Outbound email over SMTP.
 *
 * Configured with a single connection string so any provider works without a
 * code change:
 *
 *   SMTP_URL="smtp://user:APP_PASSWORD@smtp.gmail.com:587"
 *
 * Gmail specifically will NOT accept the account password — Google withdrew
 * that in 2022. It needs an App Password (Google Account → Security → 2-Step
 * Verification → App passwords), which is 16 characters. If the password
 * contains "@" or ":" it must be percent-encoded, or the URL will not parse.
 *
 * SMTP_FROM sets the visible sender; it defaults to the SMTP username, which is
 * what Gmail requires anyway (it rewrites anything else to the real account).
 */
let cached: Transporter | null = null;

export function emailConfigured() {
  return !!process.env.SMTP_URL;
}

function transport(): Transporter | null {
  if (!process.env.SMTP_URL) return null;
  if (!cached) {
    cached = nodemailer.createTransport(process.env.SMTP_URL, {
      // Gmail's submission port is STARTTLS, not implicit TLS.
      secure: process.env.SMTP_URL.startsWith("smtps://"),
    });
  }
  return cached;
}

function senderAddress() {
  if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
  try {
    const user = decodeURIComponent(new URL(process.env.SMTP_URL ?? "").username);
    return user ? `DilKhush Dhaba <${user}>` : "DilKhush Dhaba";
  } catch {
    return "DilKhush Dhaba";
  }
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  text: string;
  html?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const t = transport();
  if (!t) {
    console.error("[email] SMTP_URL is not set — cannot send:", opts.subject);
    return { ok: false, error: "Email is not configured on the server" };
  }
  try {
    await t.sendMail({
      from: senderAddress(),
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    return { ok: true };
  } catch (e) {
    // Never surface the SMTP error to the browser: it can contain the
    // username, the host, and sometimes the credential itself.
    console.error("[email] send failed:", e);
    return { ok: false, error: "Could not send the email. Try again shortly." };
  }
}

/** The one email this app sends: a code to get back into the dashboard. */
export function pinResetEmail(code: string, minutes: number) {
  return {
    subject: `${code} is your DilKhush Dhaba reset code`,
    text: [
      `Your code to reset the dashboard PIN is ${code}.`,
      `It expires in ${minutes} minutes and can only be used once.`,
      ``,
      `If you did not ask for this, someone has your dashboard password —`,
      `change it, and do not enter this code anywhere.`,
    ].join("\n"),
    html: `
      <div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:420px">
        <p style="font-size:15px;color:#3b2b2b">Your code to reset the dashboard PIN:</p>
        <p style="font-size:34px;font-weight:700;letter-spacing:.22em;color:#7B1E1E;margin:12px 0">${code}</p>
        <p style="font-size:13px;color:#6b5555">Expires in ${minutes} minutes. Single use.</p>
        <p style="font-size:12px;color:#8a7676;margin-top:20px">
          If you did not ask for this, someone has your dashboard password —
          change it, and do not enter this code anywhere.
        </p>
      </div>`,
  };
}
