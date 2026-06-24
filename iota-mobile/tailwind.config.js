/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#030014",
        card: "rgba(255, 255, 255, 0.03)",
        primary: {
          DEFAULT: "#6366f1",
          glow: "#818cf8"
        },
        secondary: {
          DEFAULT: "#10b981",
          glow: "#34d399"
        },
        accent: {
          DEFAULT: "#f43f5e",
          glow: "#fb7185"
        },
        muted: "#94a3b8",
        border: "rgba(255, 255, 255, 0.08)"
      },
      fontFamily: {
        mono: ["Courier New", "Courier", "monospace"]
      }
    },
  },
  plugins: [],
}
