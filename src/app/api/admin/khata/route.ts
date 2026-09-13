import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler, requireStaff } from "@/lib/guard";
import { khataBand, khataDues, khataLimits } from "@/lib/khata";

/**
 * Everyone who owes the shop, most first, and the total outstanding — the
 * "who has khata" list at the counter. ?q= narrows it to a name or number.
 */
export const GET = handler(async (req: Request) => {
  await requireStaff("BRANCH_MANAGER", "CASHIER");
  const q = new URL(req.url).searchParams.get("q")?.trim() ?? "";
  const [dues, limits] = await Promise.all([khataDues(), khataLimits()]);
  const owing = [...dues].filter(([, d]) => d > 0);
  const users = await db.user.findMany({
    where: { id: { in: owing.map(([id]) => id) } },
    select: { id: true, name: true, phone: true },
  });
  const digits = q.replace(/\D/g, "");
  const rows = users
    .filter(
      (u) =>
        !q ||
        (u.name ?? "").toLowerCase().includes(q.toLowerCase()) ||
        (digits.length >= 3 && (u.phone ?? "").includes(digits))
    )
    .map((u) => ({ ...u, due: dues.get(u.id)!, band: khataBand(dues.get(u.id)!, limits) }))
    .sort((a, b) => b.due - a.due);
  return NextResponse.json({
    customers: rows,
    totalDue: Math.round(owing.reduce((s, [, d]) => s + d, 0) * 100) / 100,
    count: owing.length,
    limits,
  });
});
