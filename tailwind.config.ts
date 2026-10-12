import type { Config } from "tailwindcss";

const c = (v: string) => `rgb(var(--${v}) / <alpha-value>)`;

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: c("bg"),
        surface: c("surface"),
        ink: c("ink"),
        muted: c("muted"),
        line: c("line"),
        accent: c("accent"),
        "accent-ink": c("accent-ink"),
        warn: c("warn"),
        gold: c("gold"),
        hero: c("hero"),
        "hero-ink": c("hero-ink"),
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", "Georgia", "serif"],
        sans: ["system-ui", "-apple-system", '"Segoe UI"', "Roboto", "sans-serif"],
      },
      keyframes: {
        pulseRing: {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "100%": { transform: "scale(1.9)", opacity: "0" },
        },
        rise: { from: { transform: "translateY(12px)", opacity: "0" }, to: { transform: "none", opacity: "1" } },
      },
      animation: { pulseRing: "pulseRing 1.6s ease-out infinite", rise: "rise .25s ease-out both" },
    },
  },
  plugins: [],
};
export default config;
