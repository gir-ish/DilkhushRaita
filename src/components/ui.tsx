"use client";

import { useEffect } from "react";
import { cn } from "@/lib/utils";

export function VegMark({ veg, className }: { veg: boolean; className?: string }) {
  return (
    <span
      role="img"
      aria-label={veg ? "Vegetarian" : "Non-vegetarian"}
      className={cn(
        "inline-flex h-4 w-4 items-center justify-center border-2 rounded-[3px] shrink-0",
        veg ? "border-leaf-600" : "border-red-700",
        className
      )}
    >
      <span
        className={cn("h-1.5 w-1.5 rounded-full", veg ? "bg-leaf-600" : "bg-red-700")}
      />
    </span>
  );
}

export function FoodImage({
  emoji,
  url,
  name,
  className,
}: {
  emoji: string;
  url?: string | null;
  name: string;
  className?: string;
}) {
  if (url)
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} loading="lazy" className={cn("object-cover", className)} />;
  return (
    <div
      role="img"
      aria-label={`${name} (placeholder image)`}
      className={cn(
        "flex items-center justify-center text-4xl select-none",
        // Warm plate under the emoji placeholder, with a light top edge so it
        // reads as a dish on a surface rather than a coloured rectangle.
        "bg-[radial-gradient(circle_at_32%_26%,theme(colors.cream.50),theme(colors.mustard.100)_45%,theme(colors.cream.200))]",
        className
      )}
    >
      {emoji}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center
        bg-maroon-950/55 backdrop-blur-[3px] p-0 sm:p-4 animate-fade-in"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "relative w-full bg-cream-50 shadow-lift max-h-[92vh] overflow-y-auto animate-sheet-up",
          "rounded-t-plaque sm:rounded-plaque border border-maroon-800/10",
          // Safe-area padding matters here: on a phone this is a bottom sheet
          // sitting right on the home indicator.
          "pb-[env(safe-area-inset-bottom)] sm:pb-0",
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
      >
        {/* Grab handle — signals "this is a dismissible sheet" on mobile. Left
            unsticky so it scrolls away and hands the top edge to the header. */}
        <span
          aria-hidden
          className="sm:hidden mx-auto mt-2.5 mb-0.5 block h-1 w-10 rounded-full bg-maroon-800/20"
        />
        <div className="sticky top-0 bg-cream-50/95 backdrop-blur-sm flex items-center justify-between gap-3 px-5 py-4 border-b border-maroon-800/10 z-10">
          <h2 className="font-display text-fluid-lg font-semibold text-maroon-700 min-w-0 truncate">
            {title}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="btn-ghost !min-h-[36px] !min-w-[36px] !px-0 !w-9 text-2xl leading-none shrink-0"
          >
            ×
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-14 text-maroon-600" role="status">
      <span className="relative grid h-9 w-9 place-items-center">
        {/* Two counter-rotating arcs read as deliberate machinery rather than a
            default browser throbber. */}
        <span className="absolute inset-0 rounded-full border-2 border-maroon-800/10" />
        <span className="absolute inset-0 rounded-full border-2 border-transparent border-t-maroon-600 border-r-maroon-600/40 animate-spin" />
        <span className="absolute inset-[6px] rounded-full border-2 border-transparent border-b-mustard-400 animate-spin [animation-duration:1.4s] [animation-direction:reverse]" />
      </span>
      <span className="text-sm font-medium text-maroon-800/70">{label}</span>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl bg-red-50 border border-red-200 text-red-900
        px-4 py-3 text-sm leading-relaxed shadow-[inset_0_1px_0_rgba(255,255,255,0.6)]"
    >
      <span aria-hidden className="mt-px shrink-0">
        ⚠️
      </span>
      <span className="min-w-0">{message}</span>
    </div>
  );
}

export function Badge({
  children,
  tone = "mustard",
}: {
  children: React.ReactNode;
  tone?: "mustard" | "maroon" | "green" | "gray";
}) {
  // Each tone carries its own hairline: a flat fill alone disappears against
  // the cream cards, which are only a shade lighter than the badge itself.
  const tones = {
    mustard: "bg-mustard-100 text-mustard-600 ring-mustard-400/40",
    maroon: "bg-maroon-50 text-maroon-600 ring-maroon-300/40",
    green: "bg-leaf-50 text-leaf-600 ring-leaf-500/25",
    gray: "bg-cream-200 text-maroon-800/60 ring-maroon-800/10",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
        "uppercase tracking-wide ring-1 whitespace-nowrap",
        tones[tone]
      )}
    >
      {children}
    </span>
  );
}
