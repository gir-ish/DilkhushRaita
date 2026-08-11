import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { STAFF_ROLES } from "@/lib/constants";
import { audit } from "@/lib/audit";

/**
 * Staff accounts.
 *
 * Owner-only throughout: these are the keys to the dashboard, and a branch
 * manager being able to mint a second owner would make the role hierarchy
 * decorative.
 */
async function requireOwner() {
  const s = await requireStaff();
  if (s.role !== "OWNER") throw new HttpError(403, "Only the owner can manage staff accounts");
  return s;
}

/** Roles that can be handed out here. OWNER is not among them — see below. */
const ASSIGNABLE = STAFF_ROLES.filter((r) => r !== "OWNER");

export const GET = handler(async () => {
  await requireOwner();
  const staff = await db.user.findMany({
    where: { role: { in: [...STAFF_ROLES] } },
    orderBy: [{ role: "asc" }, { email: "asc" }],
    select: {
      id: true, email: true, name: true, role: true, blocked: true, createdAt: true,
      // Never select passwordHash or pinHash. Nothing on this screen needs them,
      // and a hash in a JSON response is a hash someone can take away and crack.
      branchAssignments: { select: { branchId: true } },
    },
  });
  const branches = await db.branch.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  return NextResponse.json({
    staff: staff.map((u) => ({ ...u, branchIds: u.branchAssignments.map((b) => b.branchId) })),
    branches,
    assignableRoles: ASSIGNABLE,
  });
});

const Body = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(60),
  role: z.enum(ASSIGNABLE as [string, ...string[]]),
  password: z.string().min(8).max(100),
  branchIds: z.array(z.string()).default([]),
});

export const POST = handler(async (req: Request) => {
  const session = await requireOwner();
  const body = Body.parse(await req.json());
  const email = body.email.toLowerCase();

  const clash = await db.user.findUnique({ where: { email } });
  if (clash) throw new HttpError(409, "An account with that email already exists");

  const user = await db.user.create({
    data: {
      email,
      name: body.name.trim(),
      role: body.role,
      passwordHash: await bcrypt.hash(body.password, 10),
      branchAssignments: { create: body.branchIds.map((branchId) => ({ branchId })) },
    },
  });
  await audit({ uid: session.uid, name: session.name }, "STAFF_CREATED", "User", user.id, {
    email, role: body.role,
  });
  return NextResponse.json({ ok: true, id: user.id });
});
