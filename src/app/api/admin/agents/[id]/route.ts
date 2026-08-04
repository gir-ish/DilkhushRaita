import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/utils";
import { TERMINAL_STATUSES } from "@/lib/constants";

const Patch = z.object({
  name: z.string().min(2).max(60).optional(),
  phone: z.string().min(10).max(15).optional(),
  vehicle: z.string().max(40).nullish(),
  online: z.boolean().optional(),
  active: z.boolean().optional(),
});

/** Edit a delivery person, or deactivate/restore them. */
export const PATCH = handler(
  async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const s = await requireStaff("BRANCH_MANAGER", "DELIVERY_MANAGER");
    const body = Patch.parse(await req.json());

    const agent = await db.deliveryAgent.findUnique({ where: { id }, include: { user: true } });
    if (!agent) throw new HttpError(404, "Delivery agent not found");

    let phone: string | undefined;
    if (body.phone !== undefined) {
      const p = normalizePhone(body.phone);
      if (!p) throw new HttpError(400, "Enter a valid Indian mobile number");
      if (p !== agent.user.phone) {
        const clash = await db.user.findUnique({ where: { phone: p } });
        if (clash) throw new HttpError(409, "That mobile number is already in use");
      }
      phone = p;
    }

    // Taking someone off duty must not strand orders they are still carrying.
    if (body.active === false) {
      const live = await db.order.count({
        where: { deliveryAgentId: id, status: { notIn: [...TERMINAL_STATUSES] } },
      });
      if (live > 0)
        throw new HttpError(
          409,
          `${agent.user.name ?? "This agent"} still has ${live} order(s) in progress. Reassign them first.`
        );
    }

    await db.$transaction(async (tx) => {
      if (body.name !== undefined || phone !== undefined || body.active !== undefined) {
        await tx.user.update({
          where: { id: agent.userId },
          data: {
            ...(body.name !== undefined ? { name: body.name.trim() } : {}),
            ...(phone !== undefined ? { phone } : {}),
            // Deactivation is a soft block so past deliveries stay attributed.
            ...(body.active !== undefined ? { blocked: !body.active } : {}),
          },
        });
      }
      await tx.deliveryAgent.update({
        where: { id },
        data: {
          ...(body.vehicle !== undefined ? { vehicle: body.vehicle?.trim() || null } : {}),
          ...(body.online !== undefined ? { online: body.online } : {}),
          // A deactivated agent must not stay listed as online.
          ...(body.active === false ? { online: false } : {}),
        },
      });
    });

    await audit({ uid: s.uid, name: s.name }, "AGENT_UPDATED", "DeliveryAgent", id, {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.active !== undefined ? { active: body.active } : {}),
    });
    return NextResponse.json({ ok: true });
  }
);
