/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        loom: {
          bg: '#F9FAFB',
          surface: '#FFFFFF',
          sidebar: '#1B1B1B',
          primary: '#625DF5',
          hover: '#524EC5',
          text: '#1A1A2E',
          secondary: '#73738C',
          border: '#E5E5E5',
          success: '#00B67A',
          warning: '#F5A623',
          danger: '#FF4757',
          accent: '#FF6B6B',
        },
      },
    },
  },
  plugins: [],
};
