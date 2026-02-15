/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // Excalidraw-inspired colors
        'canvas-bg': '#ffffff',
        'toolbar-bg': '#1e1e1e',
        'toolbar-hover': '#343434',
        'toolbar-active': '#4a4a4a',
        'toolbar-text': '#d4d4d4',
        'panel-bg': '#f8f9fa',
        'panel-border': '#e9ecef',
        'selection-blue': '#6965db',
        'selection-light': '#e3e2fe',
        // Action colors
        'primary': '#6965db',
        'primary-hover': '#5753c9',
        'danger': '#e03131',
        'success': '#2f9e44',
        // Text
        'text-primary': '#1e1e1e',
        'text-secondary': '#868e96',
        'text-muted': '#adb5bd',
      },
      fontFamily: {
        sans: ['-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['Cascadia Code', 'Fira Code', 'monospace'],
        hand: ['Virgil', 'Segoe Print', 'cursive'],
      },
    },
  },
  plugins: [],
};
