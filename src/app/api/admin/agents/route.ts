import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/lib/utils";

export const GET = handler(async () => {
  await requireStaff("BRANCH_MANAGER", "DELIVERY_MANAGER", "CASHIER");
  const agents = await db.deliveryAgent.findMany({
    include: { user: { select: { name: true, phone: true, blocked: true } } },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id,
      name: a.user.name,
      phone: a.user.phone,
      online: a.online,
      vehicle: a.vehicle,
      codHeld: a.codHeld,
      // Agents are deactivated rather than deleted, so their delivery history
      // on past orders stays intact.
      active: !a.user.blocked,
    })),
  });
});

const Body = z.object({
  name: z.string().min(2).max(60),
  phone: z.string().min(10).max(15),
  vehicle: z.string().max(40).nullish(),
});

/** Adds a delivery person. Creates the backing user account too. */
export const POST = handler(async (req: Request) => {
  const s = await requireStaff("BRANCH_MANAGER", "DELIVERY_MANAGER");
  const body = Body.parse(await req.json());

  const phone = normalizePhone(body.phone);
  if (!phone) throw new HttpError(400, "Enter a valid Indian mobile number");

  // User.phone is unique, so an existing holder has to be resolved explicitly
  // rather than silently reassigned.
  const existing = await db.user.findUnique({
    where: { phone },
    include: { deliveryAgent: true },
  });
  if (existing) {
    if (existing.deliveryAgent)
      throw new HttpError(409, `${existing.name ?? "That number"} is already a delivery agent`);
    throw new HttpError(
      409,
      "That mobile number already belongs to another account. Use a different number for this agent."
    );
  }

  const agent = await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        name: body.name.trim(),
        phone,
        // Delivery agents are not in STAFF_ROLES, so this account cannot sign
        // in to the dashboard. No password is set for the same reason.
        role: "DELIVERY_AGENT",
      },
    });
    return tx.deliveryAgent.create({
      data: { userId: user.id, vehicle: body.vehicle?.trim() || null },
    });
  });

  await audit({ uid: s.uid, name: s.name }, "AGENT_CREATED", "DeliveryAgent", agent.id, {
    name: body.name,
    phone,
  });
  return NextResponse.json({ ok: true, agentId: agent.id });
});
