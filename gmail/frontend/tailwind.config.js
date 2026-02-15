/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        'gmail-blue': '#1A73E8',
        'gmail-blue-hover': '#1557B0',
        'gmail-bg': '#F6F8FC',
        'gmail-sidebar': '#F6F8FC',
        'gmail-read': '#F2F6FC',
        'gmail-unread': '#FFFFFF',
        'gmail-star': '#F4B400',
        'gmail-danger': '#D93025',
        'gmail-border': '#E0E0E0',
        'gmail-text': '#202124',
        'gmail-text-secondary': '#5F6368',
        'gmail-hover': '#E8EAED',
      },
      fontFamily: {
        sans: ['Google Sans', 'Roboto', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Helvetica', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
