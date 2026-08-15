"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { inr } from "@/lib/utils";
import { notify, playTone } from "@/lib/sound";

interface NewOrderInfo {
  id: string;
  orderNumber: string;
  type: string;
  total: number;
  itemCount: number;
  customerName: string | null;
  branchName: string;
}

/** How often the queue is checked for orders nobody has accepted yet. */
const POLL_MS = 10_000;
/** The chime repeats while the alert is up — someone may have walked away from the counter. */
const RECHIME_MS = 12_000;
/** …but not forever. A screen left alone overnight must eventually shut up. */
const MAX_RECHIMES = 5;

const TYPE_LABEL: Record<string, string> = {
  DELIVERY: "🛵 Delivery",
  PICKUP: "🛍️ Self-pickup",
  DINE_IN: "🍽️ Dine-in",
  PARCEL: "🛍️ Parcel",
};

/**
 * Watches for orders waiting to be accepted, on every dashboard screen.
 *
 * Lives in the shell rather than on the order queue: a new order is the one
 * thing worth interrupting whatever else the owner is doing, and they are as
 * likely to be looking at Reports or the Menu when it lands.
 */
export function NewOrderWatcher() {
  const [queue, setQueue] = useState<NewOrderInfo[]>([]);
  // null until the first poll answers — whatever was already waiting when the
  // screen was opened is not news, and must not set the alarm off.
  const seen = useRef<Set<string> | null>(null);

  const poll = useCallback(async () => {
    try {
      // Shares the queue endpoint the Orders screen uses, so branch scoping and
      // the hiding of unpaid online orders are decided in exactly one place.
      const r = await fetch("/api/admin/orders?active=1");
      // 403 for roles with no order access (Marketing). Nothing to watch.
      if (!r.ok) return;
      const d = await r.json();
      const placed = (d.orders ?? []).filter(
        (o: { status: string }) => o.status === "PLACED"
      );
      const ids = new Set<string>(placed.map((o: { id: string }) => o.id));
      const before = seen.current;
      seen.current = ids;
      if (!before) return;

      const fresh = placed.filter((o: { id: string }) => !before.has(o.id));
      if (fresh.length === 0) return;

      setQueue((q) => [
        ...q,
        ...fresh.map(
          (o: {
            id: string; orderNumber: string; type: string; total: number;
            items: unknown[];
            user: { name: string | null } | null;
            contactName: string | null;
            branch: { name: string };
          }) => ({
            id: o.id,
            orderNumber: o.orderNumber,
            type: o.type,
            total: o.total,
            itemCount: o.items.length,
            customerName: o.user?.name ?? o.contactName,
            branchName: o.branch.name,
          })
        ),
      ]);
      playTone("newOrder");
      notify(
        "🆕 New order!",
        `${fresh.length} order${fresh.length === 1 ? "" : "s"} waiting to be accepted`,
        "dk-new-order"
      );
    } catch {
      // Offline or a flaky connection: the next tick tries again.
    }
  }, []);

  useEffect(() => {
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [poll]);

  if (queue.length === 0) return null;
  return <NewOrderAlert queue={queue} onDismiss={() => setQueue([])} />;
}

/**
 * The interruption itself: the whole screen, readable from across the room.
 *
 * It does not time out. A banner that fades away on its own is one that gets
 * missed, which is the entire problem this solves — it goes when someone says
 * it goes.
 */
function NewOrderAlert({ queue, onDismiss }: { queue: NewOrderInfo[]; onDismiss: () => void }) {
  const router = useRouter();
  const dismissRef = useRef<HTMLButtonElement>(null);
  const first = queue[0];
  const more = queue.length - 1;

  useEffect(() => {
    dismissRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onDismiss();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onDismiss]);

  // Keep chiming while it is up. Someone puts a plate down and walks back.
  useEffect(() => {
    let rung = 0;
    const t = setInterval(() => {
      if (++rung > MAX_RECHIMES) return clearInterval(t);
      playTone("newOrder");
    }, RECHIME_MS);
    return () => clearInterval(t);
  }, [queue.length]);

  const open = () => {
    onDismiss();
    router.push("/admin/orders");
  };

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label={`New order ${first.orderNumber}`}
      className="fixed inset-0 z-[70] flex flex-col items-center justify-center gap-6 p-6
        text-center text-cream-50 no-print animate-fade-in
        bg-[radial-gradient(circle_at_50%_35%,theme(colors.maroon.600),theme(colors.maroon.900))]"
    >
      {/* The bell carries the alarm visually for anyone who cannot hear it. */}
      <span aria-hidden className="text-6xl sm:text-7xl animate-bounce">
        🔔
      </span>

      <p className="text-mustard-300 font-bold tracking-[0.3em] text-sm sm:text-base uppercase">
        {queue.length === 1 ? "New order" : `${queue.length} new orders`}
      </p>

      {/* Sized off the viewport: this has to be legible from the far side of
          the room, on a phone propped at the counter or a wall-mounted screen. */}
      <p className="font-display font-bold leading-none text-[clamp(3rem,14vw,7rem)]">
        {first.orderNumber}
      </p>

      <p className="font-display text-[clamp(1.5rem,6vw,3rem)] font-bold text-mustard-200 leading-tight">
        {inr(first.total)}
      </p>

      <p className="text-lg sm:text-2xl font-semibold text-cream-50/90">
        {TYPE_LABEL[first.type] ?? first.type} · {first.itemCount} item
        {first.itemCount === 1 ? "" : "s"}
        {first.customerName && ` · ${first.customerName}`}
      </p>
      <p className="text-base sm:text-lg text-cream-50/60 -mt-4">{first.branchName}</p>

      {more > 0 && (
        <p className="rounded-full bg-cream-50/15 px-5 py-2 text-base sm:text-lg font-bold">
          + {more} more order{more === 1 ? "" : "s"} waiting
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md mt-2">
        <button
          onClick={open}
          className="flex-1 rounded-2xl bg-mustard-300 px-6 py-5 text-xl font-bold text-maroon-900
            shadow-lift transition hover:bg-mustard-200 active:scale-[0.98]"
        >
          Open orders →
        </button>
        <button
          ref={dismissRef}
          onClick={onDismiss}
          className="rounded-2xl border-2 border-cream-50/40 px-6 py-5 text-xl font-bold
            text-cream-50 transition hover:bg-cream-50/10 active:scale-[0.98]"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
