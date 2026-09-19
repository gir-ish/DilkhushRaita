import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { invalidatePaymentRules, paymentSettingsRow } from "@/lib/payment-rules";
import { onlinePaymentsEnabled } from "@/lib/payments";

/** How customers may pay on the website. Read by staff, changed by managers. */
export const GET = handler(async () => {
  await requireStaff("BRANCH_MANAGER", "CASHIER");
  const row = await paymentSettingsRow();
  return NextResponse.json({
    codEnabled: row.codEnabled,
    onlineEnabled: row.onlineEnabled,
    codMaxOrderValue: row.codMaxOrderValue,
    codFrom: row.codFrom,
    codTo: row.codTo,
    // Without a gateway configured, "online" cannot be offered whatever this says.
    onlineConfigured: onlinePaymentsEnabled(),
  });
});

const time = z.string().regex(/^\d{2}:\d{2}$/, "Use HH:mm");
const Body = z.object({
  codEnabled: z.boolean(),
  onlineEnabled: z.boolean(),
  codMaxOrderValue: z.number().min(1).max(1_000_000).nullish(),
  codFrom: time.nullish(),
  codTo: time.nullish(),
});

export const PUT = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER");
  const body = Body.parse(await req.json());

  // One of the two has to be open, or the website takes no orders at all.
  if (!body.codEnabled && !(body.onlineEnabled && onlinePaymentsEnabled()))
    throw new HttpError(400, "Leave at least one payment method on, or customers cannot order at all");
  // A window needs both ends; one alone would mean nothing.
  if (!!body.codFrom !== !!body.codTo) throw new HttpError(400, "Give both a start and an end time for cash, or neither");
  if (body.codFrom && body.codFrom === body.codTo) throw new HttpError(400, "The cash window starts and ends at the same time");

  const before = await paymentSettingsRow();
  const data = {
    codEnabled: body.codEnabled,
    onlineEnabled: body.onlineEnabled,
    codMaxOrderValue: body.codMaxOrderValue ?? null,
    codFrom: body.codFrom ?? null,
    codTo: body.codTo ?? null,
  };
  await db.paymentSettings.update({ where: { id: "singleton" }, data });
  invalidatePaymentRules();
  await audit({ uid: s.uid, name: s.name }, "PAYMENT_SETTINGS_CHANGED", "PaymentSettings", "singleton", {
    from: {
      codEnabled: before.codEnabled,
      onlineEnabled: before.onlineEnabled,
      codMaxOrderValue: before.codMaxOrderValue,
      codFrom: before.codFrom,
      codTo: before.codTo,
    },
    to: data,
  });
  return NextResponse.json({ ok: true, ...data, onlineConfigured: onlinePaymentsEnabled() });
});
