import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";

const Patch = z.object({
  blocked: z.boolean().optional(),
  codOnlyBlock: z.boolean().optional(),
  adjustPoints: z.number().int().optional(),
  adjustCredit: z.number().optional(),
  note: z.string().max(300).optional(),
});

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER");
    const body = Patch.parse(await req.json());

    if (body.blocked !== undefined || body.codOnlyBlock !== undefined) {
      await db.user.update({
        where: { id },
        data: {
          ...(body.blocked !== undefined ? { blocked: body.blocked } : {}),
          ...(body.codOnlyBlock !== undefined ? { codOnlyBlock: body.codOnlyBlock } : {}),
        },
      });
      if (body.blocked !== undefined)
        await audit({ uid: s.uid, name: s.name }, body.blocked ? "CUSTOMER_BLOCKED" : "CUSTOMER_UNBLOCKED", "User", id, { note: body.note });
      if (body.codOnlyBlock !== undefined)
        await audit({ uid: s.uid, name: s.name }, "CUSTOMER_COD_RESTRICTED", "User", id, {
          restricted: body.codOnlyBlock,
          note: body.note,
        });
    }
    if (body.adjustPoints) {
      await db.customerProfile.update({
        where: { userId: id },
        data: { loyaltyPoints: { increment: body.adjustPoints } },
      });
      await db.loyaltyTransaction.create({
        data: { userId: id, points: body.adjustPoints, type: "ADJUST", note: body.note ?? "Manual adjustment" },
      });
      await audit({ uid: s.uid, name: s.name }, "POINTS_ADJUSTED", "User", id, { points: body.adjustPoints });
    }
    if (body.adjustCredit) {
      await db.customerProfile.update({
        where: { userId: id },
        data: { storeCredit: { increment: body.adjustCredit } },
      });
      await audit({ uid: s.uid, name: s.name }, "CREDIT_ADJUSTED", "User", id, { amount: body.adjustCredit });
    }
    return NextResponse.json({ ok: true });
  }
);
