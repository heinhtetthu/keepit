import { create } from 'zustand'

export type ThemeMode = 'light' | 'dark' | 'system'

const media = () => window.matchMedia('(prefers-color-scheme: dark)')
const read = (): ThemeMode => {
  try { return (localStorage.getItem('theme') as ThemeMode) || 'system' } catch { return 'system' }
}
const apply = (mode: ThemeMode) => {
  const dark = mode === 'dark' || (mode === 'system' && media().matches)
  document.documentElement.classList.toggle('dark', dark)
}

export const useTheme = create<{ mode: ThemeMode; setMode: (m: ThemeMode) => void }>((set) => ({
  mode: read(),
  setMode: (mode) => {
    try { localStorage.setItem('theme', mode) } catch { /* ignore */ }
    apply(mode)
    set({ mode })
  },
}))

// Follow OS changes while in "system" mode.
media().addEventListener?.('change', () => apply(useTheme.getState().mode))
