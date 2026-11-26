import { Monitor, Moon, Sun } from 'lucide-react'
import { useTheme, type ThemeMode } from '@/store/theme'
import { cn } from '@/lib/utils'

const MODES: { mode: ThemeMode; icon: typeof Sun; label: string }[] = [
  { mode: 'light', icon: Sun, label: 'Light' },
  { mode: 'dark', icon: Moon, label: 'Dark' },
  { mode: 'system', icon: Monitor, label: 'System' },
]

/** Segmented Light / Dark / System switch. */
export function ThemeSegmented({ className }: { className?: string }) {
  const { mode, setMode } = useTheme()
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('grid grid-cols-3 gap-1 rounded-lg bg-gray-100 p-1', className)}>
      {MODES.map((m) => (
        <button key={m.mode} role="radio" aria-checked={mode === m.mode} onClick={() => setMode(m.mode)}
          className={cn('press flex items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium',
            mode === m.mode ? 'bg-white text-gray-900 shadow-soft' : 'text-gray-500 hover:text-gray-800')}>
          <m.icon className="h-3.5 w-3.5" />{m.label}
        </button>
      ))}
    </div>
  )
}

/** One-click light/dark flip for the top bar. */
export default function ThemeToggle() {
  const { mode, setMode } = useTheme()
  const dark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  return (
    <button onClick={() => setMode(dark ? 'light' : 'dark')} title={`Switch to ${dark ? 'light' : 'dark'} theme (${mode})`} aria-label="Toggle theme"
      className="press relative inline-flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900">
      <Sun className={cn('absolute h-[18px] w-[18px] transition-all duration-300', dark ? 'rotate-90 scale-0 opacity-0' : 'rotate-0 scale-100 opacity-100')} />
      <Moon className={cn('absolute h-[18px] w-[18px] transition-all duration-300', dark ? 'rotate-0 scale-100 opacity-100' : '-rotate-90 scale-0 opacity-0')} />
    </button>
  )
}
