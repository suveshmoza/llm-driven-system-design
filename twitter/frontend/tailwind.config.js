/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        twitter: {
          // Primary brand color
          blue: '#1DA1F2',
          blueHover: '#1A91DA',

          // Light mode backgrounds
          white: '#FFFFFF',
          background: '#F7F9FA',

          // Dark mode backgrounds (for future use)
          darkBg: '#15202B',
          lightsOut: '#000000',
          darkSecondary: '#192734',

          // Light mode text
          dark: '#0F1419',
          gray: '#536471',

          // Dark mode text (for future use)
          darkText: '#E7E9EA',
          darkGray: '#8B98A5',

          // Borders
          border: '#EFF3F4',
          extraLightGray: '#EFF3F4',
          darkBorder: '#38444D',

          // Action colors
          like: '#F91880',
          likeHover: '#F4245E',
          retweet: '#00BA7C',
          retweetHover: '#00A570',
          bookmark: '#1DA1F2',

          // Legacy colors (for backwards compatibility)
          lightGray: '#AAB8C2',
        },
      },
      fontSize: {
        'tweet': '15px',
      },
    },
  },
  plugins: [],
};
