/**
 * Hand-built SVG ornaments. These are the pieces that make the site look like
 * a place rather than a template: a two-centred Mughal arch (the jaali screen
 * motif that runs through Indo-Islamic architecture) and a flourish rule.
 *
 * Both are pure geometry — no image requests, they scale to any size, and they
 * take their colour from the surrounding text so they work on any surface.
 *
 * Every stroked path carries `pathLength="1"`, which normalises its length to
 * 1 regardless of the real geometry. That lets one CSS rule
 * (`stroke-dasharray: 1`) draw *any* of these paths on, with no per-path
 * length measured in JS.
 */

/** Two-centred arch: each half is an arc whose centre is the opposite spring point. */
const ARCH_OUTER = "M 60 300 L 60 260 A 280 280 0 0 1 200 17.5 A 280 280 0 0 1 340 260 L 340 300";
const ARCH_INNER = "M 80 300 L 80 260 A 240 240 0 0 1 200 52.2 A 240 240 0 0 1 320 260 L 320 300";

export function ArchCrest({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 400 300"
      className={className}
      fill="none"
      aria-hidden
      focusable="false"
    >
      <defs>
        {/* The lattice only shows inside the arch. */}
        <clipPath id="dk-arch-clip">
          <path d={ARCH_INNER} />
        </clipPath>
        <linearGradient id="dk-arch-brass" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="currentColor" stopOpacity="0.95" />
          <stop offset="100%" stopColor="currentColor" stopOpacity="0.35" />
        </linearGradient>
      </defs>

      {/* Jaali lattice: two sets of 45° lines crossing inside the arch. */}
      <g clipPath="url(#dk-arch-clip)" stroke="currentColor" strokeOpacity="0.28" strokeWidth="1.5">
        {Array.from({ length: 22 }, (_, i) => (
          <line key={`a${i}`} x1={-260 + i * 34} y1={320} x2={60 + i * 34} y2={0} />
        ))}
        {Array.from({ length: 22 }, (_, i) => (
          <line key={`b${i}`} x1={-260 + i * 34} y1={0} x2={60 + i * 34} y2={320} />
        ))}
      </g>

      <path
        d={ARCH_OUTER}
        pathLength="1"
        stroke="url(#dk-arch-brass)"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d={ARCH_INNER}
        pathLength="1"
        stroke="currentColor"
        strokeOpacity="0.5"
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Finial: a lozenge and a bud sitting on the apex. */}
      <g fill="currentColor">
        <path d="M200 6 L208 20 L200 34 L192 20 Z" />
        <circle cx="200" cy="44" r="3.5" fillOpacity="0.7" />
      </g>
    </svg>
  );
}

/** Centred flourish for section breaks — a rule that tapers into a lotus bud. */
export function FlourishRule({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 24" className={className} fill="none" aria-hidden focusable="false">
      <path
        d="M2 12 H88"
        pathLength="1"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      <path
        d="M152 12 H238"
        pathLength="1"
        stroke="currentColor"
        strokeOpacity="0.45"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
      {/* Lotus bud: two mirrored petals over a lozenge. */}
      <path
        d="M120 3 C128 8 132 12 132 12 C132 12 128 16 120 21 C112 16 108 12 108 12 C108 12 112 8 120 3 Z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeOpacity="0.8"
      />
      <circle cx="120" cy="12" r="2.5" fill="currentColor" />
      <circle cx="98" cy="12" r="1.5" fill="currentColor" fillOpacity="0.55" />
      <circle cx="142" cy="12" r="1.5" fill="currentColor" fillOpacity="0.55" />
    </svg>
  );
}
