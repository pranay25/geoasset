/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html','./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        bg:  '#07101e',
        sf:  '#0c1626',
        sf2: '#0f1e30',
        bd:  'rgba(28,53,80,0.8)',
        bd2: 'rgba(28,53,80,1)',
        tx:  '#e2eaf4',
        mu:  '#4e7090',
        a:   '#00d4ff',
        a2:  '#f59e0b',
        a3:  '#10b981',
        or:  '#f97316',
        red: '#ef4444',
        pu:  '#a855f7',
      },
      fontFamily: {
        rajdhani: ['Rajdhani', 'sans-serif'],
        mono:     ['Share Tech Mono', 'monospace'],
      },
    },
  },
  plugins: [],
}
