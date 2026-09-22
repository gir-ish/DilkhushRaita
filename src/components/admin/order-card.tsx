"use client";

import { inr, istDateTime, timeAgo } from "@/lib/utils";
import type { AdminOrder } from "./order-detail-modal";

/**
 * One order in a queue: number, branch, who, what, how much, when.
 *
 * Shared by the full order list and the online-orders screen so the two
 * cannot drift apart — a cashier who learns to read one has learned the other.
 */
export function OrderCard({ order: o, onClick }: { order: AdminOrder; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      /* min-w-0: a grid item defaults to min-width:auto, so without it the card
         refuses to shrink below the un-truncated width of the item summary
         line and spills off a narrow screen. */
      className={`card min-w-0 p-3.5 sm:p-4 text-left hover:shadow-lift transition border-l-4 ${
        o.status === "PLACED" ? "border-l-red-600 animate-pulse" :
        ["PREPARING", "ACCEPTED"].includes(o.status) ? "border-l-mustard-400" :
        o.status === "DELIVERED" ? "border-l-leaf-500" : "border-l-cream-300"
      }`}
    >
      <div className="flex justify-between items-start gap-2">
        <span className="font-bold text-base sm:text-lg truncate">{o.orderNumber}</span>
        <span className="text-[10px] sm:text-xs font-bold px-2 py-1 rounded-full bg-cream-200 whitespace-nowrap shrink-0">{o.status.replace(/_/g, " ")}</span>
      </div>
      {/* Branch up front and colour-coded: with two queues side by side the
          branch is the easiest thing to misread. */}
      <span
        className={`inline-block mt-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold ${
          o.branch.slug === "rohini"
            ? "bg-maroon-100 text-maroon-700"
            : "bg-mustard-100 text-mustard-600"
        }`}
      >
        🏪 {o.branch.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, "")}
      </span>
      <p className="text-sm sm:text-[15px] mt-1.5">
        {o.user.name ?? "Customer"} · {o.type === "DINE_IN" ? "🍽️ Dine-in" : o.type === "PICKUP" ? "🛍️ Pickup" : "🛵 Delivery"} · <strong>{inr(o.total)}</strong> ({o.paymentMethod})
      </p>
      <p className="text-xs text-maroon-800/60 truncate mt-1">
        {o.items.map((i) => `${i.qty}×${i.nameSnapshot}`).join(", ")}
      </p>
      {/* Exact stamp first, "8 min ago" second: the relative time is what you
          scan while working, but the absolute one is what you quote back to a
          customer, so both have to be on the card. */}
      <p className="text-xs text-maroon-800/50 mt-1">
        🕒 {istDateTime(o.placedAt)}{" "}
        <span className="text-maroon-800/40">· {timeAgo(o.placedAt)}</span>
      </p>
      {o.scheduledFor && (
        <p className="text-xs font-semibold text-maroon-800/60">
          ⏰ Scheduled {istDateTime(o.scheduledFor)}
        </p>
      )}
    </button>
  );
}
