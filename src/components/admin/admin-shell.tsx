"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

const NAV = [
  ["/admin", "📊 Overview", ["OWNER", "BRANCH_MANAGER", "CASHIER", "DELIVERY_MANAGER", "MARKETING"]],
  ["/admin/orders", "🧾 Orders", ["OWNER", "BRANCH_MANAGER", "KITCHEN", "CASHIER", "DELIVERY_MANAGER"]],
  ["/admin/kitchen", "👨‍🍳 Kitchen", ["OWNER", "BRANCH_MANAGER", "KITCHEN"]],
  ["/admin/menu", "🍛 Menu", ["OWNER", "BRANCH_MANAGER"]],
  ["/admin/branches", "🏪 Branches", ["OWNER", "BRANCH_MANAGER"]],
  ["/admin/coupons", "🎟️ Marketing", ["OWNER", "MARKETING"]],
  ["/admin/customers", "👥 Customers", ["OWNER", "BRANCH_MANAGER", "MARKETING"]],
  ["/admin/reports", "📈 Reports", ["OWNER", "BRANCH_MANAGER", "CASHIER", "MARKETING"]],
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
      <header className="bg-maroon-700 text-cream-50 no-print">
        <div className="px-4 h-14 flex items-center justify-between">
          <Link href="/admin" className="font-display font-bold">
            🥘 DilKhush Dhaba · Dashboard
          </Link>
          <div className="flex items-center gap-3">
            <Link href="/" className="text-sm underline opacity-80">View site</Link>
            <button onClick={logout} className="text-sm underline opacity-80">Sign out</button>
          </div>
        </div>
        <nav className="px-2 flex gap-1 overflow-x-auto pb-2" aria-label="Admin sections">
          {NAV.map(([href, label]) => (
            <Link
              key={href}
              href={href}
              className={cn(
                "px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap",
                pathname === href ? "bg-cream-50 text-maroon-700" : "text-cream-50/80 hover:bg-maroon-600"
              )}
            >
              {label}
            </Link>
          ))}
        </nav>
      </header>
      <main className="p-4 max-w-6xl mx-auto">{children}</main>
    </div>
  );
}
