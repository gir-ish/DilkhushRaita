"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { SoundToggle } from "@/components/sound-toggle";
import { NewOrderWatcher } from "@/components/admin/new-order-alert";

const NAV = [
  ["/admin", "📊 Overview", ["OWNER", "BRANCH_MANAGER", "CASHIER", "DELIVERY_MANAGER", "MARKETING"]],
  ["/admin/counter", "🛎️ Counter", ["OWNER", "BRANCH_MANAGER", "CASHIER"]],
  ["/admin/online", "🌐 Online", ["OWNER", "BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER"]],
  ["/admin/orders", "🧾 Orders", ["OWNER", "BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER"]],
  ["/admin/kitchen", "👨‍🍳 Kitchen", ["OWNER", "BRANCH_MANAGER", "KITCHEN"]],
  ["/admin/menu", "🍛 Menu", ["OWNER", "BRANCH_MANAGER"]],
  ["/admin/branches", "🏪 Branches", ["OWNER", "BRANCH_MANAGER"]],
  ["/admin/agents", "🛵 Agents", ["OWNER", "BRANCH_MANAGER", "DELIVERY_MANAGER"]],
  ["/admin/coupons", "🎟️ Marketing", ["OWNER", "MARKETING"]],
  ["/admin/customers", "👥 Customers", ["OWNER", "BRANCH_MANAGER", "MARKETING"]],
  ["/admin/reports", "📈 Reports", ["OWNER", "BRANCH_MANAGER", "CASHIER", "MARKETING"]],
  // The shop's own hisaab: money going out, not the customer khata.
  ["/admin/expenses", "📒 Accounts", ["OWNER"]],
  // Owner only: these accounts are the keys to everything above.
  ["/admin/staff", "🧑‍🍳 Staff", ["OWNER"]],
] as const;

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  // Website orders nobody has accepted yet, on the tab itself. Whatever screen
  // the owner is on, the number they most need to know is how many customers
  // are currently waiting to hear back.
  const [waiting, setWaiting] = useState(0);
  const headerRef = useRef<HTMLElement>(null);

  /*
   * Publish the header's height so a page can fill exactly the rest of the
   * window. The counter uses it to keep its own header and the menu's search
   * box still while only the dishes scroll — and the header is not a fixed
   * number: the nav wraps, the browser zooms, a scrollbar appears.
   */
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const publish = () =>
      document.documentElement.style.setProperty("--admin-chrome", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, [pathname]);

  useEffect(() => {
    if (pathname === "/admin/login") return;
    let alive = true;
    const poll = async () => {
      try {
        const r = await fetch("/api/admin/orders?channel=ONLINE&status=PLACED");
        if (!r.ok) return; // 403 for roles with no order access — no badge, no fuss
        const d = await r.json();
        if (alive) setWaiting((d.orders ?? []).length);
      } catch {
        // A badge is never worth an error on screen.
      }
    };
    poll();
    const t = setInterval(poll, 15_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [pathname]);

  if (pathname === "/admin/login") return <>{children}</>;

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/admin/login");
  };

  return (
    <div className="min-h-screen bg-cream-100">
      {/* Sticky so the section tabs stay reachable on a long order queue. */}
      <header
        ref={headerRef}
        className="sticky top-0 z-40 bg-gradient-to-b from-maroon-700 to-maroon-800 text-cream-50 shadow-lift no-print"
      >
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
          /* Scrolls, and shows that it does: on a laptop there is no swipe,
             so a hidden bar leaves Reports and Staff off the right edge with
             nothing to say they are there. */
          className="px-2 sm:px-4 flex gap-1.5 scroll-x scroll-x-on-dark pb-2 max-w-7xl mx-auto"
          aria-label="Admin sections"
        >
          {NAV.map(([href, label]) => {
            const active = pathname === href;
            const badge = href === "/admin/online" ? waiting : 0;
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  // Bigger hit area — this is used on tablets at a busy counter.
                  "px-4 py-2.5 rounded-xl text-[15px] font-semibold whitespace-nowrap shrink-0 transition",
                  active
                    ? "bg-cream-50 text-maroon-700 shadow-card"
                    : "text-cream-50/85 hover:bg-maroon-600 hover:text-cream-50"
                )}
              >
                {label}
                {badge > 0 && (
                  <span
                    className={`ml-1.5 rounded-full px-2 py-0.5 text-xs font-bold ${
                      active ? "bg-red-600 text-white" : "bg-red-600 text-white animate-pulse"
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </header>
      {/* Everything else is reading width; the counter is a working screen
          used all day on a wide monitor, and capping it at 1280px threw away
          two dishes per row and half the parcels. */}
      <main
        className={cn(
          "p-4 sm:p-6 mx-auto",
          pathname === "/admin/counter" ? "max-w-[1800px]" : "max-w-7xl"
        )}
      >
        {children}
      </main>
      {/* Outside <main> on purpose: it covers the screen whatever is under it. */}
      <NewOrderWatcher />
    </div>
  );
}
