/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Instagram Blue (primary action color)
        primary: '#0095F6',
        'primary-hover': '#1877F2',
        // Secondary color
        secondary: '#00376b',
        // Background colors
        'gray-bg': '#FAFAFA',
        'dark-bg': '#000000',
        // Border color
        'border-gray': '#DBDBDB',
        'border-dark': '#262626',
        // Text colors
        'text-primary': '#262626',
        'text-secondary': '#8E8E8E',
        'text-gray': '#8E8E8E',
        // Heart/Like color
        'like-red': '#ED4956',
        // Gradient colors
        'gradient-purple': '#833AB4',
        'gradient-red': '#FD1D1D',
        'gradient-orange': '#FCB045',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
        logo: ['Billabong', 'cursive', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
      },
      backgroundImage: {
        'instagram-gradient': 'linear-gradient(45deg, #833AB4, #FD1D1D, #FCB045)',
        'story-ring': 'linear-gradient(45deg, #FCB045, #FD1D1D, #833AB4)',
      },
    },
  },
  plugins: [],
};
