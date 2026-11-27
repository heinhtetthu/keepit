import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '@/store/auth'
import type { FilterState } from '@/components/FilterBar'
import { usePageSize } from '@/components/table_shell'

/** A saved or default view: everything a list remembers. */
export interface TableSnapshot {
  tab?: string
  filters?: FilterState
  sort?: string
  order?: 'asc' | 'desc'
  columns?: string[]
  extras?: Record<string, boolean>
}

export interface TableStateOptions {
  /** Unique list key, e.g. "assets", "borrows". Also the saved-view scope. */
  key: string
  defaultSort: string
  defaultOrder?: 'asc' | 'desc'
  /** Column ids shown when the user has not picked any. */
  defaultColumns?: string[]
  defaultTab?: string
  /** Start from these instead of the remembered default (e.g. links with ?type=). */
  initial?: TableSnapshot
}

const read = <T,>(k: string): T | null => { try { return JSON.parse(localStorage.getItem(k) || 'null') } catch { return null } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* storage unavailable */ } }

/**
 * State for one list page: tab, filters, search, sort, page, rows per page,
 * visible columns and extra switches. The user's "open by default" view and
 * column choice are remembered per user in localStorage.
 */
export function useTableState(o: TableStateOptions) {
  const userId = useAuthStore((s) => s.user?.id)
  const startKey = `table-start:${o.key}:${userId}`
  const colKey = `table-columns:${o.key}:${userId}`
  const start = useMemo(() => o.initial ?? read<TableSnapshot>(startKey) ?? {}, [startKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTabState] = useState(start.tab ?? o.defaultTab ?? 'all')
  const [filters, setFiltersState] = useState<FilterState>(start.filters ?? {})
  const [sort, setSortState] = useState(start.sort ?? o.defaultSort)
  const [order, setOrderState] = useState<'asc' | 'desc'>(start.order ?? o.defaultOrder ?? 'asc')
  const [extras, setExtras] = useState<Record<string, boolean>>(start.extras ?? {})
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSizeState] = usePageSize(o.key)
  const [columns, setColumnsState] = useState<string[]>(() => read<string[]>(colKey) ?? start.columns ?? o.defaultColumns ?? [])
  const [viewId, setViewId] = useState<number | null>(null)

  useEffect(() => { const t = setTimeout(() => { setSearch(query.trim()); setPage(1) }, 250); return () => clearTimeout(t) }, [query])

  const touch = () => { setPage(1); setViewId(null) }
  const setColumns = (next: string[]) => { setColumnsState(next); write(colKey, next) }
  const snapshot = (): TableSnapshot => ({ tab, filters, sort, order, columns, extras })

  return {
    key: o.key, tab, filters, sort, order, extras, query, search, page, pageSize, columns, viewId,
    setTab: (t: string) => { setTabState(t); touch() },
    setFilters: (f: FilterState) => { setFiltersState(f); touch() },
    setSort: (s: string, ord?: 'asc' | 'desc') => { setSortState(s); if (ord) setOrderState(ord); setPage(1) },
    setOrder: (ord: 'asc' | 'desc') => { setOrderState(ord); setPage(1) },
    /** Header click: same column flips direction, a new column starts ascending. */
    toggleSort: (s: string) => { if (s === sort) setOrderState(order === 'asc' ? 'desc' : 'asc'); else { setSortState(s); setOrderState('asc') } setPage(1) },
    setExtra: (k: string, v: boolean) => { setExtras((e) => ({ ...e, [k]: v })); touch() },
    setQuery, setPage,
    setPageSize: (n: number) => { setPageSizeState(n); setPage(1) },
    setColumns,
    toggleColumn: (id: string, order: string[]) => setColumns(columns.includes(id) ? columns.filter((c) => c !== id) : order.filter((c) => c === id || columns.includes(c))),
    snapshot,
    apply: (v: TableSnapshot, id: number | null = null) => {
      setTabState(v.tab ?? o.defaultTab ?? 'all'); setFiltersState(v.filters ?? {}); setExtras(v.extras ?? {})
      setSortState(v.sort ?? o.defaultSort); setOrderState(v.order ?? o.defaultOrder ?? 'asc')
      if (v.columns?.length) setColumns(v.columns)
      setPage(1); setViewId(id)
    },
    saveAsDefault: () => write(startKey, snapshot()),
    setViewId,
  }
}

export type TableState = ReturnType<typeof useTableState>
