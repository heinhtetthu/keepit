import { useEffect, useRef, useState } from 'react'
import { ChevronDown, X, Check, Search } from 'lucide-react'

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

export default function SearchableSelect({ options, value, onChange, multiple, placeholder = 'Select...', disabled, className = '' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const selected: string[] = multiple
    ? (Array.isArray(value) ? value : value ? [String(value)] : [])
    : (value == null || value === '' ? [] : [String(value)])

  const filtered = query.trim()
    ? options.filter((o) => o.label.toLowerCase().includes(query.trim().toLowerCase()) || o.value.toLowerCase().includes(query.trim().toLowerCase()))
    : options

  const labelOf = (v: string) => options.find((o) => o.value === v)?.label || v

  const pick = (v: string) => {
    if (multiple) {
      const next = selected.includes(v) ? selected.filter((s) => s !== v) : [...selected, v]
      onChange(next)
    } else {
      onChange(v)
      setOpen(false)
      setQuery('')
    }
  }

  const remove = (v: string) => {
    if (multiple) onChange(selected.filter((s) => s !== v))
    else onChange('')
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <div
        className={`flex min-h-10 w-full items-center flex-wrap gap-1.5 rounded-md border border-input bg-background px-3 py-1.5 text-sm cursor-text ${disabled ? 'opacity-50 pointer-events-none' : ''}`}
        onClick={() => !disabled && setOpen((o) => !o)}
      >
        {selected.length > 0 ? (
          selected.map((v) => (
            <span key={v} className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
              {labelOf(v)}
              {!disabled && (
                <button
                  type="button"
                  className="text-gray-400 hover:text-red-600"
                  onClick={(e) => { e.stopPropagation(); remove(v) }}
                  aria-label={`Remove ${labelOf(v)}`}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </span>
          ))
        ) : (
          <span className="text-gray-400 text-sm py-0.5">{placeholder}</span>
        )}
        <div className="ml-auto flex items-center gap-1 text-gray-400">
          {open
            ? <Search className="h-3.5 w-3.5" />
            : <ChevronDown className="h-3.5 w-3.5" />}
        </div>
      </div>

      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-md border bg-white shadow-lg">
          <input
            autoFocus
            className="w-full border-b px-3 py-2 text-sm outline-none"
            placeholder="Type to search..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onClick={(e) => e.stopPropagation()}
          />
          <div className="max-h-56 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-sm text-gray-400">No matches</p>
            )}
            {filtered.map((o) => {
              const isSel = selected.includes(o.value)
              return (
                <button
                  key={o.value}
                  type="button"
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-gray-50 ${isSel ? 'bg-gray-50' : ''}`}
                  onClick={(e) => { e.stopPropagation(); pick(o.value) }}
                >
                  <span>{o.label}</span>
                  {isSel && <Check className="h-3.5 w-3.5 text-green-600" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
