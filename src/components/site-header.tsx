"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "./cart-context";

export function SiteHeader({ showCart = true }: { showCart?: boolean }) {
  const cart = useCart();
  const [user, setUser] = useState<{ name: string | null } | null | undefined>(undefined);

  useEffect(() => {
    fetch("/api/me")
      .then((r) => r.json())
      .then((d) => setUser(d.user))
      .catch(() => setUser(null));
  }, []);

  return (
    // `header-solidify` is a scroll-driven CSS animation: transparent over the
    // hero, opaque with a hairline once the page moves. No scroll listener.
    <header className="header-solidify sticky top-0 z-40 no-print">
      <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-3 min-w-0 group rounded-lg"
          aria-label="DilKhush Dhaba home"
        >
          {/* Monogram plate: brass ring, engraved serif initials. */}
          <span
            aria-hidden
            className="relative grid place-items-center h-10 w-10 shrink-0 rounded-full
              bg-gradient-to-b from-mustard-200 to-mustard-500
              ring-1 ring-mustard-600/60
              shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_2px_6px_-2px_rgba(61,18,17,0.45)]
              transition-transform duration-300 ease-out-expo group-hover:scale-[1.06]"
          >
            <span className="font-display text-[15px] font-semibold leading-none text-maroon-800 tracking-tight">
              DK
            </span>
            <span className="absolute inset-[3px] rounded-full border border-maroon-800/15" />
          </span>
          <span className="min-w-0">
            <span className="block font-display font-semibold text-[17px] leading-tight text-maroon-700 tracking-wordmark truncate">
              DilKhush Dhaba
            </span>
            <span className="block text-[9px] font-bold tracking-kicker text-mustard-600 mt-[1px]">
              RAITA WALA
            </span>
          </span>
        </Link>

        <nav className="flex items-center gap-1.5 sm:gap-2.5" aria-label="Main">
          <Link href={user ? "/account" : "/login"} className="btn-ghost !px-3">
            <span aria-hidden>👤</span>
            <span className="hidden sm:inline">{user ? (user.name ?? "Account") : "Sign in"}</span>
          </Link>
          {showCart && (
            <Link
              href={cart.branchSlug ? `/cart` : "/"}
              className="btn-primary !px-4"
              aria-label={`Cart, ${cart.count} items`}
            >
              <span aria-hidden>🛒</span>
              <span className="hidden sm:inline">Cart</span>
              {cart.count > 0 && (
                <span
                  className="absolute -top-1.5 -right-1.5 grid place-items-center h-5 min-w-5 px-1
                    rounded-full bg-gradient-to-b from-mustard-300 to-mustard-500
                    text-maroon-900 text-[11px] font-bold money
                    ring-2 ring-cream-50 shadow-[0_1px_3px_rgba(61,18,17,0.4)]"
                >
                  {cart.count}
                </span>
              )}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
