import { NextResponse } from "next/server";
import { handler, requireStaff } from "@/lib/guard";
import { canRepriceLines } from "@/lib/pricing-authority";

/**
 * Who is signed in, and what they are allowed to do.
 *
 * The dashboard has until now let the API answer that by refusing things,
 * which is right for safety and wrong for a screen: a button that is offered
 * and then fails is worse than one that was never there. This says up front
 * what to offer, while every route still decides for itself what to allow —
 * the answer here is for drawing, never for permitting.
 */
export const GET = handler(async () => {
  const s = await requireStaff();
  return NextResponse.json({
    name: s.name ?? null,
    role: s.role,
    can: {
      /** Charge something other than the menu price for one line. */
      repriceLines: canRepriceLines(s.role),
    },
  });
});
