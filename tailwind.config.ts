import type { Config } from "tailwindcss";

/**
 * The palette is deliberately narrow: parchment, oxblood and antique brass.
 * Every shade is a retune of the original dhaba colours towards lower chroma
 * and higher contrast — the same warmth, but it holds up as a printed menu
 * card rather than a bright app theme.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Parchment. 50 is the page-white; 300/400 are the hairline rules.
        cream: {
          50: "#FDFBF6",
          100: "#F8F3E8",
          200: "#EFE6D3",
          300: "#E0D3B7",
          400: "#C9B896",
        },
        // Oxblood. 700–900 carry text, 500–600 carry the primary action.
        maroon: {
          50: "#FAEFEE",
          100: "#F1D8D6",
          200: "#E2B0AD",
          300: "#C97B77",
          400: "#A63F3B",
          500: "#8A2622",
          600: "#71201C",
          700: "#591917",
          800: "#3D1211",
          900: "#2A0C0B",
          950: "#170606",
        },
        // Antique brass, not highlighter yellow — 500/600 are legible on cream.
        mustard: {
          100: "#F7EDD3",
          200: "#EEDCAB",
          300: "#DFC57C",
          400: "#C9A94E",
          500: "#A8862B",
          600: "#856A1D",
        },
        leaf: {
          50: "#EDF4EC",
          500: "#2C6E36",
          600: "#22572A",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "Cambria", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      // A fluid scale so headings breathe on desktop without a pile of
      // sm:/lg: variants at every call site.
      fontSize: {
        "fluid-sm": ["clamp(0.8125rem, 0.79rem + 0.12vw, 0.875rem)", { lineHeight: "1.5" }],
        "fluid-base": ["clamp(0.9375rem, 0.91rem + 0.15vw, 1rem)", { lineHeight: "1.65" }],
        "fluid-lg": ["clamp(1.0625rem, 1rem + 0.3vw, 1.1875rem)", { lineHeight: "1.55" }],
        "fluid-xl": ["clamp(1.25rem, 1.13rem + 0.6vw, 1.5rem)", { lineHeight: "1.3" }],
        "fluid-2xl": ["clamp(1.5rem, 1.3rem + 1vw, 2rem)", { lineHeight: "1.2" }],
        "fluid-3xl": ["clamp(1.875rem, 1.5rem + 1.9vw, 2.75rem)", { lineHeight: "1.12" }],
        "fluid-4xl": ["clamp(2.5rem, 1.8rem + 3.4vw, 4.25rem)", { lineHeight: "1.02" }],
      },
      letterSpacing: {
        kicker: "0.22em",
        wordmark: "-0.022em",
      },
      borderRadius: {
        card: "0.875rem",
        plaque: "1.25rem",
      },
      boxShadow: {
        // Layered, warm-tinted elevation. Each level keeps a tight contact
        // shadow plus a wide ambient one — a single blur reads like a sticker.
        hairline: "0 0 0 1px rgba(61, 18, 17, 0.07)",
        card: "0 1px 1px rgba(61,18,17,0.04), 0 2px 6px rgba(61,18,17,0.05), 0 8px 20px -8px rgba(61,18,17,0.10)",
        lift: "0 1px 1px rgba(61,18,17,0.05), 0 6px 16px -4px rgba(61,18,17,0.10), 0 20px 40px -12px rgba(61,18,17,0.20)",
        plaque:
          "0 1px 0 rgba(255,255,255,0.7) inset, 0 1px 2px rgba(61,18,17,0.05), 0 12px 32px -14px rgba(61,18,17,0.28)",
        press: "0 1px 2px rgba(61,18,17,0.18) inset",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        spring: "cubic-bezier(0.34, 1.4, 0.64, 1)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(12px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "fade-in": { from: { opacity: "0" }, to: { opacity: "1" } },
        "sheet-up": {
          from: { opacity: "0", transform: "translateY(24px) scale(0.99)" },
          to: { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        shimmer: { "100%": { transform: "translateX(100%)" } },
      },
      animation: {
        "fade-up": "fade-up 0.55s cubic-bezier(0.16, 1, 0.3, 1) both",
        "fade-in": "fade-in 0.4s ease-out both",
        "sheet-up": "sheet-up 0.32s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
