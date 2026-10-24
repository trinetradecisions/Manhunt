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
        background: '#0F1923',
        surface: '#1F2731',
        'surface-elevated': '#293440',
        'surface-panel': '#161e27',
        valorant: {
          bg: '#0F1923',
          surface: '#1F2731',
          panel: '#293440',
          red: '#FF4655',
          accent: '#FF4655',
          text: '#ECE8E1',
          muted: '#A8B0BA',
          border: '#3B4652',
          success: '#4CC38A',
          warning: '#F5B544',
          cyan: '#39BDE8',
          runner: '#39BDE8',
          chaser: '#FF4655',
        },
        tactical: {
          runner: '#39BDE8', // Accessible cyan
          chaser: '#FF4655', // Crimson
          referee: '#3b82f6', // blue
          danger: '#FF4655', // crimson
          radio: '#8b5cf6', // violet
          lime: '#4CC38A', // tactical green / lime
          border: '#3B4652',
          muted: '#A8B0BA',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'tactical-glow': '0 0 25px -4px rgba(255, 70, 85, 0.35)',
        'runner-glow': '0 0 25px -4px rgba(57, 189, 232, 0.35)',
        'chaser-glow': '0 0 25px -4px rgba(255, 70, 85, 0.35)',
        'lime-glow': '0 0 25px -4px rgba(76, 195, 138, 0.35)',
      },
    },
  },
  plugins: [],
};
