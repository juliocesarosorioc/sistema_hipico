const colors = require("tailwindcss/colors");

/** Design System centralizado — paleta semántica (área central en tema claro). */
module.exports = {
  content: [
    "./html/**/*.html",
    "./js/**/*.js",
    "./index.html",
    "./src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: colors.gray[50],
        surface: colors.white,
        surfaceAlt: colors.gray[100],
        line: colors.gray[200],
        primary: colors.cyan,
        secondary: colors.blue,
        success: colors.emerald,
        danger: colors.red,
        warning: colors.amber,
      },
      keyframes: {
        "bet-slip-slide": {
          "0%": { opacity: "0", transform: "translateX(16px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        "bet-slip-dock": {
          "0%": { opacity: "0", transform: "translateY(16px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "flash-total": {
          "0%": { backgroundColor: "rgba(16,185,129,0.9)" },
          "100%": { backgroundColor: "transparent" },
        },
      },
      animation: {
        "bet-slip-slide": "bet-slip-slide 0.22s ease-out",
        "bet-slip-dock": "bet-slip-dock 0.22s ease-out",
        "flash-total": "flash-total 0.6s ease-out",
      },
    },
  },
  plugins: [],
  safelist: [
    "text-success-600", "text-danger-600", "text-warning-600", "text-primary-600", "text-secondary-600",
    "bg-success-100", "bg-success-500",
    "bg-danger-100", "bg-danger-500",
    "bg-warning-100", "bg-warning-500",
    "bg-primary-100", "bg-primary-500",
  ],
};