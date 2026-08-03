import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { allowedBranchIds, handler, requireStaff } from "@/lib/guard";
import { parseJson } from "@/lib/utils";

export const GET = handler(async () => {
  const session = await requireStaff("BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER", "MARKETING");
  const scope = await allowedBranchIds(session);
  const branches = await db.branch.findMany({
    where: scope ? { id: { in: scope } } : {},
    include: { hours: { orderBy: { dayOfWeek: "asc" } } },
  });
  return NextResponse.json({
    branches: branches.map((b) => ({
      ...b,
      serviceablePincodes: parseJson<string[]>(b.serviceablePincodesJson, []),
    })),
  });
});
