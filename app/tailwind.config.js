/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "theme-bg": "var(--theme-bg)",
        "theme-fg": "var(--theme-fg)",
        "theme-accent": "var(--theme-accent)",
      },
    },
  },
  plugins: [],
}
