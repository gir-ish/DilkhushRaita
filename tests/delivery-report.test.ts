import { describe, expect, it } from "vitest";
import { readDeliveryReport } from "@/lib/delivery-report";

const header = '"Mobile","Message","Sender","Credits","Send Time","Deliverd Time","Status","Err-Code","DLT Param"';
const row = (phone: string, status: string, err = "") =>
  `"${phone}","msg","DlLKUS","1.00","05/Oct/2026 04:20 pm","","${status}","${err}","tid=1"`;

describe("readDeliveryReport", () => {
  it("counts each outcome", () => {
    const r = readDeliveryReport(
      [header, row("919876543210", "Delivered", "000"), row("919876543211", "Failed", "009"), row("919876543212", "Submitted")].join("\n")
    );
    expect(r.rows).toBe(3);
    expect(r.numbers).toBe(3);
    expect(r.delivered).toBe(1);
    expect(r.failed).toBe(1);
    expect(r.pending).toBe(1);
  });

  it("marks a number that never once delivered", () => {
    const r = readDeliveryReport(
      [header, row("919876543210", "Failed", "009"), row("919876543210", "Failed", "009")].join("\n")
    );
    expect(r.undeliverable).toHaveLength(1);
    expect(r.undeliverable[0]).toMatchObject({ phone: "+919876543210", failed: 2, error: "009" });
  });

  it("spares a number that worked even once", () => {
    // Two failures and one success is a number worth keeping: the operator
    // reached it, so the failures were about the moment, not the handset.
    const r = readDeliveryReport(
      [header, row("919876543210", "Failed", "009"), row("919876543210", "Delivered", "000"), row("919876543210", "Failed", "009")].join("\n")
    );
    expect(r.undeliverable).toHaveLength(0);
  });

  it("never marks a number that only ever sat at Submitted", () => {
    // Nothing came back about these at all. Treating silence as a refusal
    // would quietly stop texting people who are perfectly reachable.
    const r = readDeliveryReport(
      [header, row("919876543210", "Submitted"), row("919876543210", "Submitted")].join("\n")
    );
    expect(r.undeliverable).toHaveLength(0);
    expect(r.pending).toBe(2);
  });

  it("records the error only when it is always the same", () => {
    const same = readDeliveryReport([header, row("919876543210", "Failed", "009"), row("919876543210", "Failed", "009")].join("\n"));
    expect(same.undeliverable[0].error).toBe("009");
    const differs = readDeliveryReport([header, row("919876543211", "Failed", "009"), row("919876543211", "Failed", "002")].join("\n"));
    expect(differs.undeliverable[0].error).toBe("mixed");
  });

  it("normalises however the number is written", () => {
    const r = readDeliveryReport([header, row("+91 98765 43210", "Failed", "009")].join("\n"));
    expect(r.undeliverable[0].phone).toBe("+919876543210");
  });

  it("ignores a row whose number is not an Indian mobile", () => {
    const r = readDeliveryReport([header, row("442086387868", "Failed", "009"), row("919876543210", "Delivered", "000")].join("\n"));
    expect(r.rows).toBe(1);
    expect(r.numbers).toBe(1);
  });

  it("groups the error codes for the summary", () => {
    const r = readDeliveryReport(
      [header, row("919876543210", "Failed", "009"), row("919876543211", "Failed", "009"), row("919876543212", "Failed", "002")].join("\n")
    );
    expect(r.byError).toEqual([
      { code: "009", numbers: 2 },
      { code: "002", numbers: 1 },
    ]);
  });

  it("is empty for a file that is not a report", () => {
    expect(readDeliveryReport("hello\nworld").numbers).toBe(0);
    expect(readDeliveryReport("").numbers).toBe(0);
  });
});
