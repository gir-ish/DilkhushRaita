import { istDate, istTime, parseJson } from "./utils";
import type { PrintableOrder } from "@/components/admin/print-sheet";

/**
 * Renders a bill or kitchen ticket as ESC/POS — the command language thermal
 * printers speak natively.
 *
 * This exists to get rid of a line of someone else's advertising. Printing from
 * a phone went through Android's print dialog into RawBT, whose free build
 * stamps "RawBT app is free" onto every slip handed to a customer. Nothing in
 * the markup could remove it, because the app adds it after the page is gone.
 *
 * Talking to the printer directly removes the app from the path entirely: the
 * browser sends these bytes over Bluetooth and the printer prints exactly them.
 * It is also faster and sharper than rasterising a web page, because the
 * printer renders its own built-in font rather than a picture of ours.
 */

const ESC = 0x1b;
const GS = 0x1d;

/** 58mm paper fits 32 characters of the standard font; 80mm fits 48. */
export type PaperWidth = 32 | 48;

/**
 * How big the body text prints.
 *
 * "large" doubles the HEIGHT only. That is the one enlargement 58mm paper can
 * afford: characters stay the same width, so 32 still fit on a line and every
 * column keeps its place, while the text becomes twice as tall and readable at
 * arm's length. Doubling the width instead would leave 16 characters a line,
 * which is not enough for a dish name and a price side by side.
 *
 * It costs paper — a bill runs roughly half again as long.
 */
export type TextScale = "normal" | "large";

class Builder {
  private parts: number[] = [];

  constructor(
    private width: PaperWidth,
    private scale: TextScale = "normal"
  ) {}

  /** GS ! n — the low nibble is height, the high nibble width; 0 means 1x. */
  private size(w: 1 | 2, h: 1 | 2) {
    return this.raw(GS, 0x21, ((w - 1) << 4) | (h - 1));
  }

  /** Back to whatever this receipt's body size is, which is not always 1x. */
  base() {
    return this.size(1, this.scale === "large" ? 2 : 1);
  }

  raw(...bytes: number[]) {
    this.parts.push(...bytes);
    return this;
  }

  /**
   * Printers ship with a code page, not Unicode. Devanagari and emoji come out
   * as mojibake or as nothing, so they are folded to ASCII here rather than
   * left to the hardware to mangle — "₹" in particular, which is the one that
   * would appear on every line of every bill.
   */
  text(s: string) {
    const ascii = s
      .replace(/₹/g, "Rs.")
      .replace(/[–—]/g, "-")
      .replace(/[’‘]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/·/g, "-")
      // Anything still outside printable ASCII is dropped rather than guessed at.
      .replace(/[^\x20-\x7E\n]/g, "");
    for (let i = 0; i < ascii.length; i++) this.parts.push(ascii.charCodeAt(i));
    return this;
  }

  line(s = "") {
    return this.text(s).raw(0x0a);
  }

  /** A full-width rule. Solid for section breaks, dotted between items. */
  rule(char = "-") {
    return this.line(char.repeat(this.width));
  }

  align(a: "left" | "center" | "right") {
    return this.raw(ESC, 0x61, a === "left" ? 0 : a === "center" ? 1 : 2);
  }

  bold(on: boolean) {
    return this.raw(ESC, 0x45, on ? 1 : 0);
  }

  /**
   * Double width AND height, for the order number and the grand total. Turning
   * it off returns to the body size rather than to 1x, so a heading in a
   * "large" receipt does not silently shrink everything after it.
   */
  big(on: boolean) {
    return on ? this.size(2, 2) : this.base();
  }

  /** Label on the left, value hard against the right margin. */
  pair(label: string, value: string) {
    const room = this.width - label.length - value.length;
    return this.line(room >= 1 ? label + " ".repeat(room) + value : `${label} ${value}`);
  }

  /** Wraps at the paper width so a long dish name is never cut off mid-word. */
  wrapped(s: string, indent = 0) {
    const room = this.width - indent;
    const pad = " ".repeat(indent);
    let cur = "";
    for (const word of s.split(/\s+/).filter(Boolean)) {
      if (!cur.length) cur = word;
      else if (cur.length + 1 + word.length <= room) cur += " " + word;
      else {
        this.line(pad + cur);
        cur = word;
      }
    }
    if (cur.length) this.line(pad + cur);
    return this;
  }

  /** Feed clear of the tear bar, then cut if the printer has a cutter. */
  end() {
    return this.raw(0x0a, 0x0a, 0x0a, 0x0a).raw(GS, 0x56, 0x00);
  }

  bytes(): Uint8Array {
    return new Uint8Array(this.parts);
  }
}

const money = (n: number) => n.toFixed(2);
const addOnsOf = (json: string) => parseJson<{ name: string }[]>(json, []);

const TYPE_LABEL: Record<string, string> = {
  DELIVERY: "Delivery",
  PICKUP: "Self-pickup",
  DINE_IN: "Dine-in",
  PARCEL: "Parcel",
};

/** The customer's bill, byte for byte what the printer will render. */
export function billBytes(
  order: PrintableOrder,
  width: PaperWidth = 32,
  scale: TextScale = "normal"
): Uint8Array {
  const b = new Builder(width, scale);
  b.raw(ESC, 0x40); // reset: clears whatever the last job left set
  b.base(); // ESC @ returns to 1x, so the body size has to be re-applied

  b.align("center").bold(true).big(true);
  b.line("DilKhush Dhaba");
  b.big(false);
  b.line("Raita Wala");
  b.bold(false);
  if (order.branch.name) b.wrapped(order.branch.name);
  if (order.branch.address)
    b.wrapped(order.branch.address + (order.branch.pincode ? `, ${order.branch.pincode}` : ""));
  if (order.branch.phone) b.line(`Ph: ${order.branch.phone}`);
  b.line("dilkhushraita.com");

  b.rule("=");
  b.bold(true).line(order.paymentStatus === "PAID" ? "TAX INVOICE" : "BILL").bold(false);
  b.rule("=");

  b.align("left");
  b.pair("Bill No", order.orderNumber);
  b.pair("Date", istDate(order.placedAt));
  b.pair("Time", istTime(order.placedAt));
  b.pair(
    "Order",
    (TYPE_LABEL[order.type] ?? order.type) + (order.tableNo ? ` - T${order.tableNo}` : "")
  );
  b.pair("Customer", (order.user.name ?? "Walk-in").slice(0, 18));
  if (order.user.phone) b.pair("Mobile", order.user.phone);
  if (order.type === "DELIVERY" && order.addressText) b.wrapped(`Addr: ${order.addressText}`);

  b.rule();
  b.bold(true).pair("ITEM", "AMOUNT").bold(false);
  b.rule();

  for (const it of order.items) {
    b.wrapped(it.nameSnapshot);
    if (it.variantName) b.wrapped(`(${it.variantName})`, 2);
    const addOns = addOnsOf(it.addOnsJson);
    if (addOns.length) b.wrapped(`+ ${addOns.map((a) => a.name).join(", ")}`, 2);
    // Quantity and rate on the left, line total right — the two numbers anyone
    // actually checks against the menu board.
    b.pair(`  ${it.qty} x ${money(it.unitPrice)}`, money(it.lineTotal));
  }

  b.rule();
  b.pair("Sub Total", money(order.subtotal));
  if (order.discount > 0)
    b.pair(`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`, `-${money(order.discount)}`);
  if (order.loyaltyCredit > 0) b.pair("Loyalty credit", `-${money(order.loyaltyCredit)}`);
  if (order.packagingFee > 0) b.pair("Packaging", money(order.packagingFee));
  if (order.deliveryFee > 0) b.pair("Delivery", money(order.deliveryFee));
  if (order.tax > 0)
    b.pair(`GST${order.branch.taxPercent ? ` @ ${order.branch.taxPercent}%` : ""}`, money(order.tax));

  b.rule("=");
  b.bold(true).big(true);
  // Double-width halves how much fits, so this pair is laid out by hand.
  const total = money(order.total);
  const half = Math.floor(width / 2);
  const gap = Math.max(1, half - "TOTAL".length - total.length);
  b.line("TOTAL" + " ".repeat(gap) + total);
  b.big(false).bold(false);
  b.rule("=");

  b.bold(true)
    .pair("Paid by", `${order.paymentMethod === "COD" ? "CASH" : order.paymentMethod} ${order.paymentStatus}`)
    .bold(false);
  b.pair("Items", String(order.items.reduce((s, i) => s + i.qty, 0)));

  if (order.instructions) {
    b.rule();
    b.wrapped(`Note: ${order.instructions}`);
  }

  b.rule();
  b.align("center");
  b.bold(true).line("THANK YOU").bold(false);
  b.line("Please visit again!");
  const saved = order.discount + order.loyaltyCredit;
  if (saved > 0) b.wrapped(`You saved Rs.${money(saved)} on this order`);
  // 33 characters would wrap onto a line of its own reading "l".
  b.wrapped("This is a computer generated bill.");

  return b.end().bytes();
}

/** The kitchen ticket: what to cook, in the largest type that fits. */
export function kotBytes(
  order: PrintableOrder,
  width: PaperWidth = 32,
  scale: TextScale = "normal"
): Uint8Array {
  const b = new Builder(width, scale);
  b.raw(ESC, 0x40);
  b.base();

  b.align("center").bold(true);
  b.line("KITCHEN ORDER TICKET");
  b.big(true).line(order.orderNumber).big(false);
  b.line((TYPE_LABEL[order.type] ?? order.type) + (order.tableNo ? ` - TABLE ${order.tableNo}` : ""));
  b.bold(false);
  b.line(`${istDate(order.placedAt)} ${istTime(order.placedAt)}`);
  if (order.scheduledFor)
    b.bold(true).line(`SCHEDULED ${istDate(order.scheduledFor)} ${istTime(order.scheduledFor)}`).bold(false);

  b.rule("=");
  b.align("left");

  for (const it of order.items) {
    b.bold(true).big(true).line(`${it.qty}x`).big(false);
    b.wrapped(it.nameSnapshot);
    b.bold(false);
    if (it.variantName) b.wrapped(`(${it.variantName})`, 2);
    const addOns = addOnsOf(it.addOnsJson);
    if (addOns.length) b.wrapped(`+ ${addOns.map((a) => a.name).join(", ")}`, 2);
    // The line the cook must not miss, so it gets the emphasis.
    if (it.instructions) b.bold(true).wrapped(`** ${it.instructions}`, 2).bold(false);
    b.rule(".");
  }

  if (order.instructions) {
    b.bold(true).wrapped(`NOTE: ${order.instructions}`).bold(false);
    b.rule();
  }

  b.align("center").line(`Cutlery: ${order.cutlery ? "YES" : "NO"}`);
  return b.end().bytes();
}
