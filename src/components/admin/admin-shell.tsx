"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SoundToggle } from "@/components/sound-toggle";

const NAV = [
  ["/admin", "📊 Overview", ["OWNER", "BRANCH_MANAGER", "CASHIER", "DELIVERY_MANAGER", "MARKETING"]],
  ["/admin/counter", "🛎️ Counter", ["OWNER", "BRANCH_MANAGER", "CASHIER"]],
  ["/admin/orders", "🧾 Orders", ["OWNER", "BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER"]],
  ["/admin/kitchen", "👨‍🍳 Kitchen", ["OWNER", "BRANCH_MANAGER", "KITCHEN"]],
  ["/admin/menu", "🍛 Menu", ["OWNER", "BRANCH_MANAGER"]],
  ["/admin/branches", "🏪 Branches", ["OWNER", "BRANCH_MANAGER"]],
  ["/admin/agents", "🛵 Agents", ["OWNER", "BRANCH_MANAGER", "DELIVERY_MANAGER"]],
  ["/admin/coupons", "🎟️ Marketing", ["OWNER", "MARKETING"]],
  ["/admin/customers", "👥 Customers", ["OWNER", "BRANCH_MANAGER", "MARKETING"]],
  ["/admin/reports", "📈 Reports", ["OWNER", "BRANCH_MANAGER", "CASHIER", "MARKETING"]],
  // Owner only: these accounts are the keys to everything above.
  ["/admin/staff", "🧑‍🍳 Staff", ["OWNER"]],
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  if (pathname === "/admin/login") return <>{children}</>;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-cream-100">
      {/* Sticky so the section tabs stay reachable on a long order queue. */}
      <header className="sticky top-0 z-40 bg-gradient-to-b from-maroon-700 to-maroon-800 text-cream-50 shadow-lift no-print">
        <div className="px-4 sm:px-6 h-16 flex items-center justify-between gap-3 max-w-7xl mx-auto">
          <Link href="/admin" className="flex items-center gap-3 min-w-0 group">
            <span
              aria-hidden
              className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-gradient-to-br from-mustard-200 to-mustard-400 text-2xl shadow-card transition group-hover:scale-105"
            >
              🥘
            </span>
            <span className="min-w-0">
              <span className="block font-display text-lg sm:text-xl font-bold leading-tight truncate">
                DilKhush Dhaba
              </span>
              <span className="block text-[11px] font-bold tracking-[0.2em] text-mustard-300 -mt-0.5">
                DASHBOARD
              </span>
            </span>
          </Link>
          <div className="flex items-center gap-2 shrink-0">
            {/* Sits beside Sign out on every dashboard screen: whoever is
                standing at the counter must be able to silence — or rescue —
                the new-order chime without hunting for a settings page. */}
            <SoundToggle className="bg-maroon-600/60 hover:bg-maroon-600" />
            <Link
              href="/"
              className="rounded-xl px-3 sm:px-4 py-2.5 text-sm font-semibold bg-maroon-600/60 hover:bg-maroon-600 transition"
            >
              <span aria-hidden>🌐</span> <span className="hidden sm:inline">View site</span>
            </Link>
            <button
              onClick={logout}
              className="rounded-xl px-3 sm:px-4 py-2.5 text-sm font-semibold bg-maroon-600/60 hover:bg-maroon-500 transition"
            >
              <span aria-hidden>↩</span> <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        </div>
        <nav
          className="px-2 sm:px-4 flex gap-1.5 overflow-x-auto no-scrollbar pb-2.5 max-w-7xl mx-auto"
          aria-label="Admin sections"
        >
          {NAV.map(([href, label]) => {
            const active = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // Bigger hit area — this is used on tablets at a busy counter.
                  "px-4 py-2.5 rounded-xl text-[15px] font-semibold whitespace-nowrap transition",
                  active
                    ? "bg-cream-50 text-maroon-700 shadow-card"
                    : "text-cream-50/85 hover:bg-maroon-600 hover:text-cream-50"
                )}
              >
                {label}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="p-4 sm:p-6 max-w-7xl mx-auto">{children}</main>
    </div>
  );
}
