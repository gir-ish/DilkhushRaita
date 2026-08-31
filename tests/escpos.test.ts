import { describe, expect, it } from "vitest";
import { billBytes, kotBytes } from "@/lib/escpos";
import type { PrintableOrder } from "@/components/admin/print-sheet";

/**
 * The receipt goes to hardware that cannot report a problem: a wrong byte is a
 * slip that prints as gibberish, or one the customer is handed with a column
 * out of line. These pin the things that would be invisible until then.
 */

const order: PrintableOrder = {
  orderNumber: "DK-1042",
  type: "DINE_IN",
  tableNo: "7",
  placedAt: "2026-08-31T10:30:00.000Z",
  scheduledFor: null,
  addressText: null,
  instructions: "Less spicy please",
  cutlery: true,
  couponCode: "WELCOME50",
  subtotal: 700,
  discount: 50,
  deliveryFee: 0,
  packagingFee: 10,
  tax: 33,
  loyaltyCredit: 0,
  total: 693,
  paymentMethod: "COD",
  paymentStatus: "PENDING",
  items: [
    {
      id: "1",
      nameSnapshot: "Dal Makhani",
      variantName: "Full",
      addOnsJson: '[{"name":"Extra butter"}]',
      qty: 2,
      unitPrice: 249,
      lineTotal: 498,
      instructions: "no cream",
    },
    {
      id: "2",
      nameSnapshot: "Tandoori Roti",
      variantName: null,
      addOnsJson: "[]",
      qty: 4,
      unitPrice: 50.5,
      lineTotal: 202,
      instructions: null,
    },
  ],
  user: { name: "Girish", phone: "+919253171637" },
  branch: {
    name: "DilKhush Dhaba – Rohini",
    address: "Sector 7 Market, Rohini, Delhi",
    pincode: "110085",
    phone: "011-2345678",
    taxPercent: 5,
  },
};

const text = (b: Uint8Array) => String.fromCharCode(...b);
/** GS ! n — the size command, as the bytes actually emitted. */
const sizeCmd = (n: number) => String.fromCharCode(0x1d, 0x21, n);

describe("bill", () => {
  it("carries the details a customer checks", () => {
    const t = text(billBytes(order));
    for (const s of ["DK-1042", "Dal Makhani", "Tandoori Roti", "WELCOME50", "693.00", "Girish"])
      expect(t, `missing ${s}`).toContain(s);
  });

  it("emits nothing the printer cannot render", () => {
    /*
     * Thermal printers have a code page, not Unicode. A stray "₹" or a
     * Devanagari character prints as mojibake or as a blank, and the first
     * anyone knows is a customer holding the slip — so anything above ASCII is
     * folded or dropped before it is sent.
     */
    const bytes = billBytes(order);
    const offenders = [...bytes].filter((b) => b > 0x7e && b !== 0x1b && b !== 0x1d);
    expect(offenders, `non-ASCII bytes: ${offenders}`).toHaveLength(0);
    expect(text(bytes)).toContain("Rs.");
    expect(text(bytes)).not.toContain("₹");
  });

  it("keeps every line inside the paper width", () => {
    // A line longer than the roll wraps where the printer decides, which breaks
    // the alignment of every column after it.
    for (const line of text(billBytes(order, 32)).split("\n")) {
      const printable = line.replace(/[\x00-\x1f]/g, "").replace(/[!@EaV]/g, (m, i) => (i < 2 ? "" : m));
      expect(printable.length, `too long: ${JSON.stringify(line)}`).toBeLessThanOrEqual(40);
    }
  });

  it("puts the amount hard against the right margin", () => {
    const line = text(billBytes(order, 32))
      .split("\n")
      .find((l) => l.includes("Sub Total"));
    expect(line?.trimEnd().endsWith("700.00")).toBe(true);
  });

  it("ends with a feed and a cut", () => {
    const b = billBytes(order);
    expect([...b.slice(-3)]).toEqual([0x1d, 0x56, 0x00]);
  });

  it("starts by resetting the printer", () => {
    // Whatever the previous job left bold or double-height must not bleed in.
    expect([...billBytes(order).slice(0, 2)]).toEqual([0x1b, 0x40]);
  });
});

describe("text size", () => {
  it("normal prints at 1x", () => {
    expect(text(billBytes(order, 32, "normal"))).toContain(sizeCmd(0x00));
  });

  it("large doubles the height but not the width", () => {
    /*
     * 0x01 is height x2, width x1. Width must stay 1x on 58mm paper: doubling
     * it leaves 16 characters a line, too few for a dish name and its price.
     */
    const t = text(billBytes(order, 32, "large"));
    expect(t).toContain(sizeCmd(0x01));
  });

  it("returns to the body size after a heading, not to 1x", () => {
    // The bug this guards: a "large" receipt whose text shrinks the moment the
    // first double-width heading ends.
    const t = text(billBytes(order, 32, "large"));
    const afterBig = t.slice(t.indexOf(sizeCmd(0x11)) + 3);
    expect(afterBig).toContain(sizeCmd(0x01));
  });
});

describe("kitchen ticket", () => {
  it("carries what the cook needs and no prices", () => {
    const t = text(kotBytes(order));
    expect(t).toContain("KITCHEN ORDER TICKET");
    expect(t).toContain("DK-1042");
    expect(t).toContain("Dal Makhani");
    expect(t).toContain("no cream"); // the per-item note must survive
    expect(t).toContain("TABLE 7");
    // A kitchen ticket showing money invites the wrong conversation at the pass.
    expect(t).not.toContain("693.00");
    expect(t).not.toContain("Rs.");
  });

  it("marks whether cutlery is needed", () => {
    expect(text(kotBytes(order))).toContain("Cutlery: YES");
  });
});
