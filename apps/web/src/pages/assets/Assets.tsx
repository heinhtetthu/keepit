import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowUpDown, Download, Laptop, MoreVertical, Pencil, Plus, Save, Search, Star, Trash2, Upload, UserPlus, X, Archive } from 'lucide-react'
import {
  ASSIGNMENT_STATUSES, CONDITION_STATUSES, csvToObjects, errorMessage, formatDate, daysUntil,
  useAssetMutation, useAssets, useAssetTabCounts, useEmployees, useReference, type Asset, type AssetCreate,
} from '@workspace/core'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Modal from '@/components/ui/modal'
import Popover from '@/components/ui/popover'
import RowMenu from '@/components/ui/menu'
import TruncatedText from '@/components/ui/truncated-text'
import { toast } from '@/components/ui/toaster'
import { TableCard, TableScrollArea, usePageSize, TablePager } from '@/components/table_shell'
import FilterButton, { ActiveFilters, type FilterState } from '@/components/FilterBar'
import { ColumnPicker, SortTh } from '@/components/DynamicTable'
import AssetFormDialog from '@/components/assets/AssetFormDialog'
import { AssignDialog } from '@/components/assets/ActionDialogs'
import { AssignmentBadge, ConditionBadge, EmptyState, Field, useCan, useConfirm } from '@/components/assets/shared'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'
import type { RecordField, SavedView } from '@/types'

/* The asset list works like a record list: preset tabs, a filter side panel,
   sort, columns, saved views and a "show written-off" switch. */

type Tab = 'all' | 'assigned' | 'available' | 'borrowed' | 'in_repair' | 'warranty' | 'written_off'
const TABS: { id: Tab; label: string; count: keyof NonNullable<ReturnType<typeof useAssetTabCounts>['data']>; tone?: string; params: Record<string, string> }[] = [
  { id: 'all', label: 'All', count: 'total', params: {} },
  { id: 'assigned', label: 'In use', count: 'assigned', params: { assignment_status: 'Assigned' } },
  { id: 'available', label: 'Available', count: 'available', params: { assignment_status: 'Unassigned', condition_status: 'Operational' } },
  { id: 'borrowed', label: 'Borrowed', count: 'borrowed', params: { assignment_status: 'Borrowed' } },
  { id: 'in_repair', label: 'In repair', count: 'in_repair', tone: 'text-amber-700', params: { condition_status: 'In Repair' } },
  { id: 'warranty', label: 'Warranty ending', count: 'warranty_expiring', tone: 'text-amber-700', params: { warranty: 'expiring' } },
  { id: 'written_off', label: 'Written-off', count: 'written_off', params: { condition_status: 'Written-Off' } },
]
const WARRANTY = [{ value: 'active', label: 'Active' }, { value: 'expiring', label: 'Ending in 90 days' }, { value: 'expired', label: 'Expired' }, { value: 'none', label: 'No warranty' }]

/** Filter-panel fields, shaped like record fields so the records filter panel can show them. */
function fld(id: number, slug: string, name: string, field_type: string, options: { value: string; label?: string }[] = []): RecordField {
  return {
    id, record_type_id: 0, name, slug, field_type, required: false, unique: false, searchable: false, sortable: true, filterable: true,
    show_in_list: true, show_in_details: true, show_in_reports: true, display_order: id, default_value: null, help_text: null, active: true,
    options: options.map((o, i) => ({ id: i + 1, value: o.value, label: o.label ?? o.value, display_order: i })) as RecordField['options'],
  }
}

const dayBefore = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
const list = (v: any): string | undefined => (Array.isArray(v?.in) && v.in.length ? v.in.join(',') : Array.isArray(v) && v.length ? v.join(',') : typeof v === 'string' && v ? v : undefined)

/** Panel filter state → the asset API's query parameters. */
function toParams(f: FilterState): Record<string, string | undefined> {
  const range = (v: any) => (v && typeof v === 'object' ? { from: v.gte as string | undefined, to: (v.lte ?? (v.lt ? dayBefore(v.lt) : undefined)) as string | undefined } : { from: undefined, to: undefined })
  const bought = range(f.purchase_date), warranty = range(f.warranty_end_date)
  return {
    asset_type: list(f.asset_type), brand: list(f.brand), supplier: list(f.supplier), location: list(f.location),
    assignment_status: list(f.assignment_status), condition_status: list(f.condition_status), business_unit: list(f.business_unit),
    employee_ids: list(f.holder), warranty: list(f.warranty), model: typeof f.model === 'string' ? f.model || undefined : undefined,
    purchase_from: bought.from, purchase_to: bought.to, warranty_from: warranty.from, warranty_to: warranty.to,
    cost_min: f.purchase_cost?.gte, cost_max: f.purchase_cost?.lte,
    open_repair: f.open_repair === true ? 'true' : f.open_repair?.notTrue || f.open_repair === false ? 'false' : undefined,
  }
}

type Column = { id: string; label: string; sort?: string; render: (a: Asset) => ReactNode }
const COLUMNS: Column[] = [
  { id: 'asset_type', label: 'Type', sort: 'asset_type', render: (a) => a.other_type_name || a.asset_type },
  { id: 'holder', label: 'Holder', sort: 'holder', render: (a) => a.employee
    ? <Link className="hover:text-primary hover:underline" to={`/employees/${a.employee.id}`} onClick={(e) => e.stopPropagation()}>{a.employee.name}</Link>
    : <span className="text-gray-400">—</span> },
  { id: 'status', label: 'Status', sort: 'assignment_status', render: (a) => (
    <div className="flex flex-wrap gap-1"><AssignmentBadge status={a.assignment_status} />{a.condition_status !== 'Operational' && <ConditionBadge status={a.condition_status} />}</div>) },
  { id: 'location', label: 'Location', sort: 'location', render: (a) => a.location || <span className="text-gray-400">—</span> },
  { id: 'warranty', label: 'Warranty', sort: 'warranty_end_date', render: (a) => {
    const left = daysUntil(a.warranty_end_date)
    if (!a.warranty_end_date) return <span className="text-gray-400">—</span>
    return <span className={cn('tabular-nums', left !== null && left < 0 ? 'text-gray-400 line-through decoration-gray-300' : left !== null && left <= 90 ? 'font-medium text-amber-700' : 'text-gray-700')}>{formatDate(a.warranty_end_date)}</span>
  } },
  { id: 'brand', label: 'Brand', sort: 'brand', render: (a) => a.brand || '—' },
  { id: 'model', label: 'Model', sort: 'model', render: (a) => a.model || '—' },
  { id: 'serial', label: 'Serial / product no.', sort: 'serial_number', render: (a) => <span className="font-mono text-xs">{a.serial_number || '—'}</span> },
  { id: 'condition', label: 'Condition', sort: 'condition_status', render: (a) => <ConditionBadge status={a.condition_status} /> },
  { id: 'business_unit', label: 'Business unit', render: (a) => (a.employee?.business_units ?? []).join(', ') || <span className="text-gray-400">—</span> },
  { id: 'supplier', label: 'Supplier', sort: 'supplier', render: (a) => a.supplier || '—' },
  { id: 'purchase_date', label: 'Purchased', sort: 'purchase_date', render: (a) => <span className="tabular-nums">{formatDate(a.purchase_date)}</span> },
  { id: 'purchase_cost', label: 'Cost', sort: 'purchase_cost', render: (a) => a.purchase_cost != null
    ? <span className="tabular-nums">{Number(a.purchase_cost).toLocaleString(undefined, { maximumFractionDigits: 2 })}{a.currency && <span className="text-gray-400"> {a.currency}</span>}</span> : '—' },
  { id: 'created_at', label: 'Added', sort: 'created_at', render: (a) => <span className="tabular-nums">{formatDate(a.created_at)}</span> },
]
const DEFAULT_COLUMNS = ['asset_type', 'holder', 'status', 'location', 'warranty']
const SORTS: { id: string; label: string; kind?: 'date' | 'number' }[] = [
  { id: 'created_at', label: 'Recently added', kind: 'date' }, { id: 'brand', label: 'Asset (brand)' }, { id: 'asset_type', label: 'Type' },
  { id: 'holder', label: 'Holder' }, { id: 'assignment_status', label: 'Assignment' }, { id: 'condition_status', label: 'Condition' },
  { id: 'location', label: 'Location' }, { id: 'supplier', label: 'Supplier' }, { id: 'warranty_end_date', label: 'Warranty end', kind: 'date' },
  { id: 'purchase_date', label: 'Purchase date', kind: 'date' }, { id: 'purchase_cost', label: 'Cost', kind: 'number' }, { id: 'updated_at', label: 'Last updated', kind: 'date' },
]
const dirLabel = (kind: string | undefined, dir: 'asc' | 'desc') =>
  kind === 'date' ? (dir === 'asc' ? 'Oldest first' : 'Newest first') : kind === 'number' ? (dir === 'asc' ? 'Low → high' : 'High → low') : (dir === 'asc' ? 'A → Z' : 'Z → A')

interface StartView { tab?: Tab; filters?: FilterState; sort?: string; order?: 'asc' | 'desc'; writtenOff?: boolean }

export default function Assets() {
  const can = useCan()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const userId = useAuthStore((s) => s.user?.id)
  const [sp] = useSearchParams()
  const startKey = `asset-start:${userId}`
  const colKey = `asset-columns:${userId}`
  const start: StartView = useMemo(() => { try { return JSON.parse(localStorage.getItem(startKey) || 'null') || {} } catch { return {} } }, [startKey])

  // Links from the dashboard (?type=, ?condition=, ?assignment=, ?sort=) still work.
  const linked = useMemo(() => {
    const f: FilterState = {}
    const type = sp.get('type') || sp.get('asset_type'); if (type) f.asset_type = { in: type.split(',') }
    const assignment = sp.get('assignment'); if (assignment) f.assignment_status = { in: [assignment] }
    const condition = sp.get('condition')
    if (condition && condition !== 'In Repair') f.condition_status = { in: [condition] }
    return { f, tab: condition === 'In Repair' ? 'in_repair' as Tab : null, any: !!(type || assignment || condition || sp.get('sort')) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const [tab, setTab] = useState<Tab>(linked.tab || (linked.any ? 'all' : start.tab || 'all'))
  const [filters, setFilters] = useState<FilterState>(linked.any ? linked.f : start.filters || {})
  const [sort, setSort] = useState(sp.get('sort') || start.sort || 'created_at')
  const [order, setOrder] = useState<'asc' | 'desc'>((sp.get('order') as 'asc' | 'desc') || start.order || 'desc')
  const [showWrittenOff, setShowWrittenOff] = useState(!!start.writtenOff)
  const [trash, setTrash] = useState(sp.get('view') === 'trash')
  const [search, setSearch] = useState(sp.get('q') ?? '')
  const [q, setQ] = useState(search)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('assets-page-size', 25)
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<null | 'add' | 'import' | 'bulk'>(null)
  const [assignId, setAssignId] = useState<number | null>(null)
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  const [activeView, setActiveView] = useState<SavedView | null>(null)
  const [columns, setColumnsState] = useState<string[]>(() => { try { const c = JSON.parse(localStorage.getItem(colKey) || 'null'); return Array.isArray(c) ? c : DEFAULT_COLUMNS } catch { return DEFAULT_COLUMNS } })
  const setColumns = (next: string[]) => { setColumnsState(next); try { localStorage.setItem(colKey, JSON.stringify(next)) } catch { /* storage unavailable */ } }
  const { confirm, dialog: confirmDialog } = useConfirm()

  useEffect(() => { const t = setTimeout(() => { setSearch(q.trim()); setPage(1) }, 250); return () => clearTimeout(t) }, [q])

  const { data: ref } = useReference()
  const { data: employees = [] } = useEmployees(true)
  const { data: counts } = useAssetTabCounts()
  const filterFields = useMemo(() => {
    const names = (k: 'asset_type' | 'brand' | 'vendor' | 'location') => (ref?.[k] ?? []).map((r) => ({ value: r.name }))
    return [
      fld(1, 'asset_type', 'Type', 'select', names('asset_type')),
      fld(2, 'brand', 'Brand', 'select', names('brand')),
      fld(3, 'model', 'Model', 'text'),
      fld(4, 'assignment_status', 'Assignment', 'select', ASSIGNMENT_STATUSES.map((v) => ({ value: v }))),
      fld(5, 'condition_status', 'Condition', 'select', CONDITION_STATUSES.map((v) => ({ value: v }))),
      fld(6, 'holder', 'Holder', 'select', employees.map((e) => ({ value: String(e.id), label: e.active ? e.name : `${e.name} (inactive)` }))),
      fld(7, 'business_unit', 'Business unit', 'business_unit'),
      fld(8, 'location', 'Location', 'select', names('location')),
      fld(9, 'supplier', 'Supplier', 'select', names('vendor')),
      fld(10, 'warranty', 'Warranty', 'select', WARRANTY),
      fld(11, 'warranty_end_date', 'Warranty ends', 'date'),
      fld(12, 'purchase_date', 'Purchased', 'date'),
      fld(13, 'purchase_cost', 'Purchase cost', 'currency'),
      fld(14, 'open_repair', 'Has an open repair', 'boolean'),
    ]
  }, [ref, employees])

  const tabDef = TABS.find((t) => t.id === tab)!
  const fromPanel = toParams(filters)
  const wantsWrittenOff = showWrittenOff || tab === 'written_off' || (fromPanel.condition_status ?? '').includes('Written-Off')
  const params = {
    ...fromPanel, ...tabDef.params, q: search || undefined, deleted: trash || undefined, hide_written_off: !trash && !wantsWrittenOff ? true : undefined,
    page, page_size: pageSize, sort, order,
  }
  const { data, isLoading, isFetching, error } = useAssets(params)
  const items = data?.items ?? []
  const assignAsset = items.find((i) => i.id === assignId)
  const remove = useAssetMutation((a, id: number) => a.assets.remove(id))
  const restore = useAssetMutation((a, id: number) => a.assets.restore(id))
  const retire = useAssetMutation((a, ids: number[]) => a.assets.bulkRetire(ids))

  const { data: savedViews = [], refetch: refetchViews } = useQuery<SavedView[]>({
    queryKey: ['saved-views', 'assets'], queryFn: async () => (await api.get('/views', { params: { scope: 'assets' } })).data,
  })
  const saveView = useMutation({
    mutationFn: async (name: string) => api.post('/views', {
      name, scope: 'assets', filters: { ...filters, __tab: tab, __written_off: showWrittenOff }, sort: { field: sort, order }, visible_columns: columns,
    }),
    onSuccess: (_d, name) => { void refetchViews(); setSavingView(false); setViewName(''); toast.success(`View "${name}" saved`) },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const deleteView = useMutation({
    mutationFn: async (id: number) => api.delete(`/views/${id}`),
    onSuccess: () => { setActiveView(null); void refetchViews(); qc.invalidateQueries({ queryKey: ['saved-views', 'assets'] }) },
  })

  const reset = () => { setPage(1); setSelected([]) }
  const applyView = (v: SavedView) => {
    const { __tab, __written_off, ...rest } = (v.filters || {}) as FilterState & { __tab?: Tab; __written_off?: boolean }
    setFilters(rest); setTab(__tab || 'all'); setShowWrittenOff(!!__written_off)
    setSort(v.sort?.field || 'created_at'); setOrder(v.sort?.order === 'asc' ? 'asc' : 'desc')
    if (v.visible_columns?.length) setColumns(v.visible_columns)
    setTrash(false); setActiveView(v); reset()
  }
  const chooseTab = (t: Tab) => {
    setTab(t); setActiveView(null); setTrash(false); reset()
    if (t === 'warranty') { setSort('warranty_end_date'); setOrder('asc') }
  }
  const onSort = (col: string) => { if (sort === col) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(col); setOrder('asc') } setPage(1) }

  const shownCols = COLUMNS.filter((c) => columns.includes(c.id))
  const columnFields = COLUMNS.map((c, i) => fld(100 + i, c.id, c.label, 'text'))
  const sortDef = SORTS.find((x) => x.id === sort) ?? SORTS[0]
  const allChecked = items.length > 0 && items.every((i) => selected.includes(i.id))
  const someChecked = items.some((i) => selected.includes(i.id))
  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      {/* Header */}
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><Laptop className="h-5 w-5 text-gray-600" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{trash ? 'Assets in trash' : 'Assets'}</h1>
            <p className="truncate text-sm text-gray-500">{trash ? 'Restore anything deleted by mistake.' : 'Every device, who holds it, and its repair and borrow history.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trash && <Button variant="outline" size="sm" onClick={() => { setTrash(false); reset() }}>Back to assets</Button>}
          {can('asset.create') && !trash && <Button variant="outline" size="sm" onClick={() => setDialog('import')}><Upload className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Import</span></Button>}
          {can('asset.create') && !trash && <Button size="sm" onClick={() => setDialog('add')}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add asset</span></Button>}
        </div>
      </div>

      {/* Preset tabs */}
      {!trash && (
        <div className="-mx-1 flex shrink-0 gap-1 overflow-x-auto overflow-y-hidden border-b px-1" role="tablist">
          {TABS.map((t) => {
            const n = counts?.[t.count]
            return (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => chooseTab(t.id)}
                className={cn('-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                  tab === t.id ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
                {t.label}
                {n != null && <span className={cn('rounded-full px-1.5 py-0.5 text-xs tabular-nums', tab === t.id ? 'bg-gray-900 text-white' : cn('bg-gray-100', n > 0 && t.tone ? t.tone : 'text-gray-500'))}>{n}</span>}
              </button>
            )
          })}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input placeholder="Brand, model, serial, holder…" value={q} onChange={(e) => setQ(e.target.value)} className="h-9 pl-9 pr-8" />
          {q && <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" onClick={() => setQ('')} aria-label="Clear search"><X className="h-4 w-4" /></button>}
        </div>
        <FilterButton simple fields={filterFields} value={filters} onChange={(f) => { setFilters(f); setActiveView(null); reset() }} />
        <Popover align="left" panelClassName="w-64 max-h-96 overflow-y-auto p-1.5" trigger={
          <Button variant="outline" size="sm" title="Sort"><ArrowUpDown className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Sort: {sortDef.label}</span></Button>
        }>
          {(close) => (
            <>
              <div className="mb-1 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-0.5 text-xs font-medium">
                {(['asc', 'desc'] as const).map((dir) => (
                  <button key={dir} onClick={() => { setOrder(dir); setPage(1) }} className={cn('rounded px-2 py-1.5', order === dir ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500')}>{dirLabel(sortDef.kind, dir)}</button>
                ))}
              </div>
              {SORTS.map((x) => (
                <button key={x.id} onClick={() => { setSort(x.id); setPage(1); close() }}
                  className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-gray-50', sort === x.id && 'font-medium text-primary')}>
                  {x.label}{sort === x.id && <span className="text-xs">{order === 'asc' ? '↑' : '↓'}</span>}
                </button>
              ))}
            </>
          )}
        </Popover>
        <ColumnPicker configuredFields={columnFields} visibleSlugs={columns}
          toggleColumn={(id) => setColumns(columns.includes(id) ? columns.filter((c) => c !== id) : COLUMNS.map((c) => c.id).filter((c) => c === id || columns.includes(c)))} />
        <Popover align="right" panelClassName="w-72 max-h-96 overflow-y-auto p-1.5" trigger={
          <Button variant="outline" size="sm" className={cn(activeView && 'border-primary/50 text-primary')}>
            <Star className={cn('h-3.5 w-3.5 sm:mr-1.5', activeView && 'fill-current')} /><span className="hidden max-w-[140px] truncate sm:inline">{activeView?.name || 'Views'}</span>
          </Button>
        }>
          {(close) => (
            <>
              {savedViews.map((v) => (
                <div key={v.id} className={cn('group flex items-center rounded-md hover:bg-gray-50', activeView?.id === v.id && 'bg-primary/5')}>
                  <button className="flex-1 truncate px-2.5 py-2 text-left text-sm" onClick={() => { applyView(v); close() }}>{v.name}</button>
                  <button className="p-1.5 text-gray-300 hover:text-red-600" aria-label={`Delete view ${v.name}`} onClick={() => deleteView.mutate(v.id)}><Trash2 className="h-3.5 w-3.5" /></button>
                </div>
              ))}
              {savedViews.length > 0 && <div className="my-1 h-px bg-gray-100" />}
              <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-gray-50" onClick={() => { setSavingView(true); close() }}><Save className="h-3.5 w-3.5" /> Save current view…</button>
              <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-gray-50" onClick={() => {
                try { localStorage.setItem(startKey, JSON.stringify({ tab, filters, sort, order, writtenOff: showWrittenOff })) } catch { /* ignore */ }
                toast.success('This view now opens by default'); close()
              }}><Star className="h-3.5 w-3.5" /> Open this view by default</button>
            </>
          )}
        </Popover>
        <Popover align="right" panelClassName="w-56 p-2" trigger={<Button variant="outline" size="sm" aria-label="More options"><MoreVertical className="h-3.5 w-3.5" /></Button>}>
          <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-gray-50">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={showWrittenOff} onChange={(e) => { setShowWrittenOff(e.target.checked); reset() }} />
            Show written-off
          </label>
          <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1.5 text-sm hover:bg-gray-50">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={trash} onChange={(e) => { setTrash(e.target.checked); reset() }} />
            Show trash
          </label>
        </Popover>
      </div>

      <ActiveFilters simple fields={filterFields} value={filters} onChange={(f) => { setFilters(f); setActiveView(null); reset() }} />

      {/* Table */}
      {error ? (
        <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">Could not load assets: {errorMessage(error)}</div>
      ) : isLoading && !data ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}</div>
      ) : (
        <TableCard className="min-h-0 flex-1" footer={
          <TablePager shown={items.length} total={data?.total ?? 0} noun="assets" page={page} pages={data?.total_pages ?? 1} onPage={setPage}
            pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
        }>
          <TableScrollArea className="flex-1">
            {items.length === 0 ? (
              <EmptyState icon={<Laptop className="h-10 w-10" />} title={trash ? 'Trash is empty' : 'No assets match'}>
                {!trash && can('asset.create') && !search && !Object.keys(filters).length && tab === 'all' && 'Add your first asset or import a CSV.'}
              </EmptyState>
            ) : (
              <table className={cn('w-full text-sm transition-opacity', isFetching && 'opacity-70')}>
                <thead className="sticky top-0 z-20 bg-gray-50/95 text-left text-xs font-medium text-gray-500 backdrop-blur [&_button]:uppercase [&_button]:tracking-wider [&_span]:uppercase [&_span]:tracking-wider">
                  <tr className="border-b">
                    {!trash && <th className="w-10 py-2.5 pl-4 pr-1">
                      <input type="checkbox" className="h-4 w-4 cursor-pointer align-middle accent-primary" checked={allChecked} aria-label="Select all on this page"
                        ref={(el) => { if (el) el.indeterminate = someChecked && !allChecked }} onChange={() => setSelected(allChecked ? [] : items.map((i) => i.id))} />
                    </th>}
                    <SortTh slug="brand" sort={sort} order={order} onSort={onSort}>Asset</SortTh>
                    {shownCols.map((c) => <SortTh key={c.id} slug={c.sort ?? c.id} disabled={!c.sort} sort={sort} order={order} onSort={onSort}>{c.label}</SortTh>)}
                    <th className="w-12 px-2 py-2.5"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((a) => {
                    const isSel = selected.includes(a.id)
                    return (
                      <tr key={a.id} onClick={() => navigate(`/assets/${a.id}`)}
                        className={cn('group cursor-pointer transition-colors hover:bg-gray-50', isSel && 'bg-primary/5 hover:bg-primary/10', a.condition_status === 'Written-Off' && 'opacity-60')}>
                        {!trash && <td className="py-2.5 pl-4 pr-1" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={isSel} onChange={() => toggle(a.id)} aria-label={`Select ${a.display_name}`} />
                        </td>}
                        <td className="max-w-[18rem] px-3 py-2.5">
                          <TruncatedText text={[a.brand, a.model].filter(Boolean).join(' ') || a.asset_type} className="font-medium text-gray-900" />
                          {a.serial_number && <TruncatedText text={a.serial_number} className="text-xs text-gray-500" />}
                        </td>
                        {shownCols.map((c) => <td key={c.id} className="whitespace-nowrap px-3 py-2.5 text-gray-600">{c.render(a)}</td>)}
                        <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                          <RowMenu items={trash ? [
                            { label: 'Restore', onSelect: () => restore.mutate(a.id, { onSuccess: () => toast.success('Asset restored'), onError: (e) => toast.error(errorMessage(e)) }), hidden: !can('asset.delete') },
                          ] : [
                            { label: 'Open', onSelect: () => navigate(`/assets/${a.id}`) },
                            { label: a.employee ? 'Reassign / unassign' : 'Assign', icon: <UserPlus />, onSelect: () => setAssignId(a.id), hidden: !can('asset.edit') || a.assignment_status === 'Borrowed' || a.condition_status === 'Written-Off' },
                            { label: 'Move to trash', icon: <Trash2 />, danger: true, divider: true, hidden: !can('asset.delete'), onSelect: () => confirm('Delete asset', `Move ${a.display_name} to trash? You can restore it later.`, () => remove.mutateAsync(a.id).then(() => toast.success('Moved to trash')), 'Delete') },
                          ]} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </TableScrollArea>
        </TableCard>
      )}

      {/* Bulk actions */}
      {selected.length > 0 && can('asset.edit') && !trash && (
        <div className="fixed bottom-20 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-sheet-up flex-wrap items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 shadow-xl backdrop-blur lg:bottom-4">
          <span className="mr-1 text-sm font-semibold">{selected.length} selected</span>
          <Button size="sm" onClick={() => navigate(`/quick-actions?tab=assign&assets=${selected.join(',')}`)}><UserPlus className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Assign…</span></Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('bulk')}><Pencil className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Bulk edit</span></Button>
          <Button size="sm" variant="outline" onClick={() => confirm('Write off assets', `Mark ${selected.length} asset(s) Written-Off and unassign them?`,
            () => retire.mutateAsync(selected).then(() => { toast.success('Assets written off'); setSelected([]) }), 'Write off')}><Archive className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Write off</span></Button>
          <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      {dialog === 'add' && <AssetFormDialog onClose={() => setDialog(null)} onSaved={(a) => navigate(`/assets/${a.id}`)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'bulk' && <BulkEditDialog ids={selected} onClose={() => { setDialog(null); setSelected([]) }} />}
      {assignAsset && <AssignDialog asset={assignAsset} onClose={() => setAssignId(null)} />}
      {savingView && (
        <Modal title="Save view" size="sm" onClose={() => setSavingView(false)} footer={<>
          <Button variant="outline" onClick={() => setSavingView(false)}>Cancel</Button>
          <Button disabled={!viewName.trim() || saveView.isPending} onClick={() => saveView.mutate(viewName.trim())}>Save</Button>
        </>}>
          <Input autoFocus placeholder="e.g. Finance laptops" value={viewName} onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && viewName.trim()) saveView.mutate(viewName.trim()) }} />
          <p className="mt-2 text-xs text-gray-400">Saves the tab, filters, sort and columns. Only you can see it.</p>
        </Modal>
      )}
      {confirmDialog}
    </div>
  )
}

const TEMPLATE = 'asset_type,brand,model,serial_number,location,purchase_date,purchase_cost,currency,supplier,warranty_end_date,cpu,ram,storage\nLaptop,Dell,Latitude 5440,ABC123,Head Office,2025-01-10,1200,USD,Dell Store,2028-01-10,i7,16GB,512GB\n'
const CORE_COLS = ['asset_type', 'type', 'other_type_name', 'brand', 'model', 'serial_number', 'serial', 'location', 'purchase_date', 'purchase_cost', 'cost', 'currency', 'supplier', 'vendor', 'warranty_end_date', 'warranty', 'notes']

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<AssetCreate[]>([])
  const [error, setError] = useState('')
  const m = useAssetMutation((a, items: AssetCreate[]) => a.assets.import(items))
  const parse = async (file: File) => {
    setError('')
    const objs = csvToObjects(await file.text())
    const items = objs.map((o) => ({
      asset_type: o.asset_type || o.type, other_type_name: o.other_type_name || null, brand: o.brand || null, model: o.model || null,
      serial_number: o.serial_number || o.serial || null, location: o.location || null, purchase_date: o.purchase_date || null,
      purchase_cost: o.purchase_cost || o.cost || null, currency: o.currency || null, supplier: o.supplier || o.vendor || null,
      warranty_end_date: o.warranty_end_date || o.warranty || null, notes: o.notes || null,
      specs: Object.fromEntries(Object.entries(o).filter(([k, v]) => !CORE_COLS.includes(k) && v)),
    })).filter((r) => r.asset_type)
    if (!items.length) setError('No rows with an asset_type column were found.')
    setRows(items as AssetCreate[])
  }
  const sample = useMemo(() => URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' })), [])
  return (
    <Modal size="lg" title="Import assets from CSV" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!rows.length || m.isPending} onClick={() => m.mutate(rows, {
        onSuccess: (r) => { toast.success(`Imported ${r.created} asset(s)${r.skipped ? `, skipped ${r.skipped} duplicate serial(s)` : ''}`); onClose() },
        onError: (e) => toast.error(errorMessage(e)),
      })}>{m.isPending ? 'Importing…' : `Import ${rows.length || ''}`}</Button>
    </>}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">One asset per row. Required column: <code>asset_type</code>. Other columns become specifications (cpu, ram…). Rows whose serial already exists are skipped.</p>
        <a href={sample} download="assets-template.csv" className="inline-flex items-center gap-1 text-primary hover:underline"><Download className="h-4 w-4" />Download template</a>
        <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && parse(e.target.files[0])} /></Field>
        {error && <p className="text-red-600">{error}</p>}
        {rows.length > 0 && (
          <div className="max-h-56 overflow-auto rounded border">
            <table className="w-full text-xs"><thead className="bg-gray-50"><tr>{['Type', 'Brand', 'Model', 'Serial', 'Specs'].map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 50).map((r, i) => <tr key={i} className="border-t"><td className="px-2 py-1">{r.asset_type}</td><td className="px-2 py-1">{r.brand}</td><td className="px-2 py-1">{r.model}</td><td className="px-2 py-1">{r.serial_number}</td><td className="px-2 py-1 text-gray-500">{Object.keys(r.specs ?? {}).join(', ')}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

function BulkEditDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const { data: ref } = useReference()
  const [f, setF] = useState({ location: '', condition_status: '', supplier: '' })
  const m = useAssetMutation((a, _: void) => a.assets.bulkUpdate({ ids, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }))
  return (
    <Modal title={`Edit ${ids.length} asset(s)`} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!Object.values(f).some(Boolean) || m.isPending} onClick={() => m.mutate(undefined, { onSuccess: () => { toast.success('Assets updated'); onClose() }, onError: (e) => toast.error(errorMessage(e)) })}>Apply</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">Only the fields you fill in are changed.</p>
        <Field label="Location"><Select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}><option value="">Keep</option>{(ref?.location ?? []).map((l) => <option key={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Condition"><Select value={f.condition_status} onChange={(e) => setF({ ...f, condition_status: e.target.value })}><option value="">Keep</option>{CONDITION_STATUSES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Supplier"><Select value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">Keep</option>{(ref?.vendor ?? []).map((l) => <option key={l.id}>{l.name}</option>)}</Select></Field>
      </div>
    </Modal>
  )
}
