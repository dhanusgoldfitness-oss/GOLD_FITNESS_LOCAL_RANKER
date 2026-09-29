/** DGF brand tokens — swap the gold/ink values once the final logo palette is confirmed. */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: { 50: '#fff9e6', 100: '#ffefb8', 300: '#f5cf5b', 400: '#e8b923', 500: '#d4a017', 600: '#b3830f', 700: '#8a640c' },
        ink: { 950: '#080b14', 900: '#0d1220', 800: '#131a2c', 700: '#1c2540', 600: '#2a3556' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
