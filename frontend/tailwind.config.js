/** @type {import('tailwindcss').Config} */
const config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: '#020617',
          foreground: '#0f172a',
          highlight: '#1e293b',
        },
        brand: {
          DEFAULT: '#22c55e',
          muted: '#4ade80',
        },
        timer: {
          default: '#22c55e',
          warning: '#fbbf24',
          critical: '#f87171',
        },
      },
      fontFamily: {
        display: ['"Space Grotesk"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        card: '0 10px 25px -5px rgba(15, 23, 42, 0.45)',
      },
    },
  },
  plugins: [],
}

export default config
