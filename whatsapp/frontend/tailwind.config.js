/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        whatsapp: {
          // Primary brand colors
          green: '#25D366',
          'teal': '#128C7E',
          'teal-dark': '#075E54',

          // Header colors
          'header': '#008069',
          'header-dark': '#00A884',

          // Message bubbles
          'message-out': '#DCF8C6',
          'message-in': '#FFFFFF',

          // Backgrounds
          'chat-bg': '#ECE5DD',
          'panel-bg': '#FFFFFF',
          'sidebar-bg': '#FFFFFF',
          'search-bg': '#F0F2F5',
          'input-bg': '#F0F2F5',

          // Text colors
          'text-primary': '#111B21',
          'text-secondary': '#667781',

          // Status colors
          'blue-tick': '#53BDEB',
          'single-tick': '#667781',

          // Interactive
          'hover': '#F5F6F6',
          'selected': '#F0F2F5',
          'divider': '#E9EDEF',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          '"Segoe UI"',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
      fontSize: {
        'message': '14.2px',
        'contact': ['17px', { lineHeight: '21px' }],
        'timestamp': ['11px', { lineHeight: '15px' }],
      },
    },
  },
  plugins: [],
};
