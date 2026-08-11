import { createHash, randomBytes } from "crypto";
import { cookies } from "next/headers";
import { db } from "./db";

/**
 * Trusted-device cookie for PIN unlock.
 *
 * A 4–6 digit PIN is only 10,000–1,000,000 guesses, which is not a credential
 * you can expose to the open internet. So the PIN never stands alone: it is
 * only accepted from a browser holding this cookie, whose hash matches a
 * StaffDevice row created during a full email + password login.
 *
 * The cookie holds a 32-byte random token; only its SHA-256 lands in the
 * database, so a database leak does not hand over working devices.
 */
const COOKIE = "dk_device";
const MAX_AGE = 60 * 60 * 24 * 365; // a till browser should not be re-paired monthly

function cookieSecure() {
  const v = process.env.COOKIE_SECURE;
  if (v === "true") return true;
  if (v === "false") return false;
  return process.env.NODE_ENV === "production";
}

export function hashDeviceToken(token: string) {
  return createHash("sha256").update(`${token}:${process.env.SESSION_SECRET}`).digest("hex");
}

export async function readDeviceToken(): Promise<string | null> {
  return (await cookies()).get(COOKIE)?.value ?? null;
}

/**
 * Marks the current browser as trusted for `userId` and returns the row.
 * Reuses the existing cookie when there is one, so re-pairing the till does
 * not leave a trail of dead device rows.
 */
export async function trustThisDevice(userId: string, label: string) {
  const jar = await cookies();
  let token = jar.get(COOKIE)?.value ?? null;

  if (token) {
    const existing = await db.staffDevice.findUnique({ where: { tokenHash: hashDeviceToken(token) } });
    if (existing && existing.userId === userId) {
      await db.staffDevice.update({
        where: { id: existing.id },
        data: { lastUsedAt: new Date(), label },
      });
      return existing;
    }
  }

  token = randomBytes(32).toString("hex");
  const device = await db.staffDevice.create({
    data: { userId, tokenHash: hashDeviceToken(token), label },
  });
  jar.set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: cookieSecure(),
    path: "/",
    maxAge: MAX_AGE,
  });
  return device;
}

/** The user this browser is paired with, or null. */
export async function deviceOwner() {
  const token = await readDeviceToken();
  if (!token) return null;
  const device = await db.staffDevice.findUnique({
    where: { tokenHash: hashDeviceToken(token) },
    include: { user: true },
  });
  if (!device) return null;
  if (device.user.blocked) return null;
  return device;
}

export async function touchDevice(id: string) {
  await db.staffDevice.update({ where: { id }, data: { lastUsedAt: new Date() } }).catch(() => {});
}

/** Called when a PIN is forgotten or an owner wants every till re-paired. */
export async function revokeAllDevices(userId: string) {
  await db.staffDevice.deleteMany({ where: { userId } });
}

/** Short human label so the owner can tell one paired browser from another. */
export function deviceLabelFrom(userAgent: string | null) {
  if (!userAgent) return "Unknown device";
  const ua = userAgent;
  const os = /Windows/i.test(ua) ? "Windows"
    : /Android/i.test(ua) ? "Android"
    : /iPhone|iPad|iOS/i.test(ua) ? "iOS"
    : /Mac OS X/i.test(ua) ? "Mac"
    : /Linux/i.test(ua) ? "Linux"
    : "Device";
  const browser = /Edg\//i.test(ua) ? "Edge"
    : /Chrome\//i.test(ua) ? "Chrome"
    : /Safari\//i.test(ua) ? "Safari"
    : /Firefox\//i.test(ua) ? "Firefox"
    : "Browser";
  return `${browser} on ${os}`;
}
