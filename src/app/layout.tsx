import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/cart-context";
import { PwaRegister } from "@/components/pwa-register";

/**
 * Fraunces is a variable "old-style" serif with an optical-size axis, so the
 * wordmark at 68px and a card heading at 18px are drawn with the contrast each
 * size actually wants — a rounded display face could not do that, and read
 * closer to a children's menu than a dhaba that has been there thirty years.
 */
const display = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  axes: ["SOFT", "WONK", "opsz"],
});
const body = Inter({ subsets: ["latin"], variable: "--font-body", display: "swap" });

export const metadata: Metadata = {
  title: {
    default: "DilKhush Dhaba – Raita Wala | Authentic North Indian Food, Delivered",
    template: "%s | DilKhush Dhaba – Raita Wala",
  },
  description:
    "Order authentic North Indian dhaba food from DilKhush Dhaba – Raita Wala. Fresh thalis, paneer, dal makhani and our famous raita. Delivery & pickup from Rohini and NSP, Delhi.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "DilKhush Dhaba – Raita Wala",
    description: "Authentic North Indian dhaba food, delivered hot from Rohini & NSP.",
    type: "website",
  },
};

export const viewport: Viewport = {
  themeColor: "#71201C",
  width: "device-width",
  initialScale: 1,
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "Restaurant",
  name: "DilKhush Dhaba – Raita Wala",
  servesCuisine: "North Indian",
  priceRange: "₹₹",
  // PLACEHOLDER address/telephone — real values are managed in the owner dashboard.
  address: { "@type": "PostalAddress", addressLocality: "Delhi", addressCountry: "IN" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        <CartProvider>{children}</CartProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
