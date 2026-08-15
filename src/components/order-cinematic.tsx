"use client";

import { useEffect } from "react";

export type CinematicPhase = "driving" | "arrived";

/**
 * Sideways drift, in px, for each marigold petal at the arrival. Hand-picked
 * rather than random so the fall is the same every time — a shower that
 * reshuffles itself on each order reads as noise, not as choreography.
 */
const PETALS = [-26, 14, -8, 30, -34, 6, 22, -16];

/**
 * "DilKhush Dhaba – Rohini" → "Rohini". Both ends of the route label have to
 * fit on one line of a 320px phone, and the brand half is the half every
 * branch shares.
 */
function shortBranch(name: string) {
  const tail = name.split(/[–—-]/).pop()?.trim();
  return tail || name;
}

/**
 * The interstitial between the swipe and the order page.
 *
 * Placing an order is the moment the whole app exists for, and a spinner says
 * nothing about what is actually happening. This says it literally: the order
 * leaves the customer, runs the road, and arrives at the dhaba — and it holds
 * the screen just long enough that the confirmation lands as an event rather
 * than a page that quietly replaced another one.
 *
 * Every moving part is CSS. Under `prefers-reduced-motion` the global rule in
 * globals.css collapses the animations, and each one is written so its *end*
 * state is the finished scene: the car parked at the dhaba with the seal
 * stamped, which is exactly the right still frame.
 */
export function OrderCinematic({
  phase,
  branchName,
}: {
  phase: CinematicPhase;
  branchName: string;
}) {
  // Nothing behind this is reachable while it is up, and a stray scroll during
  // the drive would look like the page had gone loose.
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, []);

  // Everything decorative below is aria-hidden, so the live region is only the
  // caption — "Placing your order", and then "Order placed".
  return (
    <div className="cinema no-print" data-phase={phase} role="status" aria-atomic="true">
      <div className="cinema__grain" aria-hidden />

      <div className="cinema__panel">
        {/*
          Ordered back to front, and that order *is* the depth: the further a
          layer is, the less ground it covers over the same clock. See the
          parallax block in globals.css for the ratios.
        */}
        <div className="cinema__scene" aria-hidden>
          <div className="cinema__world">
            <div className="cinema__sky" />
            <div className="cinema__stars" />
            <div className="cinema__moon" />
            <div className="cinema__cloud cinema__cloud--a" />
            <div className="cinema__cloud cinema__cloud--b" />

            <div className="cinema__far" />
            <div className="cinema__skyline" />
            <div className="cinema__haze" />
            <div className="cinema__props" />

            <div className="cinema__dhaba">
              <Dhaba />
            </div>

            <div className="cinema__road">
              <div className="cinema__lane" />
            </div>

            <div className="cinema__car">
              <div className="cinema__bob">
                <div className="cinema__rig">
                  {[0, 1, 2].map((w) => (
                    <span key={w} className="cinema__whoosh" style={{ "--w": w } as React.CSSProperties} />
                  ))}
                  {[0, 1, 2].map((d) => (
                    <span key={d} className="cinema__dust" style={{ "--d": d } as React.CSSProperties} />
                  ))}
                  <span className="cinema__beam" />
                  <span className="cinema__pool" />
                  <span className="cinema__brake" />
                  <Car />
                </div>
              </div>
            </div>

            {/* In front of the car, blurred, and moving fastest of anything on
                screen — the layer that actually sells the speed. */}
            <div className="cinema__fg" />
            <div className="cinema__streaks" />
            <div className="cinema__vignette" />

            <div className="cinema__petals">
              {PETALS.map((dx, i) => (
                <span
                  key={i}
                  className="cinema__petal"
                  style={{ "--i": i, "--dx": dx } as React.CSSProperties}
                />
              ))}
            </div>
          </div>
        </div>

        {/* The journey, spelled out — the scene is the drama, this is the fact. */}
        <div className="cinema__route" aria-hidden>
          <span className="cinema__pin" />
          <span className="cinema__track">
            <span className="cinema__trace" />
          </span>
          <span className="cinema__pin cinema__pin--end" />
        </div>
        <div className="cinema__legend" aria-hidden>
          <span>Your order</span>
          <span>{shortBranch(branchName)}</span>
        </div>

        <div className="cinema__caption">
          {phase === "driving" ? (
            <>
              <p className="eyebrow">On its way to the kitchen</p>
              <p className="cinema__headline">
                Placing your order
                <span className="cinema__dots">
                  <span />
                  <span />
                  <span />
                </span>
              </p>
              <p className="cinema__sub">Hold on — don&apos;t close this page.</p>
            </>
          ) : (
            <>
              <span className="cinema__seal">
                <span className="cinema__seal-ring" />
                <svg viewBox="0 0 48 48" className="draw cinema__seal-tick" aria-hidden>
                  <path
                    pathLength={1}
                    d="M13 24.5 20.5 32 35 16"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <p className="cinema__headline cinema__headline--done">Order placed</p>
              <p className="cinema__sub">{branchName} has it. Taking you to the tracker…</p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** The destination: a lit dhaba front, arch doorway and brass board. */
function Dhaba() {
  return (
    <svg viewBox="0 0 96 94" className="cinema__dhaba-svg" aria-hidden>
      <defs>
        <linearGradient id="dk-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#EEDCAB" />
          <stop offset="0.5" stopColor="#C9A94E" />
          <stop offset="1" stopColor="#856A1D" />
        </linearGradient>
        <radialGradient id="dk-glow" cx="0.5" cy="0.85" r="0.8">
          <stop offset="0" stopColor="#F7EDD3" />
          <stop offset="1" stopColor="#C9A94E" />
        </radialGradient>
      </defs>

      <rect x="2" y="86" width="92" height="8" rx="2" fill="#2A0C0B" />
      <rect x="10" y="36" width="76" height="50" fill="#591917" />
      <path d="M2 36 L13 22 L83 22 L94 36 Z" fill="#3D1211" />
      <path d="M2 36 L94 36 L94 39 L2 39 Z" fill="url(#dk-brass)" opacity="0.75" />

      {/* Signboard */}
      <rect x="21" y="23" width="54" height="13" rx="2.5" fill="url(#dk-brass)" />
      <text
        x="48"
        y="33"
        textAnchor="middle"
        fontFamily="Georgia, serif"
        fontSize="10"
        fontWeight="700"
        fill="#2A0C0B"
        letterSpacing="1.5"
      >
        DK
      </text>

      {/* Arch doorway, lit from inside */}
      <path d="M35 86 V60 a13 13 0 0 1 26 0 V86 Z" fill="url(#dk-glow)" />
      <path
        d="M35 86 V60 a13 13 0 0 1 26 0 V86"
        fill="none"
        stroke="#856A1D"
        strokeWidth="2"
      />

      <rect x="15" y="50" width="13" height="14" rx="2" fill="url(#dk-glow)" opacity="0.9" />
      <rect x="68" y="50" width="13" height="14" rx="2" fill="url(#dk-glow)" opacity="0.9" />
    </svg>
  );
}

/** The courier: a small delivery car with a tiffin box strapped to the roof. */
function Car() {
  return (
    <svg viewBox="0 0 122 62" className="cinema__car-svg" aria-hidden>
      <defs>
        <linearGradient id="dk-car" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#A63F3B" />
          <stop offset="0.55" stopColor="#8A2622" />
          <stop offset="1" stopColor="#591917" />
        </linearGradient>
        <linearGradient id="dk-glass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#F7EDD3" stopOpacity="0.95" />
          <stop offset="1" stopColor="#DFC57C" stopOpacity="0.55" />
        </linearGradient>
      </defs>

      <ellipse cx="63" cy="58" rx="52" ry="3.6" fill="#170606" opacity="0.45" />

      {/* Wheels sit under the body, so the arches come for free. */}
      <g className="cinema__wheel">
        <circle cx="34" cy="48" r="9.5" fill="#1B0A09" />
        <circle cx="34" cy="48" r="4" fill="#C9A94E" />
        <path
          d="M34 39.5 V56.5 M25.5 48 H42.5"
          stroke="#8A2622"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>
      <g className="cinema__wheel">
        <circle cx="96" cy="48" r="9.5" fill="#1B0A09" />
        <circle cx="96" cy="48" r="4" fill="#C9A94E" />
        <path
          d="M96 39.5 V56.5 M87.5 48 H104.5"
          stroke="#8A2622"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </g>

      {/* Tiffin box on the roof — rocking on its straps over every bump. */}
      <g className="cinema__tiffin">
        <rect x="46" y="1.5" width="30" height="11" rx="3.5" fill="#856A1D" />
        <rect x="46" y="5.5" width="30" height="2.6" fill="#EEDCAB" opacity="0.85" />
        <rect x="57" y="0" width="8" height="3" rx="1.5" fill="#DFC57C" />
      </g>

      {/* Body */}
      <path
        d="M10 48 L10 36 C10 32 12 30 16 29 L36 26 L46 15
           C48 13 51 12 54 12 L74 12 C78 12 81 13 84 16 L94 27
           L108 31 C113 33 116 36 116 41 L116 45 C116 47 114 48 112 48 Z"
        fill="url(#dk-car)"
      />
      <path
        d="M10 36 L36 33 L94 33 L116 41"
        fill="none"
        stroke="#DFC57C"
        strokeWidth="1.4"
        opacity="0.5"
      />

      {/* Glass */}
      <path d="M43 26 L51 16.5 C52 15.5 53 15 55 15 L61 15 L61 26 Z" fill="url(#dk-glass)" />
      <path d="M65 15 L74 15 C77 15 79 16 81 18 L88 26 L65 26 Z" fill="url(#dk-glass)" />

      <rect x="10" y="34" width="4.5" height="5" rx="1.6" fill="#F1D8D6" opacity="0.8" />
      <ellipse cx="112" cy="38.5" rx="4" ry="3.2" fill="#F7EDD3" />
    </svg>
  );
}
