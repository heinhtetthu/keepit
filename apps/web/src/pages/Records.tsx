import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Archive, ArrowUpDown, ChevronDown, Database, MoreVertical, Plus, Save, Search, Star, Trash2, Upload, X, ToggleRight, ToggleLeft, Users } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent } from '@/components/ui/card'
import Popover from '@/components/ui/popover'
import Modal from '@/components/ui/modal'
import { toast } from '@/components/ui/toaster'
import { useAuthStore } from '../store/auth'
import TypeIcon from '../components/TypeIcon'
import FilterButton, { ActiveFilters, type FilterState } from '../components/FilterBar'
import ImportWizard from '../components/ImportWizard'
import type { RecordType, RecordItem, RecordField, SavedView } from '../types'
import DynamicForm from '../components/DynamicForm'
import DynamicTable, { useVisibleColumns, ColumnPicker } from '../components/DynamicTable'
import SeatDialog, { BulkSeatDialog, seatOf, type SeatMode } from '../components/SeatDialog'
import { TableCard, TableScrollArea, usePageSize, TablePager } from '../components/table_shell'
import { pushRecent } from '../store/recent'
import { useViewMode, ViewSwitcher, Pager, VIEW_PAGE_SIZE } from '../components/ViewSwitcher'
import { cn } from '@/lib/utils'
import { apiError, seatFields } from '@/lib/seats'

type Tab = 'all' | 'expiring' | 'expired' | 'unassigned' | 'auto_off'

interface Summary {
  total: number
  expiring: number | null
  expired: number | null
  unassigned: number | null
  auto_renew_off: number | null
  today: string
  in_30_days: string
}

interface StartView { tab?: Tab; filters?: FilterState; sort?: string; order?: 'asc' | 'desc' }

export default function Records() {
  const { typeSlug } = useParams()
  const { data: recordTypes, isLoading, error } = useQuery<RecordType[]>({
    queryKey: ['record-types'],
    queryFn: async () => (await api.get('/record-types')).data,
    retry: 1,
  })
  if (!typeSlug) return <RecordTypeList types={recordTypes || []} loading={isLoading} failed={!!error} />
  if (isLoading) return <div className="text-gray-500">Loading…</div>
  const current = recordTypes?.find((rt) => rt.slug === typeSlug)
  if (!current) return <TypeNotFound slug={typeSlug} />
  return <RecordsOfType key={current.id} recordType={current} />
}

function RecordsOfType({ recordType }: { recordType: RecordType }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params] = useSearchParams()
  const { user } = useAuthStore()
  const sf = seatFields(recordType)
  const startKey = `record-start:${user?.id}:${recordType.id}`
  const start: StartView = useMemo(() => {
    try { return JSON.parse(localStorage.getItem(startKey) || 'null') || {} } catch { return {} }
  }, [startKey])
  const quick = params.get('quick')

  const [tab, setTab] = useState<Tab>(quick === 'expiring' || quick === 'expired' ? quick : start.tab || 'all')
  const [filters, setFilters] = useState<FilterState>(start.filters || {})
  const [sort, setSort] = useState(start.sort || sf.expiry?.slug || 'name')
  const [order, setOrder] = useState<'asc' | 'desc'>(start.order || 'asc')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('records')
  const [includeArchived, setIncludeArchived] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [form, setForm] = useState<{ record: RecordItem | null } | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [savingView, setSavingView] = useState(false)
  const [viewName, setViewName] = useState('')
  const [activeView, setActiveView] = useState<SavedView | null>(null)
  const [seatAction, setSeatAction] = useState<{ mode: SeatMode; record: RecordItem } | null>(null)
  const [bulkSeats, setBulkSeats] = useState<RecordItem[] | null>(null)

  useEffect(() => {
    pushRecent({ url: `/records/${recordType.slug}`, label: recordType.name, sublabel: 'Records', kind: 'record-type', icon: recordType.icon })
  }, [recordType.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const { configuredFields, visibleSlugs, toggleColumn } = useVisibleColumns(recordType)

  const { data: summary } = useQuery<Summary>({
    queryKey: ['records-summary', recordType.id],
    queryFn: async () => (await api.get(`/records/by-type/${recordType.id}/summary`)).data,
    refetchInterval: 60_000,
  })

  /* Tab filters are combined with whatever the user set in the Filters popover. */
  const effectiveFilters: FilterState = useMemo(() => {
    const out: FilterState = { ...filters }
    if (summary && sf.expiry) {
      if (tab === 'expiring') out[sf.expiry.slug] = { gte: summary.today, lte: summary.in_30_days }
      if (tab === 'expired') out[sf.expiry.slug] = { lt: summary.today }
    }
    if (tab === 'unassigned' && sf.assignee) out[sf.assignee.slug] = { isEmpty: true }
    if (tab === 'auto_off' && sf.autoRenew) out[sf.autoRenew.slug] = { notTrue: true }
    return out
  }, [filters, tab, summary, sf.expiry?.slug, sf.assignee?.slug, sf.autoRenew?.slug]) // eslint-disable-line react-hooks/exhaustive-deps

  const needsCalendar = tab === 'expiring' || tab === 'expired'
  const listKey = ['records', recordType.id, page, pageSize, search, JSON.stringify(effectiveFilters), sort, order, includeArchived]
  const { data: recordsData, isLoading: recordsLoading, error: recordsError } = useQuery({
    queryKey: listKey,
    queryFn: async () => (await api.get(`/records/by-type/${recordType.id}`, {
      params: {
        page, page_size: pageSize, search: search || undefined, sort, order, include_archived: includeArchived,
        filters: Object.keys(effectiveFilters).length ? JSON.stringify(effectiveFilters) : undefined,
      },
    })).data as { items: RecordItem[]; total: number; total_pages: number },
    enabled: !needsCalendar || !!summary,
    placeholderData: (prev) => prev,
    retry: 1,
  })

  const { data: savedViews, refetch: refetchViews } = useQuery<SavedView[]>({
    queryKey: ['saved-views', recordType.id],
    queryFn: async () => (await api.get('/views', { params: { record_type_id: recordType.id } })).data,
  })

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['records'] })
    queryClient.invalidateQueries({ queryKey: ['records-summary'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const setValue = useMutation({
    mutationFn: async ({ ids, field, value }: { ids: number[]; field: RecordField; value: unknown }) =>
      Promise.all(ids.map((id) => api.put(`/records/${id}`, { values: [{ field_id: field.id, value }] }))),
    onSuccess: (_d, v) => {
      refresh()
      setSelectedIds(new Set())
      toast.success(`${v.field.name} turned ${v.value ? 'on' : 'off'}${v.ids.length > 1 ? ` for ${v.ids.length} records` : ''}`)
    },
    onError: (err) => { refresh(); toast.error(apiError(err, 'Could not update')) },
  })

  const recordAction = useMutation({
    mutationFn: async ({ kind, ids }: { kind: 'archive' | 'delete' | 'duplicate'; ids: number[] }) => {
      if (kind === 'duplicate') return api.post(`/records/${ids[0]}/duplicate`)
      return api.post(`/records/bulk/${kind}`, { ids })
    },
    onSuccess: (_d, v) => {
      refresh()
      setSelectedIds(new Set())
      toast.success(v.kind === 'duplicate' ? 'Record duplicated' : `${v.ids.length} record${v.ids.length === 1 ? '' : 's'} ${v.kind === 'archive' ? 'archived' : 'deleted'}`)
    },
    onError: (err) => toast.error(apiError(err, 'Action failed')),
  })

  const saveView = useMutation({
    mutationFn: async (name: string) => api.post('/views', {
      name, record_type_id: recordType.id, filters: { ...filters, __tab: tab }, sort: { field: sort, order }, visible_columns: visibleSlugs,
    }),
    onSuccess: (_d, name) => { refetchViews(); setSavingView(false); setViewName(''); toast.success(`View "${name}" saved`) },
    onError: (err) => toast.error(apiError(err, 'Failed to save view')),
  })

  const deleteView = useMutation({
    mutationFn: async (id: number) => api.delete(`/views/${id}`),
    onSuccess: () => { setActiveView(null); refetchViews() },
  })

  const applyView = (view: SavedView) => {
    const { __tab, ...rest } = (view.filters || {}) as FilterState & { __tab?: Tab }
    setFilters(rest)
    setTab(__tab || 'all')
    setSort(view.sort?.field || 'name')
    setOrder(view.sort?.order === 'desc' ? 'desc' : 'asc')
    setPage(1)
    setActiveView(view)
  }

  const chooseTab = (t: Tab) => {
    setTab(t)
    setPage(1)
    setActiveView(null)
    if ((t === 'expiring' || t === 'expired') && sf.expiry) { setSort(sf.expiry.slug); setOrder(t === 'expired' ? 'desc' : 'asc') }
  }

  const tabs: { id: Tab; label: string; count: number | null | undefined; tone?: string }[] = [
    { id: 'all', label: 'All', count: summary?.total },
    ...(sf.expiry ? [
      { id: 'expiring' as Tab, label: 'Expiring soon', count: summary?.expiring, tone: 'text-amber-700' },
      { id: 'expired' as Tab, label: 'Expired', count: summary?.expired, tone: 'text-red-600' },
    ] : []),
    ...(recordType.track_ownership && sf.assignee ? [{ id: 'unassigned' as Tab, label: 'Unassigned', count: summary?.unassigned }] : []),
    ...(sf.autoRenew ? [{ id: 'auto_off' as Tab, label: 'Auto-renew off', count: summary?.auto_renew_off, tone: 'text-amber-700' }] : []),
  ]

  const canInType = useAuthStore((s) => s.canInType)
  const canCreate = canInType('record.create', recordType.id)
  const canEdit = canInType('record.edit', recordType.id)
  const canDelete = canInType('record.delete', recordType.id)
  const selCount = selectedIds.size
  const sortable: { slug: string; name: string; field_type?: string }[] = [
    ...(sf.expiry ? [sf.expiry] : []),
    ...(recordType.track_ownership && sf.assignee ? [{ ...sf.assignee, name: 'Holder' }] : []),
    { slug: 'name', name: 'Name' },
    ...(recordType.fields || []).filter((f) => f.active && f.sortable !== false && !['long_text', 'multi_select', 'secret'].includes(f.field_type) && ![sf.expiry?.slug, sf.assignee?.slug].includes(f.slug)).sort((a, b) => a.display_order - b.display_order),
  ]
  const sortField = sortable.find((f) => f.slug === sort)
  const sortLabel = sortField?.name || 'Name'
  const onSort = (slug: string) => { if (sort === slug) setOrder(order === 'asc' ? 'desc' : 'asc'); else { setSort(slug); setOrder('asc') } setPage(1) }

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      {/* Header */}
      <div className="flex flex-wrap items-center gap-3 shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="h-10 w-10 rounded-lg bg-white border flex items-center justify-center shrink-0">
            <TypeIcon icon={recordType.icon} className="h-5 w-5 text-gray-600" />
          </div>
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-gray-900 truncate">{recordType.name}</h1>
            {recordType.description && <p className="text-sm text-gray-500 truncate">{recordType.description}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Button variant="outline" size="sm" onClick={() => setShowImport(true)}>
              <Upload className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Import</span>
            </Button>
          )}
          {canCreate && (
            <Button size="sm" onClick={() => setForm({ record: null })}>
              <Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add record</span>
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="-mx-1 flex gap-1 overflow-x-auto overflow-y-hidden px-1 shrink-0 border-b" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => chooseTab(t.id)}
            className={cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === t.id ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
            )}
          >
            {t.label}
            {t.count != null && (
              <span className={cn('rounded-full px-1.5 py-0.5 text-xs tabular-nums', tab === t.id ? 'bg-gray-900 text-white' : cn('bg-gray-100', t.count > 0 && t.tone ? t.tone : 'text-gray-500'))}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            placeholder={recordType.track_ownership ? 'Search people, products, emails…' : 'Search…'}
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1) }}
            className="h-9 pl-9 pr-8"
          />
          {search && (
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" onClick={() => { setSearch(''); setPage(1) }} aria-label="Clear search">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <FilterButton fields={recordType.fields || []} value={filters} showRenewed={!!sf.expiry} onChange={(f) => { setFilters(f); setPage(1); setActiveView(null) }} />
        <Popover
          align="left"
          panelClassName="w-64 max-h-96 overflow-y-auto p-1.5"
          trigger={
            <Button variant="outline" size="sm" title="Sort">
              <ArrowUpDown className="h-3.5 w-3.5 sm:mr-1.5" />
              <span className="hidden sm:inline">Sort: {sortLabel}</span>
            </Button>
          }
        >
          {(close) => (
            <>
              <div className="mb-1 grid grid-cols-2 gap-1 rounded-md bg-gray-100 p-0.5 text-xs font-medium">
                {(['asc', 'desc'] as const).map((dir) => (
                  <button key={dir} onClick={() => { setOrder(dir); setPage(1) }} className={cn('rounded px-2 py-1.5', order === dir ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500')}>
                    {directionLabel(sortField, dir)}
                  </button>
                ))}
              </div>
              {sortable.map((f) => (
                <button
                  key={f.slug}
                  onClick={() => { setSort(f.slug); setPage(1); close() }}
                  className={cn('flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm hover:bg-gray-50', sort === f.slug && 'font-medium text-primary')}
                >
                  {f.name}
                  {sort === f.slug && <span className="text-xs">{order === 'asc' ? '↑' : '↓'}</span>}
                </button>
              ))}
            </>
          )}
        </Popover>
        <ColumnPicker configuredFields={configuredFields} visibleSlugs={visibleSlugs} toggleColumn={toggleColumn} />
        <Popover
          align="right"
          panelClassName="w-72 max-h-96 overflow-y-auto p-1.5"
          trigger={
            <Button variant="outline" size="sm" className={cn(activeView && 'border-primary/50 text-primary')}>
              <Star className={cn('h-3.5 w-3.5 sm:mr-1.5', activeView && 'fill-current')} />
              <span className="hidden sm:inline max-w-[140px] truncate">{activeView?.name || 'Views'}</span>
            </Button>
          }
        >
          {(close) => (
            <>
              {(savedViews || []).map((v) => (
                <div key={v.id} className={cn('group flex items-center rounded-md hover:bg-gray-50', activeView?.id === v.id && 'bg-primary/5')}>
                  <button className="flex-1 truncate px-2.5 py-2 text-left text-sm" onClick={() => { applyView(v); close() }}>{v.name}</button>
                  <button className="p-1.5 text-gray-300 hover:text-red-600" aria-label={`Delete view ${v.name}`} onClick={() => deleteView.mutate(v.id)}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {(savedViews || []).length > 0 && <div className="my-1 h-px bg-gray-100" />}
              <button className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-gray-50" onClick={() => { setSavingView(true); close() }}>
                <Save className="h-3.5 w-3.5" /> Save current view…
              </button>
              <button
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-sm hover:bg-gray-50"
                onClick={() => {
                  try { localStorage.setItem(startKey, JSON.stringify({ tab, filters, sort, order })) } catch { /* ignore */ }
                  toast.success('This view now opens by default')
                  close()
                }}
              >
                <Star className="h-3.5 w-3.5" /> Open this view by default
              </button>
            </>
          )}
        </Popover>
        <Popover
          align="right"
          panelClassName="w-52 p-2"
          trigger={<Button variant="outline" size="sm" aria-label="More options"><MoreVertical className="h-3.5 w-3.5" /></Button>}
        >
          <label className="flex items-center gap-2 rounded px-1.5 py-1.5 text-sm cursor-pointer hover:bg-gray-50">
            <input type="checkbox" className="h-4 w-4 accent-primary" checked={includeArchived} onChange={(e) => { setIncludeArchived(e.target.checked); setPage(1) }} />
            Show archived
          </label>
        </Popover>
      </div>

      <ActiveFilters fields={recordType.fields || []} value={filters} onChange={(fl) => { setFilters(fl); setPage(1); setActiveView(null) }} />

      {/* Table */}
      {recordsError ? (
        <div className="flex flex-wrap items-center gap-3 rounded-md bg-red-50 p-4 text-sm text-red-700">
          Failed to load records: {apiError(recordsError, 'Unknown error')}
          <Button variant="outline" size="sm" onClick={refresh}>Retry</Button>
        </div>
      ) : recordsLoading && !recordsData ? (
        <div className="space-y-2">{[0, 1, 2, 3, 4].map((i) => <div key={i} className="h-12 rounded-lg bg-gray-100 animate-pulse" />)}</div>
      ) : (
        <TableCard className="flex-1 min-h-0" footer={
          <TablePager shown={recordsData?.items.length || 0} total={recordsData?.total || 0} noun="records" page={page} pages={recordsData?.total_pages || 1} onPage={setPage}
            pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1) }} />
        }>
          <TableScrollArea className="flex-1 overflow-x-hidden">
            <DynamicTable
              recordType={recordType}
              today={summary?.today}
              records={recordsData?.items || []}
              visibleColumns={visibleSlugs}
              sort={sort}
              order={order}
              onSort={onSort}
              onView={(r) => navigate(`/records/${recordType.slug}/${r.id}`)}
              onEdit={(r) => setForm({ record: r })}
              onArchive={canDelete ? (r) => { if (confirm(`Archive "${r.name}"?`)) recordAction.mutate({ kind: 'archive', ids: [r.id] }) } : undefined}
              onDuplicate={canCreate ? (r) => recordAction.mutate({ kind: 'duplicate', ids: [r.id] }) : undefined}
              onSeatAction={recordType.track_ownership ? (mode, record) => setSeatAction({ mode, record }) : undefined}
              onToggle={canEdit ? (r, field, value) => setValue.mutate({ ids: [r.id], field, value }) : undefined}
              selectedIds={selectedIds}
              onSelectionChange={setSelectedIds}
            />
          </TableScrollArea>
        </TableCard>
      )}

      {/* Bulk actions */}
      {selCount > 0 && (
        <div className="fixed bottom-4 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 shadow-xl backdrop-blur">
          <span className="mr-1 text-sm font-semibold">{selCount} selected</span>
          {canEdit && recordType.track_ownership && (
            <Button size="sm" onClick={() => setBulkSeats((recordsData?.items || []).filter((r) => selectedIds.has(r.id)))}>
              <Users className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Reassign / swap…</span>
            </Button>
          )}
          {canEdit && sf.autoRenew && (
            <>
              <Button variant="outline" size="sm" onClick={() => setValue.mutate({ ids: [...selectedIds], field: sf.autoRenew!, value: true })}>
                <ToggleRight className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Auto-renew on</span>
              </Button>
              <Button variant="outline" size="sm" onClick={() => setValue.mutate({ ids: [...selectedIds], field: sf.autoRenew!, value: false })}>
                <ToggleLeft className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Off</span>
              </Button>
            </>
          )}
          {canDelete && !includeArchived && (
            <Button variant="outline" size="sm" onClick={() => recordAction.mutate({ kind: 'archive', ids: [...selectedIds] })}>
              <Archive className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Archive</span>
            </Button>
          )}
          {canDelete && (
            <Button variant="destructive" size="sm" onClick={() => { if (confirm(`Move ${selCount} record(s) to Trash?`)) recordAction.mutate({ kind: 'delete', ids: [...selectedIds] }) }}>
              <Trash2 className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Delete</span>
            </Button>
          )}
          <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setSelectedIds(new Set())}>Clear</Button>
        </div>
      )}

      {form && <DynamicForm recordType={recordType} record={form.record} onClose={() => { setForm(null); refresh() }} />}
      {showImport && <ImportWizard recordType={recordType} onClose={() => { setShowImport(false); refresh() }} />}
      {seatAction && (
        <SeatDialog
          mode={seatAction.mode}
          recordType={recordType}
          seat={seatOf(recordType, seatAction.record.values || {}, seatAction.record.id, seatAction.record.name)}
          onClose={() => setSeatAction(null)}
        />
      )}
      {bulkSeats && (
        <BulkSeatDialog records={bulkSeats} recordType={recordType} onClose={() => { setBulkSeats(null); setSelectedIds(new Set()) }} />
      )}
      {savingView && (
        <Modal
          title="Save view"
          size="sm"
          onClose={() => setSavingView(false)}
          footer={
            <>
              <Button variant="outline" onClick={() => setSavingView(false)}>Cancel</Button>
              <Button disabled={!viewName.trim() || saveView.isPending} onClick={() => saveView.mutate(viewName.trim())}>Save</Button>
            </>
          }
        >
          <Input
            autoFocus
            placeholder="e.g. Sampan licenses"
            value={viewName}
            onChange={(e) => setViewName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && viewName.trim()) saveView.mutate(viewName.trim()) }}
          />
          <p className="mt-2 text-xs text-gray-400">Saves the tab, filters, sort and columns. Only you can see it.</p>
        </Modal>
      )}
    </div>
  )
}

function TypeNotFound({ slug }: { slug: string }) {
  const navigate = useNavigate()
  return (
    <Card>
      <CardContent className="flex items-center gap-3 rounded-md bg-yellow-50 p-4 text-sm text-yellow-800">
        <Database className="h-4 w-4" />
        Record type "{slug}" was not found.
        <button onClick={() => navigate('/records')} className="ml-auto font-medium underline">Back</button>
      </CardContent>
    </Card>
  )
}

function RecordTypeList({ types, loading, failed }: { types: RecordType[]; loading: boolean; failed: boolean }) {
  const navigate = useNavigate()
  const [mode, setMode] = useViewMode('records-types')
  const [page, setPage] = useState(1)
  const pages = Math.max(1, Math.ceil(types.length / VIEW_PAGE_SIZE))
  const cur = Math.min(page, pages)
  const shown = types.slice((cur - 1) * VIEW_PAGE_SIZE, cur * VIEW_PAGE_SIZE)
  const icon = (rt: RecordType) => (
    <div className="h-10 w-10 rounded-lg bg-gray-50 border flex items-center justify-center shrink-0 group-hover:bg-primary/5 transition-colors">
      <TypeIcon icon={rt.icon} className="h-5 w-5 text-gray-600" />
    </div>
  )

  let body
  if (failed) body = <div className="rounded-md bg-red-50 p-4 text-sm text-red-700">Failed to load record types. Please refresh.</div>
  else if (loading) body = <div className="text-gray-500">Loading…</div>
  else if (mode === 'list' || mode === 'details') {
    body = (
      <div className="divide-y rounded-lg border bg-white shadow-sm">
        {shown.map((rt) => (
          <button key={rt.id} className="group flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-gray-50" onClick={() => navigate(`/records/${rt.slug}`)}>
            {icon(rt)}
            <span className="font-medium truncate">{rt.name}</span>
            <span className="hidden flex-1 truncate text-sm text-gray-500 sm:block">{rt.description}</span>
            <ChevronDown className="h-4 w-4 -rotate-90 text-gray-300" />
          </button>
        ))}
      </div>
    )
  } else {
    body = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {shown.map((rt) => (
          <Card key={rt.id} className="group cursor-pointer transition-all hover:border-primary/30 hover:shadow-md" onClick={() => navigate(`/records/${rt.slug}`)}>
            <CardContent className="flex items-start gap-3 p-5">
              {icon(rt)}
              <div className="min-w-0 flex-1">
                <h3 className="truncate font-semibold">{rt.name}</h3>
                <p className="mt-0.5 line-clamp-2 text-sm text-gray-500">{rt.description || 'No description'}</p>
              </div>
              <ChevronDown className="mt-1 h-4 w-4 -rotate-90 text-gray-300 group-hover:text-primary" />
            </CardContent>
          </Card>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Records</h1>
          <p className="mt-1 text-sm text-gray-500">Pick a record type to see its records.</p>
        </div>
        <ViewSwitcher mode={mode} onChange={(m) => { setMode(m); setPage(1) }} />
      </div>
      {body}
      {types.length > VIEW_PAGE_SIZE && <Pager page={cur} pages={pages} onPage={setPage} />}
    </div>
  )
}

function directionLabel(field: { field_type?: string } | undefined, dir: 'asc' | 'desc'): string {
  const t = field?.field_type
  if (t === 'date' || t === 'datetime') return dir === 'asc' ? 'Soonest first' : 'Latest first'
  if (t && ['integer', 'decimal', 'currency', 'percentage'].includes(t)) return dir === 'asc' ? 'Low → high' : 'High → low'
  if (t === 'boolean') return dir === 'asc' ? 'No first' : 'Yes first'
  return dir === 'asc' ? 'A → Z' : 'Z → A'
}
