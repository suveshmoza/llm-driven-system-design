/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        zoom: {
          bg: '#1A1A2E',
          surface: '#16213E',
          controlbar: '#232323',
          primary: '#2D8CFF',
          hover: '#1A6FD1',
          green: '#00C853',
          red: '#FF1744',
          text: '#FFFFFF',
          secondary: '#A0A0A0',
          card: '#0F3460',
        },
      },
    },
  },
  plugins: [],
};
