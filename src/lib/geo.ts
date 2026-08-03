import {
  AVG_DELIVERY_SPEED_KMPH,
  ROAD_DISTANCE_FACTOR,
} from "./constants";
import { parseJson, round2, withinTimeWindow, hhmm } from "./utils";

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/**
 * Estimated road distance. Modular: when MAPS_PROVIDER="google" a Distance
 * Matrix call can replace this estimate (see docs/API.md). Default estimate =
 * straight-line distance x road factor.
 */
export function roadKm(lat1: number, lng1: number, lat2: number, lng2: number) {
  return round2(haversineKm(lat1, lng1, lat2, lng2) * ROAD_DISTANCE_FACTOR);
}

export function travelMins(distanceKm: number) {
  return Math.ceil((distanceKm / AVG_DELIVERY_SPEED_KMPH) * 60);
}

export function etaMins(distanceKm: number, prepMins: number, busyExtra = 0) {
  return prepMins + busyExtra + travelMins(distanceKm);
}

export interface BranchLike {
  lat: number;
  lng: number;
  deliveryRadiusKm: number;
  serviceablePincodesJson: string;
  deliveryEnabled: boolean;
}

export interface ServiceabilityInput {
  lat?: number | null;
  lng?: number | null;
  pincode?: string | null;
}

export interface ServiceabilityResult {
  serviceable: boolean;
  reason?: string;
  distanceKm?: number;
}

/** A location is serviceable if within radius OR its PIN code is whitelisted. */
export function checkServiceable(
  branch: BranchLike,
  loc: ServiceabilityInput
): ServiceabilityResult {
  if (!branch.deliveryEnabled)
    return { serviceable: false, reason: "Delivery is currently disabled at this branch" };

  const pins = parseJson<string[]>(branch.serviceablePincodesJson, []);
  let distanceKm: number | undefined;

  if (loc.lat != null && loc.lng != null) {
    distanceKm = roadKm(branch.lat, branch.lng, loc.lat, loc.lng);
    if (distanceKm <= branch.deliveryRadiusKm) return { serviceable: true, distanceKm };
  }
  if (loc.pincode && pins.includes(loc.pincode)) {
    return { serviceable: true, distanceKm };
  }
  if (distanceKm !== undefined) {
    return {
      serviceable: false,
      distanceKm,
      reason: `Outside the ${branch.deliveryRadiusKm} km delivery area (≈${distanceKm} km away)`,
    };
  }
  if (loc.pincode) {
    return { serviceable: false, reason: `PIN code ${loc.pincode} is not serviceable from this branch` };
  }
  return { serviceable: false, reason: "Provide a delivery location or PIN code" };
}

export interface HoursRow {
  dayOfWeek: number;
  openTime: string;
  closeTime: string;
  closed: boolean;
}

export function isBranchOpen(
  branch: { isOpenOverride: string; onlineOrderingEnabled: boolean },
  hours: HoursRow[],
  now = new Date()
): { open: boolean; reason?: string } {
  if (!branch.onlineOrderingEnabled) return { open: false, reason: "Online ordering paused" };
  if (branch.isOpenOverride === "FORCE_CLOSED") return { open: false, reason: "Temporarily closed" };
  if (branch.isOpenOverride === "FORCE_OPEN") return { open: true };
  const dow = new Date(
    now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" })
  ).getDay();
  const row = hours.find((h) => h.dayOfWeek === dow);
  if (!row) return { open: true }; // no hours configured → assume open
  if (row.closed) return { open: false, reason: "Closed today" };
  const t = hhmm(now);
  return withinTimeWindow(t, row.openTime, row.closeTime)
    ? { open: true }
    : { open: false, reason: `Opens ${row.openTime}–${row.closeTime}` };
}
