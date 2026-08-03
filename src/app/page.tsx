import { SiteHeader } from "@/components/site-header";
import { BranchPicker } from "@/components/branch-picker";

const HIGHLIGHTS = [
  { icon: "🔥", title: "Tandoor Fresh", copy: "Breads and tikkas straight off the clay oven." },
  { icon: "🌿", title: "Slow Cooked", copy: "Dal makhani simmered overnight, never rushed." },
  { icon: "🛵", title: "Hot on Arrival", copy: "Insulated delivery across Rohini & NSP." },
];

export default function LandingPage() {
  return (
    <>
      <SiteHeader showCart={false} />
      <main className="min-h-screen">
        <section className="pattern-jaali relative overflow-hidden">
          <div className="mx-auto max-w-5xl px-4 pt-14 pb-10 text-center animate-fade-up">
            <p className="font-display text-mustard-600 font-semibold tracking-wide text-base sm:text-lg">
              दिल से बना, दिल तक पहुँचा
            </p>
            <h1 className="font-display text-5xl sm:text-6xl font-bold text-maroon-700 mt-3 leading-[1.05]">
              DilKhush Dhaba
            </h1>
            <p className="divider-ornament mt-4 font-display text-lg font-semibold text-mustard-600">
              Raita Wala
            </p>
            <p className="mt-5 text-maroon-800/75 max-w-xl mx-auto text-base sm:text-lg leading-relaxed">
              Authentic North Indian dhaba food — dal makhani simmered overnight, tandoor-fresh
              breads, and the raita that gave us our name.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm font-semibold text-maroon-700">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>⭐</span> 4.6 average rating
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>📍</span> Rohini &amp; NSP, Delhi
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden>🟢</span> Pure veg options
              </span>
            </div>
          </div>
        </section>

        <BranchPicker />

        <section className="mx-auto max-w-5xl px-4 pb-12" aria-label="Why order from us">
          <div className="grid gap-4 sm:grid-cols-3">
            {HIGHLIGHTS.map((h) => (
              <div key={h.title} className="card p-5 text-center">
                <span aria-hidden className="text-3xl">
                  {h.icon}
                </span>
                <h2 className="font-display text-lg font-bold text-maroon-700 mt-2">{h.title}</h2>
                <p className="text-sm text-maroon-800/70 mt-1 leading-relaxed">{h.copy}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-cream-300/70 bg-cream-50/60">
          <div className="mx-auto max-w-5xl px-4 py-8 text-center text-sm text-maroon-800/60">
            <p className="font-display text-base font-bold text-maroon-700">
              DilKhush Dhaba – Raita Wala
            </p>
            <p className="mt-1">Rohini &amp; NSP, Delhi · Delivery &amp; Pickup</p>
            <p className="mt-3 text-xs text-maroon-800/45">
              © {new Date().getFullYear()} DilKhush Dhaba – Raita Wala. All rights reserved.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
