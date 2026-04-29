/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ea: {
          deep: '#011f4b',
          primaryDark: '#03396c',
          primary: '#005b96',
          muted: '#6497b1',
          soft: '#b3cde0',
        },
      },
      fontFamily: {
        sans: [
          '"Plus Jakarta Sans"',
          'ui-sans-serif',
          'system-ui',
          'sans-serif',
        ],
      },
      keyframes: {
        'ea-tab-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'ea-tab-in': 'ea-tab-in 0.22s ease-out forwards',
      },
    },
  },
  plugins: [],
};
