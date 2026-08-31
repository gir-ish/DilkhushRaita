"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { inr, istDate, istTime, parseJson } from "@/lib/utils";
import { BluetoothPrint } from "./bluetooth-print";

/**
 * Exactly the fields a bill or kitchen ticket prints — nothing else.
 *
 * Deliberately narrower than AdminOrder so the customer's order page can print
 * the same bill without inventing staff-only fields (staffNotes, prepTimeMins)
 * that it has no business knowing. AdminOrder satisfies this structurally, so
 * the dashboard passes its orders through unchanged.
 */
export interface PrintableOrder {
  orderNumber: string;
  type: string;
  tableNo: string | null;
  placedAt: string;
  scheduledFor: string | null;
  addressText: string | null;
  instructions: string | null;
  cutlery: boolean;
  couponCode: string | null;
  subtotal: number;
  discount: number;
  deliveryFee: number;
  packagingFee: number;
  tax: number;
  loyaltyCredit: number;
  total: number;
  paymentMethod: string;
  paymentStatus: string;
  items: {
    id: string;
    nameSnapshot: string;
    variantName: string | null;
    addOnsJson: string;
    qty: number;
    unitPrice: number;
    lineTotal: number;
    instructions: string | null;
  }[];
  user: { name: string | null; phone: string | null };
  branch: {
    name: string;
    address?: string;
    pincode?: string;
    phone?: string;
    taxPercent?: number;
  };
}

const TYPE_LABEL: Record<string, string> = {
  DINE_IN: "Dine-in",
  PICKUP: "Self-pickup",
  DELIVERY: "Delivery",
};

/** Two decimals, no symbol — money in a bill column has to line up. */
const amt = (n: number) =>
  n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const addOnsOf = (json: string) => parseJson<{ name: string; price: number }[]>(json, []);

/** A dashed rule, the way a thermal printer draws one. */
function Rule({ solid }: { solid?: boolean }) {
  return (
    <div
      className={`my-1.5 border-t ${solid ? "border-double border-t-[3px]" : "border-dashed"} border-black/40`}
    />
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${bold ? "font-bold" : ""}`}>
      <span className="whitespace-nowrap">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

/* -------------------------------------------------------------- the bill */

function Bill({ order }: { order: PrintableOrder }) {
  const fees = order.deliveryFee + order.packagingFee;
  const off = order.discount + order.loyaltyCredit;

  return (
    <div className="font-mono text-[11.5px] leading-[1.45] text-black">
      <header className="text-center">
        <div className="text-2xl leading-none" aria-hidden>
          🥘
        </div>
        <div className="mt-1 text-[17px] font-bold tracking-[0.12em]">DILKHUSH DHABA</div>
        <div className="text-[12px] font-bold tracking-[0.3em]">RAITA WALA</div>
        <div className="mt-1.5 font-bold uppercase">
          {order.branch.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
        </div>
        {order.branch.address && (
          <div className="mx-auto max-w-[46ch]">
            {order.branch.address}
            {order.branch.pincode ? ` - ${order.branch.pincode}` : ""}
          </div>
        )}
        {order.branch.phone && <div>Ph: {order.branch.phone}</div>}
        <div>dilkhushraita.com</div>
      </header>

      <Rule solid />

      <div className="text-center text-[12px] font-bold tracking-[0.2em]">
        {order.paymentStatus === "PAID" ? "TAX INVOICE" : "BILL"}
      </div>

      <Rule />

      <div className="space-y-0.5">
        <Row label="Bill No" value={order.orderNumber} />
        {/* Date and time are split so neither can be mistaken for the other, and
            both are IST regardless of the machine doing the printing. */}
        <Row label="Date" value={istDate(order.placedAt)} />
        <Row label="Time" value={istTime(order.placedAt)} />
        <Row
          label="Order"
          value={
            TYPE_LABEL[order.type] +
            (order.tableNo ? ` · Table ${order.tableNo}` : "")
          }
        />
        <Row label="Customer" value={order.user.name ?? "Walk-in"} />
        {order.user.phone && <Row label="Mobile" value={order.user.phone} />}
        {order.type === "DELIVERY" && order.addressText && (
          <div className="flex justify-between gap-3">
            <span className="whitespace-nowrap">Address</span>
            <span className="text-right">{order.addressText}</span>
          </div>
        )}
      </div>

      <Rule />

      <table className="w-full">
        <thead>
          <tr className="text-left align-bottom">
            <th className="pb-1 font-bold">ITEM</th>
            <th className="pb-1 pl-2 text-right font-bold">QTY</th>
            <th className="pb-1 pl-2 text-right font-bold">RATE</th>
            <th className="pb-1 pl-2 text-right font-bold">AMOUNT</th>
          </tr>
        </thead>
        <tbody>
          {order.items.map((it) => {
            const addOns = addOnsOf(it.addOnsJson);
            return (
              <tr key={it.id} className="border-t border-dotted border-black/30 align-top">
                <td className="py-1 pr-1">
                  {it.nameSnapshot}
                  {it.variantName && <span className="block pl-2">({it.variantName})</span>}
                  {addOns.length > 0 && (
                    <span className="block pl-2">+ {addOns.map((a) => a.name).join(", ")}</span>
                  )}
                </td>
                <td className="py-1 pl-2 text-right">{it.qty}</td>
                <td className="py-1 pl-2 text-right">{amt(it.unitPrice)}</td>
                <td className="py-1 pl-2 text-right">{amt(it.lineTotal)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <Rule />

      <div className="space-y-0.5">
        <Row label="Sub Total" value={amt(order.subtotal)} />
        {order.discount > 0 && (
          <Row
            label={`Discount${order.couponCode ? ` (${order.couponCode})` : ""}`}
            value={`- ${amt(order.discount)}`}
          />
        )}
        {order.loyaltyCredit > 0 && (
          <Row label="Loyalty credit" value={`- ${amt(order.loyaltyCredit)}`} />
        )}
        {order.packagingFee > 0 && <Row label="Packaging" value={amt(order.packagingFee)} />}
        {order.deliveryFee > 0 && <Row label="Delivery" value={amt(order.deliveryFee)} />}
        {order.tax > 0 && (
          <Row
            label={`GST${order.branch.taxPercent ? ` @ ${order.branch.taxPercent}%` : ""}`}
            value={amt(order.tax)}
          />
        )}
      </div>

      <Rule solid />

      <div className="flex items-baseline justify-between gap-3 text-[15px] font-bold">
        <span>GRAND TOTAL</span>
        <span>{inr(order.total)}</span>
      </div>

      <Rule solid />

      <div className="space-y-0.5">
        <Row
          label="Paid by"
          value={`${order.paymentMethod === "COD" ? "CASH" : order.paymentMethod} · ${order.paymentStatus}`}
          bold
        />
        <Row label="Items" value={String(order.items.reduce((s, i) => s + i.qty, 0))} />
      </div>

      {order.instructions && (
        <>
          <Rule />
          <div>Note: {order.instructions}</div>
        </>
      )}

      <Rule />

      <footer className="space-y-1 pb-1 text-center">
        <div className="text-[12px] font-bold">धन्यवाद · THANK YOU 🙏</div>
        <div>Please visit again!</div>
        <div className="pt-1 text-[10px]">
          {off > 0 && <span className="block">You saved {inr(off)} on this order</span>}
          This is a computer generated bill.
        </div>
      </footer>
    </div>
  );
}

/* ------------------------------------------------- the kitchen order ticket */

function Kot({ order }: { order: PrintableOrder }) {
  return (
    <div className="font-mono text-[13px] leading-snug text-black">
      <header className="text-center">
        <div className="text-[13px] font-bold tracking-[0.25em]">KITCHEN ORDER TICKET</div>
        <div className="mt-1 text-[20px] font-bold">{order.orderNumber}</div>
        <div className="font-bold">
          {TYPE_LABEL[order.type]}
          {order.tableNo ? ` · TABLE ${order.tableNo}` : ""}
        </div>
        <div>
          {istDate(order.placedAt)} · {istTime(order.placedAt)}
        </div>
        {order.scheduledFor && (
          <div className="font-bold">
            SCHEDULED {istDate(order.scheduledFor)} {istTime(order.scheduledFor)}
          </div>
        )}
      </header>

      <Rule solid />

      <table className="w-full">
        <tbody>
          {order.items.map((it) => {
            const addOns = addOnsOf(it.addOnsJson);
            return (
              <tr key={it.id} className="border-t border-dotted border-black/30 align-top">
                <td className="w-0 whitespace-nowrap py-1.5 pr-2 text-[16px] font-bold">
                  {it.qty} ×
                </td>
                <td className="py-1.5">
                  <span className="text-[15px] font-bold">{it.nameSnapshot}</span>
                  {it.variantName && <span className="block pl-1">({it.variantName})</span>}
                  {addOns.length > 0 && (
                    <span className="block pl-1">+ {addOns.map((a) => a.name).join(", ")}</span>
                  )}
                  {it.instructions && (
                    <span className="block pl-1 font-bold underline">“{it.instructions}”</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {order.instructions && (
        <>
          <Rule solid />
          <div className="font-bold">NOTE: {order.instructions}</div>
        </>
      )}

      <Rule />
      <div className="text-center">Cutlery: {order.cutlery ? "YES" : "NO"}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ shell */

/**
 * Print preview for one order, as a bill or as a kitchen ticket.
 *
 * It is portalled to `<body>` on purpose. The old “Print ticket” button just
 * called `window.print()` on the live page and leaned on `.no-print` to hide
 * the rest — but the order queue behind the modal still occupied its full
 * height, so every bill came out on two sheets with the second one blank. The
 * print rules in globals.css hide every *other* direct child of `<body>`
 * instead, which removes those boxes from layout entirely.
 */
export function PrintSheet({
  order,
  variant: initial = "bill",
  onClose,
  allowKot = true,
}: {
  order: PrintableOrder;
  variant?: "bill" | "kot";
  onClose: () => void;
  /** Off for customers — a kitchen ticket is a staff document. */
  allowKot?: boolean;
}) {
  const [variant, setVariant] = useState<"bill" | "kot">(initial);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    document.body.classList.add("printing-sheet");
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("printing-sheet");
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className="print-root fixed inset-0 z-[60] overflow-y-auto bg-black/60 p-3 sm:p-6 print:static print:overflow-visible print:bg-transparent print:p-0"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={variant === "bill" ? "Bill preview" : "Kitchen ticket preview"}
    >
      <div
        className="mx-auto w-full max-w-[360px] print:max-w-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex flex-wrap gap-2 no-print">
          {allowKot ? (
            <div className="flex flex-1 overflow-hidden rounded-xl border border-white/40">
              {(["bill", "kot"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => setVariant(v)}
                  aria-pressed={variant === v}
                  className={`min-h-[44px] flex-1 px-3 text-sm font-bold transition ${
                    variant === v ? "bg-white text-maroon-700" : "bg-white/15 text-white"
                  }`}
                >
                  {v === "bill" ? "🧾 Bill" : "👨‍🍳 KOT"}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex-1" />
          )}
          <BluetoothPrint order={order} variant={variant} />
          <button onClick={() => window.print()} className="btn-secondary !min-h-[44px]">
            🖨️ Print
          </button>
          <button
            onClick={onClose}
            className="btn-ghost !min-h-[44px] !bg-white/15 !text-white hover:!bg-white/25"
          >
            Close
          </button>
        </div>

        {/* print:!p-0 etc. strip the on-screen paper look so the sheet starts at
            the very top of the page and nothing is wasted. */}
        <div className="print-sheet rounded-lg bg-white px-4 py-4 shadow-lift print:rounded-none print:px-0 print:py-0 print:shadow-none">
          {variant === "bill" ? <Bill order={order} /> : <Kot order={order} />}
        </div>
      </div>
    </div>,
    document.body
  );
}
