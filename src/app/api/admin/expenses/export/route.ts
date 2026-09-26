import { db } from "@/lib/db";
import { handler, HttpError, requireStaff } from "@/lib/guard";
import { istMonthKey, istMonthRange, toCsv } from "@/lib/expenses";

/**
 * The month as a spreadsheet.
 *
 * The book lives here, but an accountant wants a file — and so does anyone
 * who would rather add a column of their own than ask for a feature.
 */
export const GET = handler(async (req: Request) => {
  await requireStaff("OWNER");
  const url = new URL(req.url);
  const month = url.searchParams.get("month") ?? istMonthKey();
  const branchId = url.searchParams.get("branchId");

  const range = istMonthRange(month);
  if (!range) throw new HttpError(400, "Pick a month as YYYY-MM.");

  const rows = await db.expense.findMany({
    where: {
      date: { gte: range.start, lt: range.end },
      ...(branchId === "both" ? { branchId: null } : branchId ? { branchId } : {}),
    },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { branch: { select: { name: true } } },
  });

  const csv = toCsv(
    rows.map((r) => ({
      ...r,
      branchName: r.branch?.name?.replace(/^DilKhush Dhaba\s*[–-]\s*/, "") ?? "Both",
    }))
  );

  return new Response("﻿" + csv, {
    headers: {
      // The BOM above is for Excel, which otherwise reads ₹ and Hindi names
      // as mojibake.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="dilkhush-expenses-${month}.csv"`,
    },
  });
});
