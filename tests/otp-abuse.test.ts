import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetOtpAbuse,
  mayRequestOtp,
  recordOtpSend,
  recordOtpVerified,
} from "@/lib/otp-abuse";

/**
 * SMS pumping: someone requests codes for numbers they do not own, purely to
 * spend the shop's credits. Two per send, and the per-number cap in the
 * database never fires because each number is only ever asked once.
 *
 * The tests below encode the distinction the guard rests on — an attacker
 * harvests sends and never comes back with a code, a customer always does — and
 * the constraint that makes it hard: Indian carriers put thousands of real
 * subscribers behind a single address.
 */

const ATTACKER = "203.0.113.9";
const CARRIER = "49.36.0.1";

beforeEach(() => __resetOtpAbuse());

const send = (ip: string, phone: string) => {
  const v = mayRequestOtp(ip, phone);
  if (v.allowed) recordOtpSend(ip, phone);
  return v.allowed;
};

describe("a customer signing in", () => {
  it("is never in the way of themselves", () => {
    expect(send(CARRIER, "+919000000001")).toBe(true);
    recordOtpVerified(CARRIER);
    expect(send(CARRIER, "+919000000001")).toBe(true);
  });

  it("can ask again after a mistyped number", () => {
    expect(send(CARRIER, "+919000000001")).toBe(true);
    expect(send(CARRIER, "+919000000002")).toBe(true);
    expect(send(CARRIER, "+919000000002")).toBe(true);
  });
});

describe("someone harvesting sends", () => {
  it("is stopped once codes go out and none come back", () => {
    // Three unanswered codes is a customer having a bad time. The fourth, with
    // nothing ever verified, is money being spent by someone else.
    expect(send(ATTACKER, "+919000000001")).toBe(true);
    expect(send(ATTACKER, "+919000000002")).toBe(true);
    expect(send(ATTACKER, "+919000000003")).toBe(true);
    expect(send(ATTACKER, "+919000000004")).toBe(false);
  });

  it("cannot walk a long list of numbers", () => {
    recordOtpVerified(ATTACKER); // even with a real sign-in to hide behind
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (send(ATTACKER, `+9190000000${String(i).padStart(2, "0")}`)) allowed++;
    // Bounded by the distinct-number cap long before the hourly one.
    expect(allowed).toBeLessThanOrEqual(5);
  });

  it("gains nothing by repeating one number instead", () => {
    recordOtpVerified(ATTACKER);
    let allowed = 0;
    for (let i = 0; i < 30; i++) if (send(ATTACKER, "+919000000001")) allowed++;
    expect(allowed).toBeLessThanOrEqual(10);
  });

  it("is told nothing about which limit it hit", () => {
    for (let i = 0; i < 5; i++) send(ATTACKER, `+91900000000${i}`);
    const refused = mayRequestOtp(ATTACKER, "+919000000099");
    expect(refused.allowed).toBe(false);
    // One wording for every rule: naming the limit is telling them how to sit
    // underneath it.
    expect(refused.reason).toBe("Too many code requests from here. Try again later.");
  });
});

describe("shared carrier addresses", () => {
  it("are not condemned by one bad actor among thousands", () => {
    /*
     * Jio and Airtel put enormous numbers of subscribers behind single public
     * addresses. A quota alone would lock out real customers in blocks; what
     * saves them is that on a carrier address somebody is always signing in
     * successfully.
     */
    send(CARRIER, "+919000000001");
    recordOtpVerified(CARRIER);
    send(CARRIER, "+919000000002");
    recordOtpVerified(CARRIER);
    send(CARRIER, "+919000000003");

    // A fourth send would trip the unverified rule on an address with no
    // successes. Here it does not.
    expect(mayRequestOtp(CARRIER, "+919000000003").allowed).toBe(true);
  });

  it("still cannot be used to spray a whole list", () => {
    for (let i = 0; i < 10; i++) recordOtpVerified(CARRIER);
    let allowed = 0;
    for (let i = 0; i < 20; i++) if (send(CARRIER, `+9190000001${String(i).padStart(2, "0")}`)) allowed++;
    expect(allowed).toBeLessThanOrEqual(5);
  });
});

describe("addresses are judged separately", () => {
  it("one being blocked does not touch another", () => {
    for (let i = 0; i < 6; i++) send(ATTACKER, `+91900000000${i}`);
    expect(mayRequestOtp(ATTACKER, "+919000000099").allowed).toBe(false);
    expect(mayRequestOtp("49.36.0.99", "+919000000099").allowed).toBe(true);
  });
});

describe("the window", () => {
  it("forgives an hour later", () => {
    vi.useFakeTimers();
    try {
      for (let i = 0; i < 6; i++) send(ATTACKER, `+91900000000${i}`);
      expect(mayRequestOtp(ATTACKER, "+919000000099").allowed).toBe(false);
      vi.advanceTimersByTime(61 * 60 * 1000);
      expect(mayRequestOtp(ATTACKER, "+919000000099").allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a refused send costs nothing", () => {
  it("is not counted against the caller", () => {
    // mayRequestOtp only asks; recordOtpSend is called after the gateway has
    // taken the message. A send the gateway refused spent no credit and must
    // not consume an allowance.
    for (let i = 0; i < 3; i++) mayRequestOtp(ATTACKER, `+91900000000${i}`);
    expect(mayRequestOtp(ATTACKER, "+919000000009").allowed).toBe(true);
  });
});
