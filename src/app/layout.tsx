import type { Metadata, Viewport } from "next";
import { Fraunces, Inter } from "next/font/google";
import "./globals.css";
import { CartProvider } from "@/components/cart-context";
import { PwaRegister } from "@/components/pwa-register";
import { InstallPrompt } from "@/components/install-prompt";

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
  icons: {
    icon: [
      { url: "/icon.svg", type: "image/svg+xml" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
    ],
    // iOS will not read an SVG here. Without this PNG, "Add to Home Screen"
    // saves a shrunken screenshot of the page as the icon.
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  /*
   * What makes an iPhone open the saved icon as an app — its own window, no
   * address bar — rather than reopening Safari on the page. The short title is
   * what fits under the icon before iOS truncates it.
   */
  appleWebApp: {
    capable: true,
    title: "DilKhush",
    statusBarStyle: "default",
  },
  /*
   * Next writes the standardised `mobile-web-app-capable` for the tag above.
   * iOS 16.4 and newer take the manifest's `display: standalone` anyway, but
   * older iPhones read only Apple's original spelling — and plenty of those
   * are still in service. One extra tag, and they open the icon as an app
   * instead of bouncing back into Safari.
   */
  other: { "apple-mobile-web-app-capable": "yes" },
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
        {/*
          A JSON-LD data block, not code: the browser never executes a <script>
          whose type is not a JavaScript MIME type, so CSP has nothing to block
          and it needs no nonce. The content is a fixed object defined above —
          no request data reaches it, which is what makes the inline HTML safe.
        */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
        />
        {/*
          Catches the browser's install offer before React exists.

          Chrome fires `beforeinstallprompt` once, early, and — crucially — if
          nobody calls preventDefault() on it the offer is spent. A listener
          added later, inside a component, routinely misses it entirely, and
          the install bar then never appears for reasons that look like
          nothing at all. Parking the event on `window` here and announcing it
          means InstallPrompt can mount whenever it likes and still find it.
        */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              "window.__dkInstallEvent=null;" +
              "addEventListener('beforeinstallprompt',function(e){" +
              "e.preventDefault();window.__dkInstallEvent=e;" +
              "dispatchEvent(new Event('dk-installable'))});",
          }}
        />
        <CartProvider>
          {children}
          <InstallPrompt />
        </CartProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
