/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        confluence: {
          primary: '#0052CC',
          hover: '#0747A6',
          bg: '#FAFBFC',
          sidebar: '#F4F5F7',
          page: '#FFFFFF',
          info: '#DEEBFF',
          warning: '#FFFAE6',
          note: '#EAE6FF',
          success: '#00875A',
          danger: '#DE350B',
          border: '#DFE1E6',
          text: '#172B4D',
          'text-subtle': '#6B778C',
          'text-muted': '#97A0AF',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Oxygen',
          'Ubuntu',
          'Fira Sans',
          'Droid Sans',
          'Helvetica Neue',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
};
