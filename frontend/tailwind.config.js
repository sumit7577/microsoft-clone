/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        dark: {
          900: '#0a0a0f',
          800: '#0f1018',
          700: '#151620',
          600: '#1a1b2e',
          500: '#232440',
        },
        accent: '#00e5ff',
        neon: {
          cyan: '#00e5ff',
          purple: '#b388ff',
          green: '#00e676',
          red: '#ff1744',
          amber: '#ffc400',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};
