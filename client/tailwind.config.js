/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        background: '#090d16',
        surface: '#111827',
        'surface-elevated': '#1f2937',
        tactical: {
          runner: '#10b981', // emerald
          chaser: '#f59e0b', // amber
          referee: '#3b82f6', // blue
          danger: '#ef4444', // crimson
          radio: '#8b5cf6', // violet
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'tactical-glow': '0 0 20px -5px rgba(245, 158, 11, 0.3)',
        'runner-glow': '0 0 20px -5px rgba(16, 185, 129, 0.3)',
      },
    },
  },
  plugins: [],
};
