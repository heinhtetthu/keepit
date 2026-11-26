import { useEffect, useState, type ReactNode } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import Combobox from '@/components/ui/combobox'

/**
 * Shared table chrome:
 *  - scrollable table body with a sticky (fixed) header row inside the card
 *  - footer bar where rows-per-page + pagination stay docked bottom-right
 * The parent page keeps its own layout; use `maxH` classes for embedded cards
 * or `flex-1 min-h-0` inside a full-height flex page.
 */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100]

/** localStorage-backed rows-per-page. */
export function usePageSize(storageKey: string, initial = 25) {
  const [size, setSizeState] = useState<number>(initial)
  useEffect(() => {
    try {
      const saved = localStorage.getItem(`page-size-${storageKey}`)
      const n = saved ? Number(saved) : NaN
      if (PAGE_SIZE_OPTIONS.includes(n)) setSizeState(n)
    } catch {
      /* storage unavailable */
    }
  }, [storageKey])
  const setSize = (n: number) => {
    const v = PAGE_SIZE_OPTIONS.includes(n) ? n : initial
    setSizeState(v)
    try {
      localStorage.setItem(`page-size-${storageKey}`, String(v))
    } catch {
      /* storage unavailable */
    }
  }
  return [size, setSize] as const
}

export function TableCard({ children, header, footer, className }: {
  children: ReactNode
  header?: ReactNode
  footer?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border bg-white shadow-soft', className)}>
      {header}
      {children}
      {footer && (
        <div className="flex shrink-0 items-center gap-3 border-t bg-gray-50/70 px-4 py-2">
          {footer}
        </div>
      )}
    </div>
  )
}

/** Scroll container for the table body - the window itself never scrolls for table content. */
export function TableScrollArea({ children, className }: {
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('min-h-0 overflow-auto overscroll-contain', className)}>
      {children}
    </div>
  )
}

export function RowsPerPageSelect({ value, onChange }: {
  value: number
  onChange: (n: number) => void
}) {
  return (
    <div className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-gray-500">
      <span>Rows per page</span>
      <div className="w-[4.25rem]" aria-label="Rows per page">
        <Combobox compact className="h-8 px-2.5 text-xs" value={String(value)} onChange={(v) => v && onChange(Number(v))}
          options={PAGE_SIZE_OPTIONS.map((n) => ({ value: String(n), label: String(n) }))} />
      </div>
    </div>
  )
}

export function MiniPager({ page, pages, onPage }: {
  page: number
  pages: number
  onPage: (n: number) => void
}) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      <button
        className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        aria-label="Previous page"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="text-xs text-gray-500 px-1 whitespace-nowrap">
        Page <span className="font-medium text-gray-700">{page}</span> of {pages}
      </span>
      <button
        className="p-1.5 rounded-md text-gray-400 hover:bg-gray-100 disabled:opacity-30 disabled:cursor-default"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
        aria-label="Next page"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

export function TableFooterInfo({ shown, total, noun }: {
  shown: number
  total: number
  noun?: string
}) {
  return (
    <p className="text-xs sm:text-sm text-gray-500">
      Showing <span className="font-medium text-gray-700">{shown}</span> of{' '}
      <span className="font-medium text-gray-700">{total}</span>{noun ? ` ${noun}` : ''}
    </p>
  )
}

/**
 * Sticky header: apply to every `<th>` so the header row stays fixed while the
 * table body scrolls inside TableScrollArea. Frozen cells pass their `left`
 * offset (from DynamicTable's measuring logic) as `left` to pin both axes.
 */
export const TH_STICKY = 'sticky top-0 z-10 bg-gray-50/95 backdrop-blur text-[11px] uppercase tracking-wider [&_button]:uppercase [&_button]:tracking-wider'


/** Standard table footer: count on the left; rows-per-page and pager on one line, on the right. */
export function TablePager({ shown, total, noun, page, pages, onPage, pageSize, onPageSize }: {
  shown: number
  total: number
  noun?: string
  page: number
  pages: number
  onPage: (n: number) => void
  pageSize?: number
  onPageSize?: (n: number) => void
}) {
  return (
    <div className="flex w-full min-w-0 items-center gap-3">
      <div className="hidden min-w-0 truncate sm:block"><TableFooterInfo shown={shown} total={total} noun={noun} /></div>
      <div className="ml-auto flex shrink-0 items-center gap-3 whitespace-nowrap">
        {pageSize !== undefined && onPageSize && <RowsPerPageSelect value={pageSize} onChange={onPageSize} />}
        <MiniPager page={page} pages={Math.max(1, pages)} onPage={onPage} />
      </div>
    </div>
  )
}
