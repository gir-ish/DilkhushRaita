import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";

export const GET = handler(async () => {
  await requireStaff("BRANCH_MANAGER", "DELIVERY_MANAGER", "CASHIER");
  const agents = await db.deliveryAgent.findMany({
    include: { user: { select: { name: true, phone: true } } },
  });
  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id,
      name: a.user.name,
      phone: a.user.phone,
      online: a.online,
    })),
  });
});
