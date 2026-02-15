/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'cb-bg': '#0A0B0D',
        'cb-surface': '#1E2026',
        'cb-card': '#16171A',
        'cb-primary': '#0052FF',
        'cb-primary-hover': '#0040CC',
        'cb-green': '#00C087',
        'cb-red': '#FF3B30',
        'cb-text': '#FFFFFF',
        'cb-text-secondary': '#8A919E',
        'cb-border': '#2C2D33',
        'cb-yellow': '#FFB800',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
