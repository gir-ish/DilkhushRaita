import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { STAFF_ROLES } from "@/lib/constants";
import { audit } from "@/lib/audit";

const ASSIGNABLE = STAFF_ROLES.filter((r) => r !== "OWNER");

const Body = z.object({
  name: z.string().min(2).max(60).optional(),
  role: z.enum(ASSIGNABLE as [string, ...string[]]).optional(),
  password: z.string().min(8).max(100).optional(),
  blocked: z.boolean().optional(),
  branchIds: z.array(z.string()).optional(),
});

export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const session = await requireStaff();
    if (session.role !== "OWNER") throw new HttpError(403, "Only the owner can manage staff accounts");

    const target = await db.user.findUnique({ where: { id } });
    if (!target || !STAFF_ROLES.includes(target.role as never))
      throw new HttpError(404, "Staff account not found");

    const body = Body.parse(await req.json());

    /*
     * The owner account is off limits here, in both directions.
     *
     * Editing it from this screen could demote or block the only account that
     * can reach this screen, and there would be no way back in. Owner email and
     * password go through scripts/set-owner.mjs, which is deliberately harder to
     * reach than a button. Promoting someone else to OWNER is refused for the
     * same reason it is not in ASSIGNABLE: a second owner can lock out the first.
     */
    if (target.role === "OWNER")
      throw new HttpError(403, "The owner account is changed with scripts/set-owner.mjs");
    if (target.id === session.uid)
      throw new HttpError(403, "You cannot edit your own account here");

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.role !== undefined) data.role = body.role;
    if (body.blocked !== undefined) data.blocked = body.blocked;
    if (body.password !== undefined) data.passwordHash = await bcrypt.hash(body.password, 10);

    await db.$transaction(async (tx) => {
      if (Object.keys(data).length) await tx.user.update({ where: { id }, data });
      if (body.branchIds) {
        await tx.staffBranchAssignment.deleteMany({ where: { userId: id } });
        for (const branchId of body.branchIds)
          await tx.staffBranchAssignment.create({ data: { userId: id, branchId } });
      }
      // A blocked account's paired devices should stop unlocking anything.
      if (body.blocked === true) await tx.staffDevice.deleteMany({ where: { userId: id } });
    });

    await audit({ uid: session.uid, name: session.name }, "STAFF_UPDATED", "User", id, {
      // Never log the password itself — only that one was set.
      changed: Object.keys({ ...body, password: undefined }).filter((k) => (body as never)[k] !== undefined),
      passwordChanged: body.password !== undefined,
    });
    return NextResponse.json({ ok: true });
  }
);
