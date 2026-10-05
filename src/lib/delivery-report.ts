import { parseCsv } from "./contacts-csv";
import { normalizePhone } from "./utils";

/**
 * Reading the gateway's delivery report back in.
 *
 * The API never says whether a message arrived — the panel's report is the
 * only place that knows, and it is a file you download. Feeding it back here
 * turns it into something the next campaign can act on: a number the operator
 * refuses is a number worth not paying to text again.
 *
 * A column of numbers that always fail is the single largest avoidable cost
 * in a campaign. In the report this was built against, ~960 of 3,446 numbers
 * failed on all three attempts with the identical error each time — close to
 * 2,880 credits an outing, spent on handsets that were never going to ring.
 */

export type Outcome = "delivered" | "failed" | "pending";

export interface NumberResult {
  phone: string;
  delivered: number;
  failed: number;
  /** Accepted by the gateway and never resolved either way. */
  pending: number;
  /** The error the operator gave, when it always gave the same one. */
  error: string | null;
  /**
   * Never once delivered, and refused at least once with a reason.
   *
   * Deliberately strict. A number that is only ever "Submitted" is NOT
   * undeliverable — nothing came back about it at all, and treating silence as
   * a refusal would quietly stop texting people who are perfectly reachable.
   */
  undeliverable: boolean;
}

export interface ReportSummary {
  rows: number;
  numbers: number;
  delivered: number;
  failed: number;
  pending: number;
  /** Numbers that failed every time they were tried. */
  undeliverable: NumberResult[];
  /** How many of each error code, for the dashboard. */
  byError: { code: string; numbers: number }[];
}

/** The columns this report uses, lower-cased so the header's case cannot matter. */
const COL = {
  mobile: ["mobile", "number", "msisdn", "phone"],
  status: ["status"],
  error: ["err-code", "errcode", "error", "error code"],
};

function columnIndex(header: string[], names: string[]): number {
  return header.findIndex((h) => names.includes(h.trim().toLowerCase()));
}

/**
 * One row per number, from however many rows the report has for it.
 *
 * Reports repeat a number once per send, so three campaigns to the same
 * person is three lines, and the useful question — "has this ever worked" —
 * can only be answered by looking at all of them together.
 */
export function readDeliveryReport(text: string): ReportSummary {
  const rows = parseCsv(text);
  const empty: ReportSummary = {
    rows: 0,
    numbers: 0,
    delivered: 0,
    failed: 0,
    pending: 0,
    undeliverable: [],
    byError: [],
  };
  if (rows.length < 2) return empty;

  const header = rows[0];
  const iPhone = columnIndex(header, COL.mobile);
  const iStatus = columnIndex(header, COL.status);
  const iError = columnIndex(header, COL.error);
  if (iPhone === -1 || iStatus === -1) return empty;

  const byPhone = new Map<string, NumberResult>();
  let delivered = 0;
  let failed = 0;
  let pending = 0;
  let counted = 0;

  // Only the error codes seen on a number that never delivered are worth
  // counting; a code on a number that worked elsewhere says nothing useful.
  const errorsPerPhone = new Map<string, Set<string>>();

  for (const row of rows.slice(1)) {
    const phone = normalizePhone(row[iPhone] ?? "");
    if (!phone) continue;
    counted++;

    const status = (row[iStatus] ?? "").trim().toLowerCase();
    const code = ((iError === -1 ? "" : row[iError]) ?? "").trim();

    const r =
      byPhone.get(phone) ??
      ({ phone, delivered: 0, failed: 0, pending: 0, error: null, undeliverable: false } as NumberResult);

    if (status.startsWith("deliver")) {
      r.delivered++;
      delivered++;
    } else if (status.startsWith("fail") || status.startsWith("undeliv") || status.startsWith("reject")) {
      r.failed++;
      failed++;
      if (code && code !== "000") {
        const seen = errorsPerPhone.get(phone) ?? new Set<string>();
        seen.add(code);
        errorsPerPhone.set(phone, seen);
      }
    } else {
      // "Submitted", or anything else the vendor invents: accepted, unresolved.
      r.pending++;
      pending++;
    }
    byPhone.set(phone, r);
  }

  const undeliverable: NumberResult[] = [];
  const errorCounts = new Map<string, number>();

  for (const r of byPhone.values()) {
    const codes = errorsPerPhone.get(r.phone);
    r.error = codes && codes.size === 1 ? [...codes][0] : codes && codes.size > 1 ? "mixed" : null;
    r.undeliverable = r.delivered === 0 && r.failed > 0;
    if (r.undeliverable) {
      undeliverable.push(r);
      const key = r.error ?? "unknown";
      errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
    }
  }

  return {
    rows: counted,
    numbers: byPhone.size,
    delivered,
    failed,
    pending,
    undeliverable,
    byError: [...errorCounts.entries()]
      .map(([code, numbers]) => ({ code, numbers }))
      .sort((a, b) => b.numbers - a.numbers),
  };
}
