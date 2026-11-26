/** Keepit design system: "Midnight Teal".
 *
 * Every neutral and status palette is routed through CSS variables, so the
 * existing pages (which use bg-white / text-gray-700 / bg-red-50 …) switch to
 * dark mode by redefining variables only. Dark mode mirrors each status scale
 * (50↔950, 100↔900 …), so soft tinted backgrounds stay soft and text stays legible.
 */
import colors from 'tailwindcss/colors'
import plugin from 'tailwindcss/plugin'

const SHADES = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950]
const STATUS = ['red', 'green', 'amber', 'yellow', 'blue', 'violet', 'emerald', 'orange', 'sky', 'teal', 'purple', 'indigo', 'rose', 'cyan', 'lime', 'pink', 'fuchsia']
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}` }

// Neutrals: cool slate in light; deep midnight navy in dark.
const GRAY_LIGHT = { 50: '#f6f8fb', 100: '#eef2f6', 200: '#e2e8f0', 300: '#cbd5e1', 400: '#94a3b8', 500: '#64748b', 600: '#475569', 700: '#334155', 800: '#1e293b', 900: '#0f172a', 950: '#020617' }
const GRAY_DARK = { 50: '#0b1220', 100: '#162034', 200: '#223049', 300: '#33425f', 400: '#64748f', 500: '#8a9ab4', 600: '#adbad0', 700: '#cad4e3', 800: '#e1e7f0', 900: '#f1f4f9', 950: '#f8fafc' }
const SURFACE = { light: '#ffffff', dark: '#111a2b' }

const palettes = { gray: [GRAY_LIGHT, GRAY_DARK] }
for (const name of STATUS) {
  const c = colors[name]
  const dark = Object.fromEntries(SHADES.map((s, i) => [s, c[SHADES[SHADES.length - 1 - i]]]))
  palettes[name] = [c, dark]
}

const vars = (mode) => {
  const out = { '--c-white': rgb(SURFACE[mode]) }
  for (const [name, [light, dark]] of Object.entries(palettes)) {
    for (const s of SHADES) out[`--c-${name}-${s}`] = rgb((mode === 'light' ? light : dark)[s])
  }
  return out
}

const themed = Object.fromEntries(Object.keys(palettes).map((name) => [name,
  Object.fromEntries(SHADES.map((s) => [s, `rgb(var(--c-${name}-${s}) / <alpha-value>)`]))]))

/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        ...themed,
        slate: themed.gray,
        white: 'rgb(var(--c-white) / <alpha-value>)',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: { DEFAULT: 'hsl(var(--primary))', foreground: 'hsl(var(--primary-foreground))', soft: 'hsl(var(--primary-soft))' },
        secondary: { DEFAULT: 'hsl(var(--secondary))', foreground: 'hsl(var(--secondary-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        accent: { DEFAULT: 'hsl(var(--accent))', foreground: 'hsl(var(--accent-foreground))' },
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        sidebar: { DEFAULT: 'hsl(var(--sidebar))', foreground: 'hsl(var(--sidebar-foreground))', muted: 'hsl(var(--sidebar-muted))', hover: 'hsl(var(--sidebar-hover))', border: 'hsl(var(--sidebar-border))' },
      },
      fontFamily: {
        sans: ['Inter Variable', 'Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
      borderRadius: { xl: 'calc(var(--radius) + 4px)', lg: 'var(--radius)', md: 'calc(var(--radius) - 2px)', sm: 'calc(var(--radius) - 4px)' },
      boxShadow: {
        soft: '0 1px 2px rgb(15 23 42 / 0.04), 0 1px 3px rgb(15 23 42 / 0.06)',
        lift: '0 4px 12px -2px rgb(15 23 42 / 0.08), 0 2px 4px -2px rgb(15 23 42 / 0.06)',
        pop: '0 16px 40px -8px rgb(2 6 23 / 0.25), 0 4px 12px -4px rgb(2 6 23 / 0.12)',
        glow: '0 0 0 4px hsl(var(--primary) / 0.15)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'scale-in': { from: { opacity: 0, transform: 'translateY(6px) scale(0.97)' }, to: { opacity: 1, transform: 'translateY(0) scale(1)' } },
        'sheet-up': { from: { opacity: 0.6, transform: 'translateY(24px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        'pop-in': { from: { opacity: 0, transform: 'translateY(-4px) scale(0.98)' }, to: { opacity: 1, transform: 'translateY(0) scale(1)' } },
        'slide-in-right': { from: { opacity: 0, transform: 'translateX(16px)' }, to: { opacity: 1, transform: 'translateX(0)' } },
        'slide-in-left': { from: { transform: 'translateX(-100%)' }, to: { transform: 'translateX(0)' } },
        'page-in': { from: { opacity: 0, transform: 'translateY(4px)' }, to: { opacity: 1, transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'scale-in': 'scale-in 200ms cubic-bezier(0.16, 1, 0.3, 1)',
        'sheet-up': 'sheet-up 240ms cubic-bezier(0.16, 1, 0.3, 1)',
        'pop-in': 'pop-in 140ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-right': 'slide-in-right 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'slide-in-left': 'slide-in-left 220ms cubic-bezier(0.16, 1, 0.3, 1)',
        'page-in': 'page-in 220ms ease-out',
      },
    },
  },
  plugins: [
    plugin(({ addBase }) => {
      addBase({ ':root': vars('light'), '.dark': vars('dark') })
    }),
  ],
}
