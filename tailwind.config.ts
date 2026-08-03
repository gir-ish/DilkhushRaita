import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        cream: {
          50: "#FDFAF3",
          100: "#FAF3E3",
          200: "#F3E7CB",
          300: "#EAD7A9",
          400: "#DCC38A",
        },
        maroon: {
          50: "#FBEDED",
          100: "#F3D2D2",
          200: "#E7ACAC",
          300: "#D47C7C",
          400: "#B03A3A",
          500: "#8E2323",
          600: "#7B1E1E",
          700: "#621717",
          800: "#4A1111",
          900: "#330B0B",
        },
        mustard: {
          100: "#F8ECC9",
          200: "#F2DDA0",
          300: "#EBC96A",
          400: "#DFB53E",
          500: "#C89B22",
          600: "#A97F14",
        },
        leaf: {
          50: "#EDF6EE",
          500: "#2E7D32",
          600: "#256428",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      borderRadius: {
        card: "1rem",
      },
      boxShadow: {
        // Warm-tinted, layered elevation — reads softer than neutral grey shadows
        // against the cream background.
        card: "0 1px 2px rgba(74, 17, 17, 0.05), 0 4px 14px rgba(74, 17, 17, 0.07)",
        lift: "0 4px 10px rgba(74, 17, 17, 0.08), 0 14px 32px rgba(74, 17, 17, 0.14)",
        inset: "inset 0 1px 0 rgba(255, 255, 255, 0.35)",
      },
      keyframes: {
        "fade-up": {
          from: { opacity: "0", transform: "translateY(10px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "100%": { transform: "translateX(100%)" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.45s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
};
export default config;
