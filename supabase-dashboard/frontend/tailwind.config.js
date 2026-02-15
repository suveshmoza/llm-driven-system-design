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
        supabase: {
          bg: '#1C1C1C',
          surface: '#2A2A2A',
          sidebar: '#1C1C1C',
          primary: '#3ECF8E',
          hover: '#36B87D',
          text: '#EDEDED',
          secondary: '#8F8F8F',
          border: '#3E3E3E',
          success: '#3ECF8E',
          warning: '#F5A623',
          danger: '#EF4444',
          dark: {
            bg: '#181818',
            surface: '#1F1F1F',
            border: '#2E2E2E',
          },
        },
      },
    },
  },
  plugins: [],
};
