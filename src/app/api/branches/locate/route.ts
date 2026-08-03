import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { handler } from "@/lib/guard";
import { checkServiceable, etaMins, isBranchOpen, roadKm, travelMins } from "@/lib/geo";
import { deliveryFeeFor } from "@/lib/pricing";

const Body = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  pincode: z.string().regex(/^\d{6}$/).optional(),
});

/**
 * Given customer coordinates, rank branches by estimated delivery time.
 * Distance is a road estimate (MAPS_PROVIDER=haversine); swap in a routing
 * API by setting MAPS_PROVIDER=google — see docs/API.md.
 */
export const POST = handler(async (req: Request) => {
  const { lat, lng, pincode } = Body.parse(await req.json());
  const branches = await db.branch.findMany({ include: { hours: true } });

  const results = branches.map((b) => {
    const open = isBranchOpen(b, b.hours);
    const distanceKm = roadKm(b.lat, b.lng, lat, lng);
    const svc = checkServiceable(b, { lat, lng, pincode });
    const prep = b.prepTimeMins + (b.busyMode ? b.busyExtraMins : 0);
    return {
      id: b.id,
      slug: b.slug,
      name: b.name,
      address: b.address,
      open: open.open,
      openReason: open.reason ?? null,
      distanceKm,
      travelMins: travelMins(distanceKm),
      etaMins: etaMins(distanceKm, prep),
      deliveryFee: deliveryFeeFor(b, distanceKm, 0, false),
      freeDeliveryAbove: b.freeDeliveryAbove,
      minOrderValue: b.minOrderValue,
      pickupEnabled: b.pickupEnabled,
      deliveryEnabled: b.deliveryEnabled,
      serviceable: svc.serviceable,
      serviceReason: svc.reason ?? null,
    };
  });

  const candidates = results.filter((r) => r.open && r.serviceable);
  const recommended =
    candidates.sort((a, b) => a.etaMins - b.etaMins)[0]?.id ?? null;

  return NextResponse.json({ branches: results, recommendedBranchId: recommended });
});
