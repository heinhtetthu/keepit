import type { ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpDown, Columns3, MoreVertical, Save, Search, Star, Trash2, X } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Popover from '@/components/ui/popover'
import Modal from '@/components/ui/modal'
import { toast } from '@/components/ui/toaster'
import FilterButton, { ActiveFilters } from '@/components/FilterBar'
import { cn } from '@/lib/utils'
import { apiError } from '@/lib/seats'
import type { RecordField } from '@/types'
import type { TableSnapshot, TableState } from './state'
import { useState } from 'react'

export interface TabDef { id: string; label: string; count?: number | null; tone?: string }
export interface SortDef { id: string; label: string; kind?: 'text' | 'date' | 'number' }
export interface ColumnChoice { id: string; label: string; locked?: boolean }

/** Underlined preset tabs with counts, as on record lists. */
export function TableTabs({ tabs, value, onChange }: { tabs: TabDef[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="-mx-1 flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b px-1" role="tablist">
      {tabs.map((t) => (
        <button key={t.id} role="tab" aria-selected={value === t.id} onClick={() => onChange(t.id)}
          className={cn('-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
            value === t.id ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
          {t.label}
          {t.count != null && <span className={cn('rounded-full px-1.5 py-0.5 text-xs tabular-nums', value === t.id ? 'bg-gray-900 text-white' : cn('bg-gray-100', t.count > 0 && t.tone ? t.tone : 'text-gray-500'))}>{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder = 'Search…' }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <div className="relative min-w-[180px] max-w-sm flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <Input placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} className="h-9 pl-9 pr-8" />
      {value && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" onClick={() => onChange('')} aria-label="Clear search"><X className="h-4 w-4" /></button>}
    </div>
  )
}

const dirLabel = (kind: SortDef['kind'], dir: 'asc' | 'desc') =>
  kind === 'date' ? (dir === 'asc' ? 'Oldest first' : 'Newest first') : kind === 'number' ? (dir === 'asc' ? 'Low → high' : 'High → low') : (dir === 'asc' ? 'A → Z' : 'Z → A')

export function SortMenu({ sorts, sort, order, onSort, onOrder }: { sorts: SortDef[]; sort: string; order: 'asc' | 'desc'; onSort: (id: string) => void; onOrder: (o: 'asc' | 'desc') => void }) {
  const cur = sorts.find((x) => x.id === sort) ?? sorts[0]
  return (
    <Popover align="left" panelClassName="w-64 max-h-96 overflow-y-auto p-1.5" trigger={
      <Button variant="outline" size="sm" title="Sort"><ArrowUpDown className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Sort: {cur?.label}</span></Button>
    }>
      {(close) => (
        <>
          <div className="mb-1 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-0.5 text-xs font-medium">
            {(['asc', 'desc'] as const).map((d) => (
              <button key={d} onClick={() => onOrder(d)} className={cn('rounded px-2 py-1.5', order === d ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>{dirLabel(cur?.kind, d)}</button>
            ))}
          </div>
          {sorts.map((x) => (
            <button key={x.id} onClick={() => { onSort(x.id); close() }}
              className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-gray-50', sort === x.id && 'font-medium text-primary')}>
              {x.label}{sort === x.id && <span className="text-xs">{order === 'asc' ? '↑' : '↓'}</span>}
            </button>
          ))}
        </>
      )}
    </Popover>
  )
}

export function ColumnMenu({ columns, visible, onToggle }: { columns: ColumnChoice[]; visible: string[]; onToggle: (id: string) => void }) {
  return (
    <Popover align="right" panelClassName="w-60 max-h-80 overflow-y-auto p-1.5" trigger={
      <Button variant="outline" size="sm" title="Choose columns"><Columns3 className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Columns</span></Button>
    }>
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Show columns</p>
      {columns.filter((c) => !c.locked).map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={visible.includes(c.id)} onChange={() => onToggle(c.id)} />
          <span className="truncate">{c.label}</span>
        </label>
      ))}
    </Popover>
  )
}

interface SavedViewRow { id: number; name: string; filters: Record<string, any> | null; sort: { field?: string; order?: string } | null; visible_columns: string[] | null }

/** Saved views for any list (server-side, per user) plus "open this view by default". */
export function ViewsMenu({ state }: { state: TableState }) {
  const qc = useQueryClient()
  const [saving, setSaving] = useState(false)
  const [name, setName] = useState('')
  const key = ['saved-views', state.key]
  const { data: views = [] } = useQuery<SavedViewRow[]>({ queryKey: key, queryFn: async () => (await api.get('/views', { params: { scope: state.key } })).data })
  const save = useMutation({
    mutationFn: async (n: string) => {
      const s = state.snapshot()
      return api.post('/views', { name: n, scope: state.key, filters: { ...s.filters, __tab: s.tab, __extras: s.extras }, sort: { field: s.sort, order: s.order }, visible_columns: s.columns })
    },
    onSuccess: (_d, n) => { qc.invalidateQueries({ queryKey: key }); setSaving(false); setName(''); toast.success(`View “${n}” saved`) },
    onError: (e) => toast.error(apiError(e, 'Could not save the view')),
  })
  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/views/${id}`), onSuccess: () => { state.setViewId(null); qc.invalidateQueries({ queryKey: key }) } })
  const apply = (v: SavedViewRow) => {
    const { __tab, __extras, ...filters } = v.filters ?? {}
    const snap: TableSnapshot = { tab: __tab, extras: __extras, filters, sort: v.sort?.field, order: v.sort?.order === 'desc' ? 'desc' : 'asc', columns: v.visible_columns ?? undefined }
    state.apply(snap, v.id)
  }
  const active = views.find((v) => v.id === state.viewId)
  return (
    <>
      <Popover align="right" panelClassName="w-72 max-h-96 overflow-y-auto p-1.5" trigger={
        <Button variant="outline" size="sm" className={cn(active && 'border-primary/50 text-primary')}>
          <Star className={cn('h-3.5 w-3.5 sm:mr-1.5', active && 'fill-current')} /><span className="hidden max-w-[140px] truncate sm:inline">{active?.name || 'Views'}</span>
        </Button>
      }>
        {(close) => (
          <>
            {views.map((v) => (
              <div key={v.id} className={cn('flex items-center rounded-md hover:bg-gray-50', active?.id === v.id && 'bg-primary/5')}>
                <button className="flex-1 truncate px-2.5 py-2 text-left text-sm" onClick={() => { apply(v); close() }}>{v.name}</button>
                <button className="p-1.5 text-gray-300 hover:text-red-600" aria-label={`Delete view ${v.name}`} onClick={() => remove.mutate(v.id)}><Trash2 className="h-3.5 w-3.5" /></button>
              </div>
            ))}
            {views.length > 0 && <div className="my-1 h-px bg-gray-100" />}
            <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-gray-50" onClick={() => { setSaving(true); close() }}><Save className="h-3.5 w-3.5" /> Save current view…</button>
            <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-gray-50" onClick={() => { state.saveAsDefault(); toast.success('This view now opens by default'); close() }}>
              <Star className="h-3.5 w-3.5" /> Open this view by default
            </button>
          </>
        )}
      </Popover>
      {saving && (
        <Modal title="Save view" size="sm" onClose={() => setSaving(false)} footer={<>
          <Button variant="outline" onClick={() => setSaving(false)}>Cancel</Button>
          <Button disabled={!name.trim() || save.isPending} onClick={() => save.mutate(name.trim())}>Save</Button>
        </>}>
          <Input autoFocus placeholder="e.g. My team" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && name.trim()) save.mutate(name.trim()) }} />
          <p className="mt-2 text-xs text-gray-400">Saves the tab, filters, sort and columns. Only you can see it.</p>
        </Modal>
      )}
    </>
  )
}

/** "⋮" menu of on/off switches (Show archived, Show trash…). */
export function MoreMenu({ toggles, children }: { toggles?: { id: string; label: string; value: boolean; onChange: (v: boolean) => void }[]; children?: ReactNode }) {
  return (
    <Popover align="right" panelClassName="w-56 p-2" trigger={<Button variant="outline" size="sm" aria-label="More options"><MoreVertical className="h-3.5 w-3.5" /></Button>}>
      {toggles?.map((t) => (
        <label key={t.id} className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-gray-50">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={t.value} onChange={(e) => t.onChange(e.target.checked)} />{t.label}
        </label>
      ))}
      {children}
    </Popover>
  )
}

/**
 * The standard list toolbar: search, Filters (right-side panel), Sort, Columns, Views and ⋮,
 * with active-filter chips underneath. Leave out any part a list does not need.
 */
export function TableToolbar({ state, searchPlaceholder, filterFields, sorts, columns, views = true, more, children }: {
  state: TableState
  searchPlaceholder?: string
  filterFields?: RecordField[]
  sorts?: SortDef[]
  columns?: ColumnChoice[]
  views?: boolean
  more?: ReactNode
  /** Extra controls, placed after the standard ones. */
  children?: ReactNode
}) {
  return (
    <div className="flex shrink-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <SearchBox value={state.query} onChange={state.setQuery} placeholder={searchPlaceholder} />
        {filterFields && filterFields.length > 0 && <FilterButton simple fields={filterFields} value={state.filters} onChange={state.setFilters} />}
        {sorts && sorts.length > 0 && <SortMenu sorts={sorts} sort={state.sort} order={state.order} onSort={(id) => state.setSort(id)} onOrder={state.setOrder} />}
        {columns && columns.some((c) => !c.locked) && <ColumnMenu columns={columns} visible={state.columns} onToggle={(id) => state.toggleColumn(id, columns.map((c) => c.id))} />}
        {children}
        {views && <ViewsMenu state={state} />}
        {more}
      </div>
      {filterFields && <ActiveFilters simple fields={filterFields} value={state.filters} onChange={state.setFilters} />}
    </div>
  )
}
