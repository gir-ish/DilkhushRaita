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
        "flex items-center justify-center bg-gradient-to-br from-mustard-100 to-cream-200 text-4xl select-none",
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
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "bg-white w-full sm:rounded-card rounded-t-card shadow-lift max-h-[92vh] overflow-y-auto",
          wide ? "sm:max-w-2xl" : "sm:max-w-md"
        )}
      >
        <div className="sticky top-0 bg-white flex items-center justify-between px-5 py-4 border-b border-cream-200 z-10">
          <h2 className="font-display text-lg font-bold text-maroon-700">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="btn-ghost !min-h-[36px] !px-3 text-xl leading-none"
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
    <div className="flex items-center justify-center gap-3 py-10 text-maroon-600" role="status">
      <span className="h-6 w-6 rounded-full border-[3px] border-maroon-200 border-t-maroon-600 animate-spin" />
      <span className="text-sm font-medium">{label}</span>
    </div>
  );
}

export function ErrorBox({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-xl bg-red-50 border border-red-200 text-red-800 px-4 py-3 text-sm">
      {message}
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
  const tones = {
    mustard: "bg-mustard-100 text-mustard-600",
    maroon: "bg-maroon-50 text-maroon-600",
    green: "bg-green-50 text-leaf-600",
    gray: "bg-cream-200 text-maroon-800/60",
  };
  return (
    <span className={cn("inline-block rounded-full px-2 py-0.5 text-xs font-bold", tones[tone])}>
      {children}
    </span>
  );
}
