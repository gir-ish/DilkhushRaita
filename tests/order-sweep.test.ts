import { describe, expect, it } from "vitest";
import {
  decideStale,
  istHour,
  MAX_NAGS,
  nagDue,
  NAG_AFTER_MS,
  NAG_EVERY_MS,
  staleCutoff,
  SWEEP_HOUR,
} from "@/lib/order-sweep";

/**
 * The two unattended jobs, decided without a database: chasing an order
 * nobody has accepted, and closing off a day nobody finished.
 *
 * Every time here is written as a UTC instant with the Indian one spelled out
 * beside it, because that is the whole difficulty — the server runs in UTC,
 * the shop runs in IST, and the gap between them is where a Tuesday night
 * order gets filed under Wednesday.
 */

/** 2026-10-26T04:30:00Z is 10:00 in India. */
const ist = (iso: string) => new Date(iso);

describe("what time it is in India", () => {
  it("reads the Indian hour, not the server's", () => {
    expect(istHour(ist("2026-10-26T04:30:00Z"))).toBe(10); // 10:00 IST
    expect(istHour(ist("2026-10-26T18:30:00Z"))).toBe(0); // midnight IST, next day
  });

  it("puts half past midnight in Delhi on the right side of the hour", () => {
    expect(istHour(ist("2026-10-25T19:00:00Z"))).toBe(0); // 00:30 IST on the 26th
  });
});

describe("when the previous day is closed off", () => {
  it("does nothing before the sweep hour", () => {
    // 09:59 IST
    expect(staleCutoff(ist("2026-10-26T04:29:00Z"))).toBeNull();
  });

  it("does nothing in the small hours, while a late kitchen is still working", () => {
    // 02:00 IST — orders from "yesterday" are tonight's service
    expect(staleCutoff(ist("2026-10-25T20:30:00Z"))).toBeNull();
  });

  it("sweeps from the sweep hour onwards", () => {
    const cutoff = staleCutoff(ist("2026-10-26T04:30:00Z")); // 10:00 IST
    expect(cutoff).not.toBeNull();
    // Midnight IST on the 26th is 18:30 UTC on the 25th.
    expect(cutoff?.toISOString()).toBe("2026-10-25T18:30:00.000Z");
  });

  it("still sweeps late in the day, for a dashboard first opened at night", () => {
    const cutoff = staleCutoff(ist("2026-10-26T16:00:00Z")); // 21:30 IST
    expect(cutoff?.toISOString()).toBe("2026-10-25T18:30:00.000Z");
  });

  it("spares today's own orders, however early they were placed", () => {
    const cutoff = staleCutoff(ist("2026-10-26T04:30:00Z"))!;
    const placedAt0030 = ist("2026-10-25T19:00:00Z"); // 00:30 IST today
    expect(placedAt0030.getTime() < cutoff.getTime()).toBe(false);
  });

  it("catches last night's late order", () => {
    const cutoff = staleCutoff(ist("2026-10-26T04:30:00Z"))!;
    const placedAt2330 = ist("2026-10-25T18:00:00Z"); // 23:30 IST yesterday
    expect(placedAt2330.getTime() < cutoff.getTime()).toBe(true);
  });

  it("agrees with the hour it is documented as", () => {
    expect(SWEEP_HOUR).toBe(10);
  });
});

describe("what happens to an order left open", () => {
  it("completes one that was accepted and never ticked off", () => {
    for (const status of ["ACCEPTED", "PREPARING", "READY", "ASSIGNED", "OUT_FOR_DELIVERY"])
      expect(decideStale({ status, paymentStatus: "PENDING" })).toBe("complete");
  });

  it("cancels one nobody ever accepted — it was never cooked", () => {
    expect(decideStale({ status: "PLACED", paymentStatus: "PENDING" })).toBe("cancel");
  });

  it("holds a paid order nobody accepted, because that is a refund decision", () => {
    expect(decideStale({ status: "PLACED", paymentStatus: "PAID" })).toBe("hold");
  });

  it("completes a paid order that was accepted — the money is already right", () => {
    expect(decideStale({ status: "OUT_FOR_DELIVERY", paymentStatus: "PAID" })).toBe("complete");
  });
});

describe("chasing an order nobody has accepted", () => {
  const now = ist("2026-10-26T12:00:00Z");
  const order = (over: Partial<Parameters<typeof nagDue>[0]> = {}) => ({
    placedAt: new Date(now.getTime() - 5 * 60_000),
    nagCount: 0,
    lastNaggedAt: null,
    ...over,
  });

  it("leaves a brand new order alone — the first alert has only just gone", () => {
    expect(nagDue(order({ placedAt: new Date(now.getTime() - 30_000) }), now)).toBe(false);
  });

  it("chases one that has been waiting longer than the first interval", () => {
    expect(nagDue(order({ placedAt: new Date(now.getTime() - NAG_AFTER_MS) }), now)).toBe(true);
  });

  it("waits a full minute between chases", () => {
    const justChased = order({ lastNaggedAt: new Date(now.getTime() - 30_000) });
    expect(nagDue(justChased, now)).toBe(false);
    const dueAgain = order({ lastNaggedAt: new Date(now.getTime() - NAG_EVERY_MS) });
    expect(nagDue(dueAgain, now)).toBe(true);
  });

  it("does not chase twice because two dashboards polled at once", () => {
    const o = order({ lastNaggedAt: new Date(now.getTime() - 1_000) });
    expect(nagDue(o, now)).toBe(false);
    expect(nagDue(o, new Date(now.getTime() + 500))).toBe(false);
  });

  it("gives up after an hour rather than buzzing all night", () => {
    const forgotten = order({
      nagCount: MAX_NAGS,
      lastNaggedAt: new Date(now.getTime() - 10 * 60_000),
    });
    expect(nagDue(forgotten, now)).toBe(false);
  });

  it("is still chasing on the last permitted attempt", () => {
    const nearly = order({
      nagCount: MAX_NAGS - 1,
      lastNaggedAt: new Date(now.getTime() - NAG_EVERY_MS),
    });
    expect(nagDue(nearly, now)).toBe(true);
  });

  it("chases once a minute, for an hour", () => {
    expect(NAG_EVERY_MS).toBe(60_000);
    expect(MAX_NAGS * NAG_EVERY_MS).toBe(60 * 60_000);
  });
});
