import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { hashDeviceToken, readDeviceToken } from "@/lib/staff-device";
import { audit } from "@/lib/audit";

/**
 * Browsers that can unlock this account with a PIN.
 *
 * Owner-only, because these devices belong to the owner account and listing
 * them tells you where that account is signed in.
 */
export const GET = handler(async () => {
  const session = await requireStaff();
  if (session.role !== "OWNER") throw new HttpError(403, "Owner only");

  const token = await readDeviceToken();
  const currentHash = token ? hashDeviceToken(token) : null;

  const devices = await db.staffDevice.findMany({
    where: { userId: session.uid },
    orderBy: { lastUsedAt: "desc" },
  });

  return NextResponse.json({
    // Whether THIS browser has a PIN — never the PIN or its hash. Decides
    // whether the screen offers "set" or "change".
    hasPin: devices.some((d) => currentHash != null && d.tokenHash === currentHash && !!d.pinHash),
    onThisDevice: currentHash != null && devices.some((d) => d.tokenHash === currentHash),
    devices: devices.map((d) => ({
      id: d.id,
      label: d.label || "Unknown device",
      lastUsedAt: d.lastUsedAt,
      createdAt: d.createdAt,
      current: currentHash != null && d.tokenHash === currentHash,
      hasPin: !!d.pinHash,
    })),
  });
});

/** Unpair every browser, including this one. The nuclear option for a lost phone. */
export const DELETE = handler(async () => {
  const session = await requireStaff();
  if (session.role !== "OWNER") throw new HttpError(403, "Owner only");

  const { count } = await db.staffDevice.deleteMany({ where: { userId: session.uid } });
  await audit({ uid: session.uid, name: session.name }, "STAFF_DEVICES_REVOKED", "User", session.uid, { count });
  return NextResponse.json({ ok: true, removed: count });
});
