import type { Metadata } from "next";
import { AdminShell } from "@/components/admin/admin-shell";

/*
 * The dashboard is a second installable app.
 *
 * One origin can offer more than one, so long as each points at its own
 * manifest with its own `id` and `scope`. Naming a manifest here overrides the
 * shop's for every /admin page, so a browser sitting on the dashboard offers
 * to install the dashboard — its own icon, opening straight into /admin
 * instead of the menu. The owner ends up with two icons on one home screen and
 * never types the address again.
 *
 * The file is /manifest-admin.webmanifest and NOT /admin.webmanifest, which
 * would read as an /admin path to the middleware and be bounced to the login
 * screen — a manifest the browser cannot fetch is an install offer that never
 * appears, with nothing anywhere to say why.
 */
export const metadata: Metadata = {
  title: "Dashboard | DilKhush Dhaba",
  manifest: "/manifest-admin.webmanifest",
  icons: {
    icon: [
      { url: "/icon-admin.svg", type: "image/svg+xml" },
      { url: "/icon-admin-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: [{ url: "/apple-touch-icon-admin.png", sizes: "180x180", type: "image/png" }],
  },
  // Overrides the shop's "DilKhush" from the root layout: this is the name
  // that ends up under the icon when a staff member adds it from an iPhone.
  appleWebApp: { capable: true, title: "Dashboard", statusBarStyle: "default" },
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
