import type { Metadata, Viewport } from "next";
import { Baloo_2, Inter } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/cart-context";
import { PwaRegister } from "@/components/pwa-register";

const display = Baloo_2({ subsets: ["latin"], variable: "--font-display", weight: ["500", "600", "700"] });
const body = Inter({ subsets: ["latin"], variable: "--font-body" });

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
  themeColor: "#7B1E1E",
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
