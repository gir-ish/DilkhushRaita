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
        },
        maroon: {
          50: "#FBEDED",
          100: "#F3D2D2",
          400: "#B03A3A",
          500: "#8E2323",
          600: "#7B1E1E",
          700: "#621717",
          800: "#4A1111",
        },
        mustard: {
          100: "#F8ECC9",
          300: "#EBC96A",
          400: "#DFB53E",
          500: "#C89B22",
          600: "#A97F14",
        },
        leaf: {
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
        card: "0 2px 12px rgba(74, 17, 17, 0.08)",
        lift: "0 8px 24px rgba(74, 17, 17, 0.14)",
      },
    },
  },
  plugins: [],
};
export default config;
