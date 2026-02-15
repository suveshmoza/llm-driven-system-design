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
        paypal: {
          bg: '#F5F7FA',
          surface: '#FFFFFF',
          sidebar: '#003087',
          primary: '#0070BA',
          hover: '#005EA6',
          text: '#2C2E2F',
          secondary: '#687173',
          border: '#CBD2D6',
          success: '#019849',
          warning: '#FF9600',
          danger: '#D20000',
        },
      },
    },
  },
  plugins: [],
};
