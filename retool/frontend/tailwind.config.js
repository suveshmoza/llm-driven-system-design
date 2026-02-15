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
        retool: {
          bg: '#F5F5F5',
          surface: '#FFFFFF',
          sidebar: '#1C1C1E',
          primary: '#4B48EC',
          hover: '#3D3AC0',
          text: '#1C1C1E',
          secondary: '#6B7280',
          border: '#E5E7EB',
          grid: '#F0F0F0',
          success: '#10B981',
          warning: '#F59E0B',
          danger: '#EF4444',
        },
      },
    },
  },
  plugins: [],
};
