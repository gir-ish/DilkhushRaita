import { SiteHeader } from "@/components/site-header";
import { BranchPicker } from "@/components/branch-picker";

export default function LandingPage() {
  return (
    <>
      <SiteHeader showCart={false} />
      <main className="pattern-jaali min-h-screen">
        <section className="mx-auto max-w-5xl px-4 pt-10 pb-6 text-center">
          <p className="text-mustard-600 font-bold tracking-widest text-sm">
            दिल से बना, दिल तक पहुँचा
          </p>
          <h1 className="font-display text-4xl sm:text-5xl font-bold text-maroon-700 mt-2">
            DilKhush Dhaba
          </h1>
          <p className="font-display text-xl text-mustard-600 font-semibold">– Raita Wala –</p>
          <p className="mt-4 text-maroon-800/70 max-w-xl mx-auto text-[15px] sm:text-base">
            Authentic North Indian dhaba food — dal makhani simmered overnight, tandoor-fresh
            breads, and the raita that gave us our name. Order for delivery or pickup.
          </p>
        </section>
        <BranchPicker />
        <footer className="mx-auto max-w-5xl px-4 py-10 text-center text-sm text-maroon-800/50">
          <p>© {new Date().getFullYear()} DilKhush Dhaba – Raita Wala · Rohini & NSP, Delhi</p>
        </footer>
      </main>
    </>
  );
}
