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
        salesforce: {
          bg: '#F3F3F3',
          surface: '#FFFFFF',
          sidebar: '#032D60',
          primary: '#0176D3',
          hover: '#014486',
          text: '#181818',
          secondary: '#706E6B',
          border: '#C9C7C5',
          success: '#2E844A',
          warning: '#FE9339',
          danger: '#EA001E',
          cloud: '#00A1E0',
        },
      },
    },
  },
  plugins: [],
};
