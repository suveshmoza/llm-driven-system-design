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
        // YouTube Brand Colors
        'yt-red': '#FF0000',
        'yt-red-hover': '#CC0000',
        'yt-red-dark': '#CC0000',

        // Dark mode backgrounds
        'yt-dark': '#0F0F0F',
        'yt-dark-secondary': '#212121',
        'yt-dark-lighter': '#181818',
        'yt-dark-hover': '#272727',
        'yt-dark-elevated': '#282828',

        // Light mode backgrounds
        'yt-light': '#FFFFFF',
        'yt-light-secondary': '#F9F9F9',
        'yt-light-hover': '#E5E5E5',

        // Text colors
        'yt-text-primary-dark': '#FFFFFF',
        'yt-text-primary-light': '#0F0F0F',
        'yt-text-secondary-dark': '#AAAAAA',
        'yt-text-secondary-light': '#606060',

        // Interactive colors
        'yt-blue': '#065FD4',
        'yt-blue-light': '#3EA6FF',
        'yt-subscribe': '#CC0000',
        'yt-subscribed': '#909090',

        // Legacy aliases for compatibility
        'yt-gray': '#AAAAAA',
      },
      fontFamily: {
        'youtube': ['Roboto', 'Arial', 'sans-serif'],
      },
      fontSize: {
        'yt-title': ['14px', { lineHeight: '20px', fontWeight: '500' }],
        'yt-title-lg': ['16px', { lineHeight: '22px', fontWeight: '500' }],
        'yt-channel': ['12px', { lineHeight: '18px', fontWeight: '400' }],
        'yt-meta': ['12px', { lineHeight: '18px', fontWeight: '400' }],
      },
    },
  },
  plugins: [],
}
