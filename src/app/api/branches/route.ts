import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { handler } from "@/lib/guard";
import { checkServiceable, isBranchOpen } from "@/lib/geo";
import { parseJson } from "@/lib/utils";

/** Public branch list. Optional ?pincode= checks serviceability per branch. */
export const GET = handler(async (req: Request) => {
  const url = new URL(req.url);
  const pincode = url.searchParams.get("pincode");

  const branches = await db.branch.findMany({ include: { hours: true } });
  const out = branches.map((b) => {
    const open = isBranchOpen(b, b.hours);
    const svc = pincode ? checkServiceable(b, { pincode }) : null;
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      address: b.address,
      phone: b.phone,
      lat: b.lat,
      lng: b.lng,
      open: open.open,
      openReason: open.reason ?? null,
      deliveryEnabled: b.deliveryEnabled,
      pickupEnabled: b.pickupEnabled,
      busyMode: b.busyMode,
      minOrderValue: b.minOrderValue,
      baseDeliveryFee: b.baseDeliveryFee,
      freeDeliveryAbove: b.freeDeliveryAbove,
      prepTimeMins: b.prepTimeMins + (b.busyMode ? b.busyExtraMins : 0),
      serviceablePincodes: parseJson<string[]>(b.serviceablePincodesJson, []),
      serviceable: svc ? svc.serviceable : null,
      serviceReason: svc?.reason ?? null,
    };
  });
  return NextResponse.json({ branches: out });
});
