import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, HttpError, requireStaff } from "@/lib/guard";
import { BranchPatch } from "@/lib/validation";
import { audit } from "@/lib/audit";

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireStaff("BRANCH_MANAGER");
    const scope = await allowedBranchIds(session);
    if (scope && !scope.includes(id))
      throw new HttpError(403, "You can only manage your own branch");

    const body = BranchPatch.parse(await req.json());
    const { serviceablePincodes, hours, ...rest } = body;

    await db.$transaction(async (tx) => {
      await tx.branch.update({
        where: { id },
        data: {
          ...rest,
          ...(serviceablePincodes
            ? { serviceablePincodesJson: JSON.stringify(serviceablePincodes) }
            : {}),
        },
      });
      if (hours) {
        for (const h of hours) {
          await tx.branchHours.upsert({
            where: { branchId_dayOfWeek: { branchId: id, dayOfWeek: h.dayOfWeek } },
            create: { ...h, branchId: id },
            update: { openTime: h.openTime, closeTime: h.closeTime, closed: h.closed },
          });
        }
      }
    });

    const action =
      body.isOpenOverride === "FORCE_CLOSED"
        ? "BRANCH_CLOSED"
        : body.busyMode !== undefined
          ? "BRANCH_BUSY_MODE"
          : "BRANCH_UPDATED";
    await audit({ uid: session.uid, name: session.name }, action, "Branch", id, body);

    const branch = await db.branch.findUnique({ where: { id }, include: { hours: true } });
    return NextResponse.json({ ok: true, branch });
  }
);
