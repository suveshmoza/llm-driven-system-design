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
        teams: {
          bg: '#F5F5F5',
          surface: '#FFFFFF',
          sidebar: '#292929',
          primary: '#5B5FC7',
          hover: '#4F52B2',
          text: '#242424',
          secondary: '#616161',
          border: '#E0E0E0',
          success: '#6BB700',
          warning: '#F7630C',
          danger: '#D13438',
          chat: '#E8EBFA',
        },
      },
    },
  },
  plugins: [],
};
