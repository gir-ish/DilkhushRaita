import { Fragment } from "react";
import { SiteHeader } from "@/components/site-header";
import { BranchPicker } from "@/components/branch-picker";
import { Ticker } from "@/components/ticker";
import { ArchCrest, FlourishRule } from "@/components/ornament";

const TICKER = [
  "Tawa fresh",
  "Dal simmered overnight",
  "Raita churned daily",
  "Pure veg options",
  "Rohini & NSP",
  "Delivery & pickup",
];

const CRAFT = [
  {
    numeral: "I",
    icon: "🔥",
    title: "Tawa Fresh",
    copy: "Rotis and parathas come off the tawa and go straight into the box. Nothing waits under a lamp.",
  },
  {
    numeral: "II",
    icon: "🌿",
    title: "Slow Cooked",
    copy: "The dal makhani sits on a low flame overnight, until the cream and the butter stop being separate things.",
  },
  {
    numeral: "III",
    icon: "🛵",
    title: "Hot on Arrival",
    copy: "Insulated bags and short routes across Rohini and NSP, so it reaches you at the heat it left at.",
  },
];

const TRUST = [
  { icon: "⭐", label: "4.6 average rating" },
  { icon: "📍", label: "Rohini & NSP, Delhi" },
  { icon: "🟢", label: "Pure veg options" },
];

/** Splits a line into masked, index-staggered words for the rise animation. */
function StaggerWords({ text, delayMs = 0 }: { text: string; delayMs?: number }) {
  const words = text.split(" ");
  return (
    <>
      {words.map((w, i) => (
        // The separating space is a sibling of the mask, never inside it: a
        // space within an `overflow: hidden` inline-block collapses, and the
        // words would run together once the animation settled.
        <Fragment key={`${w}-${i}`}>
          <span
            className="word"
            style={{ "--i": i, "--delay": `${delayMs}ms` } as React.CSSProperties}
          >
            <i>{w}</i>
          </span>
          {i < words.length - 1 ? " " : null}
        </Fragment>
      ))}
    </>
  );
}

/*
 * Page order is the ordering flow, not the brochure order.
 *
 * The story used to sit between the hero and the branch cards, which put an
 * essay between a hungry customer and the only control on the page that starts
 * an order — on a phone the branches were two full screens down, below a fold
 * nothing invited you past. Hero → branches → why us → story puts the decision
 * first and keeps the writing for the people who scroll on.
 */
export default function LandingPage() {
  return (
    <>
      <SiteHeader showCart={false} />
      <Ticker items={TICKER} />

      <main className="min-h-screen">
        {/* ------------------------------------------------------------ hero */}
        <section className="relative overflow-hidden">
          <div
            aria-hidden
            className="pattern-jaali absolute inset-0 [mask-image:radial-gradient(ellipse_70%_60%_at_50%_20%,black,transparent_75%)]"
          />

          <div className="relative mx-auto max-w-5xl px-4 pt-10 pb-12 sm:pt-14">
            <div className="text-center">
              {/* The arch is the signature: a two-centred Mughal profile with a
                  jaali screen inside, drawn on as the page settles. */}
              <ArchCrest className="draw mx-auto w-[190px] sm:w-[230px] text-mustard-500" />

              {/* No negative margin here: the arch's jambs run all the way to
                  the bottom of its viewBox, so pulling the kicker up would
                  cross the tracked-out capitals straight through them. */}
              <p className="eyebrow mt-2">A North Delhi kitchen</p>

              <p className="font-display text-mustard-600 text-fluid-lg font-medium mt-4">
                <StaggerWords text="दिल से बना, दिल तक पहुँचा" delayMs={420} />
              </p>

              <h1 className="font-display text-foil wipe-in text-fluid-4xl font-semibold tracking-wordmark mt-2 [animation-delay:250ms]">
                DilKhush Dhaba
              </h1>

              <p className="divider-ornament mt-4 font-display text-fluid-lg font-medium text-mustard-600">
                Raita Wala
              </p>

              <p className="mt-6 mx-auto max-w-xl text-fluid-base text-maroon-800/75">
                <StaggerWords
                  text="Authentic North Indian dhaba food — dal makhani simmered overnight, hot rotis off the tawa, and the raita that gave us our name."
                  delayMs={620}
                />
              </p>

              {/*
                Both actions are anchors rather than buttons: the branch menu is
                branch-specific, so every route into the food goes through the
                picker, and naming a slug here would hard-code a branch the
                owner is free to rename or close.
              */}
              <div className="reveal mt-8 flex flex-col sm:flex-row gap-3 justify-center items-stretch sm:items-center">
                <a href="#branches" className="btn-primary sm:min-w-[15rem]">
                  🍽️ Start your order
                </a>
                <a href="#story" className="btn-outline">
                  See how we cook
                </a>
              </div>

              <ul className="mt-8 flex flex-wrap items-center justify-center gap-y-3 text-sm font-semibold text-maroon-700">
                {TRUST.map((t, i) => (
                  <li
                    key={t.label}
                    className={`inline-flex items-center gap-2 px-4 sm:px-5 ${
                      i > 0 ? "sm:border-l sm:border-maroon-800/15" : ""
                    }`}
                  >
                    <span aria-hidden className="text-mustard-500">
                      {t.icon}
                    </span>
                    {t.label}
                  </li>
                ))}
              </ul>

              {/* Says there is more below without asking for a tap. */}
              <p
                aria-hidden
                className="scroll-cue mt-9 font-display text-2xl leading-none text-mustard-500"
              >
                ⌄
              </p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------------- branches */}
        <section id="branches" className="mx-auto max-w-5xl px-4 pt-4">
          <header className="text-center mb-7">
            <p className="eyebrow">Two kitchens</p>
            <h2 className="font-display text-fluid-2xl font-semibold text-maroon-700 mt-1.5">
              Which one is closest to you?
            </h2>
            <FlourishRule className="mx-auto w-40 mt-4 text-mustard-500" />
          </header>
        </section>

        <BranchPicker />

        {/* ----------------------------------------------------------- craft */}
        <section className="mx-auto max-w-5xl px-4 py-16" aria-labelledby="craft">
          <header className="text-center mb-10">
            <p className="eyebrow">Why order from us</p>
            <h2
              id="craft"
              className="font-display text-fluid-2xl font-semibold text-maroon-700 mt-1.5"
            >
              Three things we refuse to rush
            </h2>
          </header>

          <div className="grid gap-6 sm:grid-cols-3">
            {CRAFT.map((c, i) => (
              <article
                key={c.title}
                className="reveal card p-7 text-center"
                style={{ "--i": i } as React.CSSProperties}
              >
                <span
                  aria-hidden
                  className="mx-auto grid place-items-center h-16 w-16 rounded-full text-2xl
                    bg-gradient-to-b from-mustard-100 to-cream-200
                    ring-1 ring-mustard-400/40
                    shadow-[inset_0_1px_0_rgba(255,255,255,0.85)]"
                >
                  {c.icon}
                </span>
                {/* Roman numerals read as a set rather than a list of features. */}
                <p className="font-display text-mustard-500 text-lg font-semibold tracking-[0.2em] mt-4">
                  {c.numeral}
                </p>
                <h3 className="font-display text-fluid-lg font-semibold text-maroon-700 mt-1">
                  {c.title}
                </h3>
                <p className="text-sm text-maroon-800/70 mt-2.5 leading-relaxed">{c.copy}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ----------------------------------------------------------- story */}
        <section id="story" className="mx-auto max-w-5xl px-4 pb-16" aria-labelledby="story-title">
          <div className="frame px-6 py-10 sm:px-14 sm:py-14">
            <div className="max-w-2xl mx-auto">
              <p className="eyebrow text-center">Our kitchen</p>
              <h2
                id="story-title"
                className="font-display text-fluid-3xl font-semibold text-maroon-700 text-center mt-2"
              >
                Cooked the long way round
              </h2>
              <FlourishRule className="draw mx-auto w-44 mt-5 text-mustard-500" />

              <p className="dropcap mt-7 text-fluid-base text-maroon-800/80 leading-relaxed">
                Every dhaba worth the name is built on patience. Ours starts before the shutters go
                up: black urad soaking since the night before, onions browning slowly enough to go
                sweet instead of bitter, the tawa coming up to heat in its own time. Nothing here
                is finished in a hurry, because the things that make this food taste like home are
                the ones that cannot be rushed.
              </p>
              <p className="mt-4 text-fluid-base text-maroon-800/75 leading-relaxed">
                The raita is churned fresh every morning — thick, cold, flecked with roasted jeera.
                It is the thing people come back for, and the reason the board outside says{" "}
                <em className="text-maroon-700 not-italic font-semibold">Raita Wala</em>.
              </p>

              {/* Whoever read all of that is interested. Do not make them
                  scroll back up to act on it. */}
              <p className="text-center mt-9">
                <a href="#branches" className="btn-secondary">
                  Pick a branch and order →
                </a>
              </p>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------- footer */}
        <footer className="border-t border-maroon-800/10 bg-cream-50/70">
          <div className="mx-auto max-w-5xl px-4 py-14 text-center">
            <span
              aria-hidden
              className="mx-auto grid place-items-center h-12 w-12 rounded-full
                bg-gradient-to-b from-mustard-200 to-mustard-500 ring-1 ring-mustard-600/60
                shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_2px_6px_-2px_rgba(61,18,17,0.4)]"
            >
              <span className="font-display text-lg font-semibold text-maroon-800">DK</span>
            </span>
            <p className="font-display text-fluid-lg font-semibold text-maroon-700 mt-4">
              DilKhush Dhaba – Raita Wala
            </p>
            <p className="text-sm text-maroon-800/65 mt-1">
              Rohini &amp; NSP, Delhi · Delivery &amp; Pickup
            </p>
            <FlourishRule className="mx-auto w-40 my-7 text-mustard-500" />
            <p className="text-xs text-maroon-800/45">
              © {new Date().getFullYear()} DilKhush Dhaba – Raita Wala. All rights reserved.
            </p>
          </div>
        </footer>
      </main>
    </>
  );
}
