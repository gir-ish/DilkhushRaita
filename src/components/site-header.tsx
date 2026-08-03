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
    <header className="sticky top-0 z-40 bg-cream-50/85 backdrop-blur-md border-b border-cream-300/70 shadow-[0_1px_3px_rgba(74,17,17,0.05)] no-print">
      <div className="mx-auto max-w-5xl px-4 h-16 flex items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2.5 min-w-0 group"
          aria-label="DilKhush Dhaba home"
        >
          <span
            aria-hidden
            className="text-xl grid place-items-center h-10 w-10 shrink-0 rounded-full
              bg-gradient-to-br from-mustard-200 to-mustard-400 shadow-card
              transition duration-200 group-hover:scale-105"
          >
            🥘
          </span>
          <span className="min-w-0">
            <span className="block font-display font-bold text-maroon-700 leading-tight truncate">
              DilKhush Dhaba
            </span>
            <span className="block text-[10px] font-bold tracking-[0.2em] text-mustard-600 -mt-0.5">
              RAITA WALA
            </span>
          </span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2" aria-label="Main">
          <Link href={user ? "/account" : "/login"} className="btn-ghost !px-3">
            <span aria-hidden>👤</span>
            <span className="hidden sm:inline">{user ? (user.name ?? "Account") : "Sign in"}</span>
          </Link>
          {showCart && (
            <Link
              href={cart.branchSlug ? `/cart` : "/"}
              className="btn-primary !px-4 relative"
              aria-label={`Cart, ${cart.count} items`}
            >
              <span aria-hidden>🛒</span>
              <span className="hidden sm:inline">Cart</span>
              {cart.count > 0 && (
                <span className="absolute -top-1.5 -right-1.5 bg-mustard-400 text-maroon-800 rounded-full h-5 min-w-5 px-1 text-xs font-bold flex items-center justify-center">
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
