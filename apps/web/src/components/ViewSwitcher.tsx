import { useEffect, useState } from 'react'
import { LayoutGrid, List, Rows3, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ViewMode = 'thumbnail' | 'list' | 'details'

const MODES: { key: ViewMode; label: string }[] = [
  { key: 'thumbnail', label: 'Thumbnail' },
  { key: 'list', label: 'List' },
  { key: 'details', label: 'Details' },
]

const ICONS: { [m in ViewMode]: typeof LayoutGrid } = {
  thumbnail: LayoutGrid,
  list: List,
  details: Rows3,
}

/** Per-page persisted view format (thumbnail cards / list rows / details table). */
export function useViewMode(storageKey: string | undefined, initial: ViewMode = 'thumbnail') {
  const [mode, setMode] = useState<ViewMode>(initial)

  useEffect(() => {
    if (!storageKey) return
    try {
      const saved = localStorage.getItem(`view-mode-${storageKey}`)
      if (saved === 'thumbnail' || saved === 'list' || saved === 'details') setMode(saved)
    } catch {
      /* storage unavailable */
    }
  }, [storageKey])

  const setViewMode = (m: ViewMode) => {
    setMode(m)
    try {
      if (storageKey) localStorage.setItem(`view-mode-${storageKey}`, m)
    } catch {
      /* storage unavailable */
    }
  }

  return [mode, setViewMode] as const
}

export function ViewSwitcher({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="inline-flex rounded-md border bg-white overflow-hidden shadow-sm" role="group" aria-label="View format">
      {MODES.map(({ key, label }) => {
        const Icon = ICONS[key]
        return (
          <button
            key={key}
            title={`${label} view`}
            aria-label={`${label} view`}
            aria-pressed={mode === key}
            onClick={() => onChange(key)}
            className={cn(
              'px-2.5 py-2 text-gray-400 transition-colors hover:bg-gray-50',
              key !== MODES[MODES.length - 1].key && 'border-r',
              mode === key && 'bg-gray-100 text-primary',
            )}
          >
            <Icon className="h-4 w-4" />
          </button>
        )
      })}
    </div>
  )
}

/** Page size at which pagination kicks in. */
export const VIEW_PAGE_SIZE = 8

/** Numbered pagination controls - nothing renders until there is more than one page. */
export function Pager({ page, pages, onPage }: { page: number; pages: number; onPage: (n: number) => void }) {
  if (pages <= 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-gray-500">
        Page <span className="font-medium text-gray-700">{page}</span> of {pages}
      </p>
      <div className="flex items-center gap-1">
        <button
          className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
          <button
            key={p}
            onClick={() => onPage(p)}
            className={cn(
              'h-8 min-w-8 px-2 rounded-md text-sm transition-colors',
              p === page ? 'bg-primary text-primary-foreground font-medium' : 'text-gray-600 hover:bg-gray-100',
            )}
            aria-current={p === page ? 'page' : undefined}
          >
            {p}
          </button>
        ))}
        <button
          className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default"
          disabled={page >= pages}
          onClick={() => onPage(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
