/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Pinterest Red (primary)
        'pinterest-red': '#E60023',
        'pinterest-red-hover': '#AD081B',
        'pinterest-red-light': '#FF5247',
        // Background colors
        'gray-bg': '#F0F0F0',
        'dark-bg': '#111111',
        // Text colors
        'text-primary': '#111111',
        'text-secondary': '#767676',
        'text-gray': '#999999',
        // Border colors
        'border-gray': '#CDCDCD',
        'border-dark': '#3A3A3A',
        // Button colors
        'btn-secondary': '#E2E2E2',
        'btn-secondary-hover': '#D5D5D5',
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica Neue',
          'Arial',
          'sans-serif',
        ],
      },
      borderRadius: {
        'pinterest': '16px',
        'pinterest-lg': '24px',
        'pinterest-xl': '32px',
      },
      boxShadow: {
        'pin': '0 1px 2px rgba(0,0,0,0.1)',
        'pin-hover': '0 4px 12px rgba(0,0,0,0.15)',
        'modal': '0 4px 24px rgba(0,0,0,0.25)',
      },
    },
  },
  plugins: [],
};
