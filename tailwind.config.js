/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ['class'],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        // Brand Colors
        primary: {
          50: '#e8f5ee',
          100: '#c8e6d5',
          200: '#a0d4b4',
          300: '#6ec292',
          400: '#48b378',
          500: '#2da362',
          600: '#228b50',
          700: '#1a7040',
          800: '#135630',
          900: '#0a3320',
        },
        secondary: {
          50: '#E6FFFA',
          100: '#B3F5ED',
          200: '#80EBE1',
          300: '#4DE1D5',
          400: '#26D7C9',
          500: '#00CCBB',
          600: '#00A699',
          700: '#008077',
          800: '#005955',
          900: '#003333',
        },
        success: {
          50: '#E8F7ED',
          100: '#C6EBD2',
          500: '#22A559',
          600: '#1A8045',
        },
        warning: {
          50: '#FFF8E6',
          100: '#FFEDB3',
          500: '#FFA500',
          600: '#CC8400',
        },
        error: {
          50: '#FEE8E7',
          100: '#FCC7C5',
          500: '#DC3545',
          600: '#B02A37',
        },
        neutral: {
          50: '#F8FAFC',
          100: '#EEF2F6',
          200: '#E3E8EF',
          300: '#CDD5DF',
          400: '#9AA4B2',
          500: '#697586',
          600: '#4B5565',
          700: '#364152',
          800: '#202939',
          900: '#121926',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
}