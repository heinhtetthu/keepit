import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search } from 'lucide-react'
import { fieldClass } from './input'
import { cn } from '@/lib/utils'

export interface ComboOption {
  value: string
  label: string
  sublabel?: string
  leading?: ReactNode
  /** Extra text matched by the search box (emails, units…). */
  keywords?: string
}

/** Searchable single-select dropdown. The list renders in a portal so modals
    and scroll areas never clip it; arrow keys + Enter work while typing. */
export default function Combobox({ options, value, onChange, placeholder = 'Select…', searchPlaceholder = 'Search…', emptyText = 'No matches', allowCustom, className, autoOpen, disabled, hideSearch }: {
  options: ComboOption[]
  value: string | null
  onChange: (value: string | null, custom?: boolean) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  /** Offer "Use “typed text”" when nothing matches exactly. */
  allowCustom?: boolean
  className?: string
  autoOpen?: boolean
  disabled?: boolean
  /** Short fixed lists can skip the search box. */
  hideSearch?: boolean
}) {
  const [open, setOpen] = useState(!!autoOpen)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const selected = options.find((o) => o.value === value)
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => (needle
    ? options.filter((o) => `${o.label} ${o.sublabel || ''} ${o.keywords || ''}`.toLowerCase().includes(needle))
    : options).slice(0, 100), [options, needle])
  const custom = allowCustom && needle && !options.some((o) => o.label.toLowerCase() === needle) ? q.trim() : null
  const rows = custom ? shown.length + 1 : shown.length

  useLayoutEffect(() => {
    if (!open) return
    const place = () => btn.current && setRect(btn.current.getBoundingClientRect())
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])

  useEffect(() => {
    if (!open) return
    if (input.current) input.current.focus()
    else panel.current?.focus()
    const away = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [open])

  useEffect(() => { setActive(0) }, [needle])

  const pick = (i: number) => {
    if (custom && i === shown.length) onChange(custom, true)
    else if (shown[i]) onChange(shown[i].value)
    setOpen(false)
    setQ('')
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows) pick(active) }
    else if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) }
  }

  const below = rect ? window.innerHeight - rect.bottom > 300 || rect.top < 300 : true
  return (
    <>
      <button
        ref={btn}
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={disabled}
        className={cn(fieldClass, 'items-center gap-2.5 pl-3 pr-2.5 text-left', open && 'border-primary shadow-glow', className)}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {selected?.leading}
        <span className="min-w-0 flex-1 truncate">
          {selected ? <>{selected.label}{selected.sublabel && <span className="text-gray-400"> · {selected.sublabel}</span>}</>
            : value ? value : <span className="text-gray-400">{placeholder}</span>}
        </span>
        <ChevronDown className={cn('ml-1 h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200', open && 'rotate-180 text-primary')} />
      </button>
      {open && rect && createPortal(
        <div
          ref={panel}
          tabIndex={-1}
          className="fixed z-[95] outline-none animate-pop-in overflow-hidden rounded-xl border bg-white shadow-pop"
          style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 260) - 8)), width: Math.min(Math.max(rect.width, 260), window.innerWidth - 16), ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) }}
          onKeyDown={onKey}
        >
          {!hideSearch && <div className="relative border-b">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder={searchPlaceholder} className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-gray-900 outline-none" />
          </div>}
          <ul role="listbox" className="max-h-64 overflow-y-auto p-1">
            {shown.map((o, i) => (
              <li key={o.value} role="option" aria-selected={o.value === value}>
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(i)} className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors', i === active && 'bg-gray-100', o.value === value && 'text-primary')}>
                  {o.leading}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900">{o.label}</span>
                    {o.sublabel && <span className="block truncate text-xs text-gray-500">{o.sublabel}</span>}
                  </span>
                  {o.value === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              </li>
            ))}
            {custom && (
              <li>
                <button type="button" onMouseEnter={() => setActive(shown.length)} onClick={() => pick(shown.length)} className={cn('w-full px-3 py-2 text-left text-sm', active === shown.length && 'bg-gray-100')}>
                  Use “{custom}” <span className="text-gray-400">(not in the list)</span>
                </button>
              </li>
            )}
            {!rows && <li className="px-3 py-6 text-center text-sm text-gray-400">{emptyText}</li>}
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
