"use client";

import { cn } from "@/lib/utils";

export interface BranchTab {
  id: string;
  name: string;
  slug?: string;
}

/**
 * Big branch switcher for the dashboard. Rohini and NSP queues look alike at a
 * glance, so which branch you are looking at has to be unmissable — a small
 * dropdown was too easy to misread while working quickly.
 *
 * Hidden entirely when the staff member only has one branch: there is nothing
 * to choose, and the tab would just be noise.
 */
export function BranchTabs({
  branches,
  value,
  onChange,
  counts,
  allowAll = true,
  className,
}: {
  branches: BranchTab[];
  value: string; // branch id, or "all"
  onChange: (id: string) => void;
  counts?: Record<string, number>;
  allowAll?: boolean;
  className?: string;
}) {
  if (branches.length <= 1) return null;

  const total = counts
    ? Object.values(counts).reduce((s, n) => s + n, 0)
    : undefined;

  const tab = (id: string, label: string, count?: number) => {
    const active = value === id;
    return (
      <button
        key={id}
        onClick={() => onChange(id)}
        aria-pressed={active}
        className={cn(
          "flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2.5 text-sm font-bold whitespace-nowrap transition sm:px-5 sm:py-3 sm:text-[15px]",
          active
            ? "bg-maroon-600 text-cream-50 shadow-card"
            : "bg-white text-maroon-700 border border-cream-300 hover:border-mustard-400 hover:bg-mustard-100"
        )}
      >
        {label}
        {count !== undefined && (
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-xs font-bold",
              active ? "bg-cream-50/25 text-cream-50" : "bg-cream-200 text-maroon-700"
            )}
          >
            {count}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      /* Swipeable on a phone; no-scrollbar keeps the desktop scrollbar from
         drawing a grey slab across the middle of the dashboard. */
      className={cn("flex gap-2 overflow-x-auto no-scrollbar pb-1", className)}
      role="group"
      aria-label="Filter by branch"
    >
      {allowAll && tab("all", "🏪 All branches", total)}
      {branches.map((b) => tab(b.id, b.name.replace(/^DilKhush Dhaba\s*[–-]\s*/, ""), counts?.[b.id]))}
    </div>
  );
}
