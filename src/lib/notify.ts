import { db } from "./db";

/**
 * Modular notification service. v1 records IN_APP notifications in the DB
 * (shown in the customer account). SMS / WhatsApp / Email / Push channels are
 * feature-flagged via env and stubbed here — plug real providers into
 * `sendExternal` without touching callers.
 * Promotional messages must check CustomerProfile.notifyPromos; transactional
 * order updates are always allowed.
 */
export async function notifyUser(
  userId: string,
  type: string,
  title: string,
  body: string
) {
  try {
    await db.notification.create({
      data: { userId, type, title, body, channel: "IN_APP", status: "SENT" },
    });
    await sendExternal(userId, type, title, body);
  } catch (e) {
    console.error("[notify] failed", e);
  }
}

async function sendExternal(userId: string, type: string, title: string, body: string) {
  if (process.env.NOTIFY_SMS_ENABLED === "true") {
    // TODO(production): send via the STPL gateway — see src/lib/otp.ts
  }
  if (process.env.NOTIFY_WHATSAPP_ENABLED === "true") {
    // TODO(production): send via WhatsApp Business API
  }
  if (process.env.NOTIFY_EMAIL_ENABLED === "true") {
    // TODO(production): send via SMTP_URL
  }
}
