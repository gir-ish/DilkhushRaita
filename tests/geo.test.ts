import { describe, expect, it } from "vitest";
import { checkServiceable, haversineKm, roadKm } from "@/lib/geo";

const branch = {
  lat: 28.7365,
  lng: 77.112,
  deliveryRadiusKm: 7,
  serviceablePincodesJson: JSON.stringify(["110085", "110086"]),
  deliveryEnabled: true,
};

describe("geo", () => {
  it("haversine distance is roughly correct (Rohini→NSP ≈ 6.2km straight-line)", () => {
    const d = haversineKm(28.7365, 77.112, 28.6929, 77.1512);
    expect(d).toBeGreaterThan(5);
    expect(d).toBeLessThan(8);
  });

  it("road distance applies factor", () => {
    expect(roadKm(28.7365, 77.112, 28.6929, 77.1512)).toBeGreaterThan(
      haversineKm(28.7365, 77.112, 28.6929, 77.1512)
    );
  });

  it("within radius is serviceable", () => {
    const r = checkServiceable(branch, { lat: 28.74, lng: 77.12 });
    expect(r.serviceable).toBe(true);
  });

  it("outside radius but whitelisted PIN is serviceable", () => {
    const r = checkServiceable(branch, { lat: 28.5, lng: 77.3, pincode: "110086" });
    expect(r.serviceable).toBe(true);
  });

  it("outside radius and unknown PIN is rejected with reason", () => {
    const r = checkServiceable(branch, { lat: 28.5, lng: 77.3, pincode: "110001" });
    expect(r.serviceable).toBe(false);
    expect(r.reason).toBeTruthy();
  });

  it("delivery disabled blocks everything", () => {
    const r = checkServiceable({ ...branch, deliveryEnabled: false }, { lat: 28.7365, lng: 77.112 });
    expect(r.serviceable).toBe(false);
  });
});
