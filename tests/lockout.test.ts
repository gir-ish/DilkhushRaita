import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetRateLimits,
  clearIdentityFailures,
  identityLock,
  recordFailureWithLockout,
  triesLeft,
} from "@/lib/rate-limit";

/**
 * Three wrong passwords inside five minutes, then two hours shut.
 *
 * The window and the lockout do different jobs and both matter: the window
 * decides how fast someone may guess, the lockout makes the penalty outlast the
 * window it was earned in. Without the second, waiting five minutes and
 * carrying on is a workable strategy.
 */

const KIND = "staff-login";
const WHO = "owner@dilkhush.test";
const MAX = 3;
const WINDOW = 5 * 60 * 1000;
const LOCKOUT = 2 * 60 * 60 * 1000;

const failOnce = () => recordFailureWithLockout(KIND, WHO, MAX, WINDOW, LOCKOUT);

beforeEach(() => __resetRateLimits());

describe("three strikes", () => {
  it("allows two failures, locks on the third", () => {
    expect(failOnce().locked).toBe(false);
    expect(failOnce().locked).toBe(false);
    expect(failOnce().locked).toBe(true);
  });

  it("reports how long is left, in a shape worth showing someone", () => {
    failOnce();
    failOnce();
    const locked = failOnce();
    expect(locked.retryAfterMs).toBe(LOCKOUT);
    expect(Math.round(locked.retryAfterMs / 3_600_000)).toBe(2);
  });

  it("counts down the tries that remain", () => {
    expect(triesLeft(KIND, WHO, MAX, WINDOW)).toBe(3);
    failOnce();
    expect(triesLeft(KIND, WHO, MAX, WINDOW)).toBe(2);
    failOnce();
    expect(triesLeft(KIND, WHO, MAX, WINDOW)).toBe(1);
  });

  it("stays locked well past the five-minute window", () => {
    vi.useFakeTimers();
    try {
      failOnce(); failOnce(); failOnce();
      expect(identityLock(KIND, WHO).locked).toBe(true);

      // The whole point. A sliding window would have forgotten by now, and a
      // patient script would simply resume.
      vi.advanceTimersByTime(WINDOW + 60_000);
      expect(identityLock(KIND, WHO).locked).toBe(true);

      vi.advanceTimersByTime(90 * 60 * 1000);
      expect(identityLock(KIND, WHO).locked).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lifts after the two hours, and does not re-lock on the next failure", () => {
    vi.useFakeTimers();
    try {
      failOnce(); failOnce(); failOnce();
      vi.advanceTimersByTime(LOCKOUT + 1000);
      expect(identityLock(KIND, WHO).locked).toBe(false);
      // The spent count must not still be sitting there, or one wrong password
      // after a two-hour wait would shut the door again immediately.
      expect(failOnce().locked).toBe(false);
      expect(triesLeft(KIND, WHO, MAX, WINDOW)).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forgets failures that fall outside the window", () => {
    vi.useFakeTimers();
    try {
      failOnce();
      failOnce();
      vi.advanceTimersByTime(WINDOW + 1000);
      // Two old failures plus one fresh must not add up to a lockout: someone
      // mistyping twice at breakfast and once at lunch is not an attack.
      expect(failOnce().locked).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a real sign-in clears it", () => {
  it("wipes both the count and the lock", () => {
    failOnce();
    failOnce();
    clearIdentityFailures(KIND, WHO);
    expect(triesLeft(KIND, WHO, MAX, WINDOW)).toBe(3);
    expect(failOnce().locked).toBe(false);
  });

  it("frees an account that was locked", () => {
    failOnce(); failOnce(); failOnce();
    expect(identityLock(KIND, WHO).locked).toBe(true);
    clearIdentityFailures(KIND, WHO);
    expect(identityLock(KIND, WHO).locked).toBe(false);
  });
});

describe("one account's lockout is its own", () => {
  it("does not spill onto anyone else", () => {
    failOnce(); failOnce(); failOnce();
    expect(identityLock(KIND, WHO).locked).toBe(true);
    // A locked-out owner must not take the whole shop's staff down with them.
    expect(identityLock(KIND, "cashier@dilkhush.test").locked).toBe(false);
  });

  it("does not spill across kinds", () => {
    failOnce(); failOnce(); failOnce();
    expect(identityLock("pin-login", WHO).locked).toBe(false);
  });

  it("treats the address case- and space-insensitively", () => {
    failOnce(); failOnce(); failOnce();
    expect(identityLock(KIND, "  OWNER@DilKhush.TEST ").locked).toBe(true);
  });
});
