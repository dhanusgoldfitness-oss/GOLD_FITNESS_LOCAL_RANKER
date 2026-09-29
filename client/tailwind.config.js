/** DigiMithra brand tokens. The `gold` key is kept as the accent-colour name across the code base but now holds the DigiMithra green. */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        gold: { 50: '#f3fbe0', 100: '#e2f5b8', 300: '#b5e04d', 400: '#9bd022', 500: '#84bd00', 600: '#6a9a00', 700: '#517500' },
        ink: { 950: '#050505', 900: '#0a0a0a', 800: '#111411', 700: '#1b201a', 600: '#2a3127' },
      },
      fontFamily: { sans: ['Inter', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};
