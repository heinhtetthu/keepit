import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, Laptop, Search, UserRound } from 'lucide-react'
import api from '@/lib/api'
import TypeIcon from '@/components/TypeIcon'
import { cn } from '@/lib/utils'

interface SearchResults {
  results: {
    kind: 'record' | 'type' | 'asset' | 'employee' | 'document'
    url: string
    title: string
    subtitle: string
    icon?: string | null
  }[]
}

/** Global search across records, assets, employees and documents (⌘K / Ctrl+K). */
export default function GlobalSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const navigate = useNavigate()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [highlight, setHighlight] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const debounced = useRef<ReturnType<typeof setTimeout>>()
  const [query, setQuery] = useState('')

  const debouncedQuery = (value: string) => {
    window.clearTimeout(debounced.current)
    debounced.current = setTimeout(() => setQuery(value.trim()), 250)
  }

  const { data, isFetching } = useQuery<SearchResults>({
    queryKey: ['global-search', query],
    queryFn: async () => (await api.get('/search/all', { params: { q: query } })).data,
    enabled: open && query.length > 0,
    retry: 1,
  })
  const results = data?.results || []

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
    }
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick, true)
    }
  }, [])

  const pickAt = (index: number) => {
    const item = results[index]
    if (!item) return
    setOpen(false)
    setQ('')
    setQuery('')
    navigate(item.url)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { setOpen(false); inputRef.current?.blur() }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight((h) => Math.min(h + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((h) => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter' && open && results.length > 0) { e.preventDefault(); pickAt(highlight) }
  }

  return (
    <div ref={rootRef} className={cn('relative w-full', className)}>
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={q}
          placeholder="Search records, assets, people…"
          autoFocus={autoFocus}
          className="h-10 w-full rounded-xl border border-input bg-gray-50 pl-9 pr-16 text-sm text-gray-900 transition-[background-color,border-color,box-shadow] duration-150 placeholder:text-gray-400 hover:border-gray-300 focus:border-primary focus:bg-white focus:shadow-glow focus:outline-none"
          onFocus={() => setOpen(true)}
          onChange={(e) => { setQ(e.target.value); setOpen(true); debouncedQuery(e.target.value); setHighlight(0) }}
          onKeyDown={onKeyDown}
          aria-label="Search records"
        />
        <kbd className="hidden sm:block absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-gray-200 bg-white px-1.5 py-0.5 text-[10px] font-medium text-gray-400 select-none pointer-events-none">
          {/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}
        </kbd>
      </div>

      {open && q.trim() && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 max-h-[70vh] animate-pop-in overflow-y-auto rounded-xl border bg-white shadow-pop">
          {results.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-gray-400">
              {isFetching ? 'Searching…' : `No matches for "${q.trim()}"`}
            </p>
          ) : (
            <div className="py-1.5">
              {results.map((r, i) => (
                <button
                  key={`${r.kind}-${r.url}-${i}`}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors hover:bg-gray-50',
                    i === highlight && 'bg-primary/5',
                  )}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => pickAt(i)}
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary [&_svg]:text-primary">
                    {r.kind === 'asset' ? <Laptop className="h-4 w-4 text-gray-600" />
                      : r.kind === 'employee' ? <UserRound className="h-4 w-4 text-gray-600" />
                      : r.kind === 'document' ? <FileText className="h-4 w-4 text-gray-600" />
                      : <TypeIcon icon={r.icon ?? null} className="h-4 w-4 text-gray-600" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm text-gray-800 truncate">{r.title}</span>
                    <span className="block text-[11px] text-gray-400 truncate">{r.subtitle}</span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {open && !q.trim() && (
        <div className="absolute left-0 right-0 z-50 mt-1.5 animate-pop-in rounded-xl border bg-white px-4 py-3 shadow-pop">
          <p className="text-xs text-gray-400">
            Search records, assets (brand, model, serial), employees and documents.
            Press <kbd className="rounded border border-gray-200 bg-white px-1 py-0.5 text-[10px]">Esc</kbd> to close.
          </p>
        </div>
      )}
    </div>
  )
}
