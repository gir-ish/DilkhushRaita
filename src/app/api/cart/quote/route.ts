import { NextResponse } from "next/server";
import { z } from "zod";
import { handler } from "@/lib/guard";
import { getSession } from "@/lib/session";
import { buildQuote } from "@/lib/quote";

const Body = z.object({
  branchId: z.string(),
  orderType: z.enum(["DELIVERY", "PICKUP"]),
  items: z
    .array(
      z.object({
        menuItemId: z.string(),
        variantId: z.string().nullish(),
        addOnIds: z.array(z.string()).max(10).optional(),
        qty: z.number().int().min(1).max(20),
        instructions: z.string().max(300).nullish(),
      })
    )
    .min(1)
    .max(50),
  addressId: z.string().nullish(),
  couponCode: z.string().max(30).nullish(),
  redeemPoints: z.boolean().optional(),
  paymentMethod: z.enum(["COD", "ONLINE"]).optional(),
  scheduledFor: z.string().nullish(),
});

/** Server-priced cart preview. Never trusts client prices. */
export const POST = handler(async (req: Request) => {
  const body = Body.parse(await req.json());
  const session = await getSession();
  const userId = session?.role === "CUSTOMER" ? session.uid : null;
  const quote = await buildQuote(body, userId, false);
  return NextResponse.json({ quote });
});
