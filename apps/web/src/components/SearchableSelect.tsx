import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X, Check, Search } from 'lucide-react'
import { fieldClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface SSOpt { value: string; label: string }

interface Props {
  options: SSOpt[]
  value: string | string[] | null | undefined
  onChange: (value: string | string[]) => void
  multiple?: boolean
  placeholder?: string
  disabled?: boolean
  className?: string
}

/** Searchable single- or multi-select. Clicking anywhere outside collapses it and keeps the picks.
    It holds no <button> elements: a surrounding <label> forwards clicks to the first button inside,
    which used to remove the first chosen option. */
export default function SearchableSelect({ options, value, onChange, multiple, placeholder = 'Select…', disabled, className }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLDivElement>(null)

  const close = () => { setOpen(false); setQuery('') }
  useEffect(() => {
    if (!open) return
    // Capture phase: dialogs stop mousedown from bubbling, which used to keep the list open.
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close() }
    document.addEventListener('mousedown', onDoc, true)
    return () => document.removeEventListener('mousedown', onDoc, true)
  }, [open])
  useEffect(() => { setActive(0) }, [query])

  const selected: string[] = multiple
    ? (Array.isArray(value) ? value : value ? [String(value)] : [])
    : (value == null || value === '' ? [] : [String(value)])
  const needle = query.trim().toLowerCase()
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle) || o.value.toLowerCase().includes(needle)) : options
  const labelOf = (v: string) => options.find((o) => o.value === v)?.label || v

  const pick = (v: string) => {
    if (multiple) onChange(selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v])
    else { onChange(v); close(); trigger.current?.focus() }
  }
  const remove = (v: string) => (multiple ? onChange(selected.filter((s) => s !== v)) : onChange(''))

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(filtered.length - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[active]) pick(filtered[active].value) }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); trigger.current?.focus() }
  }

  return (
    <div ref={ref} className={cn('relative', className)} onKeyDown={open ? onKey : undefined}>
      <div
        ref={trigger}
        role="combobox"
        tabIndex={disabled ? -1 : 0}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-disabled={disabled || undefined}
        className={cn(fieldClass, 'h-auto min-h-10 cursor-pointer flex-wrap items-center gap-1.5 py-1.5 pl-3 pr-2.5 outline-none',
          disabled && 'pointer-events-none opacity-50', open && 'border-primary shadow-glow')}
        onClick={() => (open ? close() : setOpen(true))}
        onKeyDown={(e) => { if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true) } }}
      >
        {selected.length > 0 ? selected.map((v) => (
          <span key={v} className="inline-flex animate-pop-in items-center gap-1 rounded-md bg-primary-soft py-0.5 pl-2 pr-1 text-xs font-medium text-primary">
            {labelOf(v)}
            {!disabled && (
              <span role="button" tabIndex={-1} aria-label={`Remove ${labelOf(v)}`} className="rounded p-0.5 hover:bg-primary/15"
                onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.stopPropagation(); remove(v) }}>
                <X className="h-3 w-3" />
              </span>
            )}
          </span>
        )) : <span className="py-0.5 text-sm text-gray-400">{placeholder}</span>}
        <ChevronDown className={cn('ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200', open && 'rotate-180 text-primary')} />
      </div>

      {open && (
        <div data-floating="true" className="absolute z-50 mt-1 w-full min-w-[14rem] animate-pop-in overflow-hidden rounded-xl border bg-white shadow-pop">
          <div className="relative border-b">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input autoFocus className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-gray-900 outline-none" placeholder="Search…"
              value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <ul role="listbox" aria-multiselectable={multiple || undefined} className="max-h-56 overflow-y-auto p-1">
            {filtered.length === 0 && <li className="px-3 py-4 text-center text-sm text-gray-400">No matches</li>}
            {filtered.map((o, i) => {
              const isSel = selected.includes(o.value)
              return (
                <li key={o.value} role="option" aria-selected={isSel} onMouseEnter={() => setActive(i)} onClick={() => pick(o.value)}
                  className={cn('flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-gray-900', i === active && 'bg-gray-100', isSel && 'text-primary')}>
                  {multiple && <span className={cn('flex h-4 w-4 shrink-0 items-center justify-center rounded border', isSel ? 'border-primary bg-primary text-primary-foreground' : 'border-gray-300')}>{isSel && <Check className="h-3 w-3" />}</span>}
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {!multiple && isSel && <Check className="h-4 w-4 text-primary" />}
                </li>
              )
            })}
          </ul>
          {multiple && selected.length > 0 && (
            <div className="flex items-center justify-between border-t px-3 py-1.5 text-xs text-gray-500">
              <span>{selected.length} selected</span>
              <span role="button" tabIndex={-1} className="cursor-pointer font-medium text-primary hover:underline" onClick={close}>Done</span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
