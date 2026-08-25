import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __bucketCount as bucketCount,
  __resetRateLimits,
  clearIdentityFailures,
  clientIp,
  identityAllowed,
  rateLimit,
  recordIdentityFailure,
} from "@/lib/rate-limit";

const req = (headers: Record<string, string>) => new Request("https://x.test/", { headers });

beforeEach(() => {
  __resetRateLimits();
});

describe("clientIp", () => {
  it("ignores what the caller put at the front of X-Forwarded-For", () => {
    /*
     * The whole vulnerability in one line. A caller writes the left-hand
     * entries itself, so reading position zero lets it mint a new identity per
     * request. With one proxy in front, the address that proxy appended is the
     * last one.
     */
    expect(clientIp(req({ "x-forwarded-for": "203.0.113.9, 198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("still reads a single-entry header", () => {
    expect(clientIp(req({ "x-forwarded-for": "198.51.100.7" }))).toBe("198.51.100.7");
  });

  it("prefers X-Real-IP over nothing, and never returns empty", () => {
    expect(clientIp(req({ "x-real-ip": "198.51.100.7" }))).toBe("198.51.100.7");
    expect(clientIp(req({}))).toBe("local");
    expect(clientIp(req({ "x-forwarded-for": " , ," }))).toBe("local");
  });
});

describe("identity limits", () => {
  const KIND = "staff-login";
  const EMAIL = "owner@example.test";
  const WINDOW = 15 * 60 * 1000;

  it("closes after the allowed number of failures", () => {
    for (let i = 0; i < 10; i++) {
      expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(true);
      recordIdentityFailure(KIND, EMAIL, WINDOW);
    }
    expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(false);
  });

  it("holds however many addresses the attacker rotates through", () => {
    // The regression test for what was proven against production: the same
    // guessing run, spread over a fresh forged address each time, used to sail
    // straight past the cap.
    for (let i = 0; i < 10; i++) {
      const ip = `198.51.100.${i}`;
      expect(rateLimit(`staff-login:${ip}`, 10, WINDOW)).toBe(true); // per-IP never trips
      recordIdentityFailure(KIND, EMAIL, WINDOW);
    }
    expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(false);
  });

  it("treats the address as case- and space-insensitive", () => {
    for (let i = 0; i < 10; i++) recordIdentityFailure(KIND, "  OWNER@Example.test ", WINDOW);
    expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(false);
  });

  it("keeps separate accounts apart", () => {
    for (let i = 0; i < 10; i++) recordIdentityFailure(KIND, EMAIL, WINDOW);
    expect(identityAllowed(KIND, "someone.else@example.test", 10, WINDOW)).toBe(true);
  });

  it("does not let one kind spend another's allowance", () => {
    for (let i = 0; i < 10; i++) recordIdentityFailure("otp-verify", EMAIL, WINDOW);
    expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(true);
  });

  it("forgives a real sign-in, so a typo never locks the owner out", () => {
    for (let i = 0; i < 9; i++) recordIdentityFailure(KIND, EMAIL, WINDOW);
    clearIdentityFailures(KIND, EMAIL);
    for (let i = 0; i < 9; i++) {
      expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(true);
      recordIdentityFailure(KIND, EMAIL, WINDOW);
    }
    expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(true);
  });

  it("forgets failures once the window has passed", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 10; i++) recordIdentityFailure(KIND, EMAIL, WINDOW);
      expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(false);
      vi.advanceTimersByTime(WINDOW + 1);
      expect(identityAllowed(KIND, EMAIL, 10, WINDOW)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("bucket growth", () => {
  it("stays bounded, and cheap, when keys keep changing", () => {
    /*
     * Rotating a header used to add a permanent map entry per request — a slow
     * way to push the process out of memory. The sweep that fixes it must not
     * itself run on every request once the map is full, or a flood turns into
     * a self-inflicted denial of service.
     */
    const started = Date.now();
    for (let i = 0; i < 60_000; i++) rateLimit(`k:${i}`, 5, 60_000);
    const elapsed = Date.now() - started;

    expect(bucketCount()).toBeLessThanOrEqual(25_000);
    // Generous, but an order of magnitude under the ~68s a per-request sweep
    // took: this fails loudly if the sweep ever creeps back into the hot path.
    expect(elapsed).toBeLessThan(5_000);
  });
});
