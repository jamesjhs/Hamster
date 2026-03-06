/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./public/**/*.{html,js}', './server.js'],
  theme: {
    extend: {
      colors: {
        hamster: {
          50:  '#fdf8f0',
          100: '#fdefd9',
          200: '#fad9a8',
          300: '#f7be6e',
          400: '#f3983a',
          500: '#ef7c17',
          600: '#d9600e',
          700: '#b54510',
          800: '#923717',
          900: '#782f16',
        },
      },
    },
  },
  plugins: [],
};
