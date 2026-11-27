import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { RefreshCcw } from 'lucide-react'
import api from '@/lib/api'
import { errorMessage } from '@workspace/core'
import {
  DataTable, EmptyRows, TableToolbar, TitleCell, clientRows, filterField, useTableState,
  type Column, type SortDef,
} from '@/components/data-table'
import { useAuthStore } from '../store/auth'

interface RenewalEntry {
  id: number
  record_id: number
  record_name: string
  record_type: string
  record_type_slug: string
  can_open: boolean
  created_at: string
  renewed_on: string | null
  old_date: string | null
  new_date: string
}

/* The endpoint pages and searches only, so the log loads whole (up to MAX rows)
   and is filtered, sorted and paged in the browser. */
const MAX_PAGES = 20
const NONE: RenewalEntry[] = []
async function fetchAll(): Promise<RenewalEntry[]> {
  const out: RenewalEntry[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data = (await api.get('/records/auto-renewals', { params: { page, page_size: 100 } })).data
    out.push(...(data.items ?? []))
    if (page >= (data.total_pages ?? 1)) break
  }
  return out
}

const calendarDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
const formatDate = (value: string | null) => (value ? calendarDate.format(new Date(value)) : '-')
const early = (e: RenewalEntry) => !!(e.renewed_on && e.old_date && e.renewed_on < e.old_date)

const COLUMNS: Column<RenewalEntry>[] = [
  { id: 'record', label: 'Record', sort: 'record', locked: true, render: (e) => (
    <TitleCell title={e.can_open
      ? <Link className="text-primary hover:underline" onClick={(ev) => ev.stopPropagation()} to={`/records/${encodeURIComponent(e.record_type_slug)}/${e.record_id}`}>{e.record_name}</Link>
      : e.record_name} sub={e.record_type} />) },
  { id: 'record_type', label: 'Record type', sort: 'record_type', render: (e) => e.record_type },
  { id: 'old_date', label: 'Previous expiry', sort: 'old_date', render: (e) => <span className="tabular-nums">{formatDate(e.old_date)}</span> },
  { id: 'new_date', label: 'New expiry', sort: 'new_date', render: (e) => (
    <span className="tabular-nums"><span className="font-medium">{formatDate(e.new_date)}</span>
      {early(e) && <span className="block text-xs text-gray-500">Recorded early. Effective {formatDate(e.old_date)}.</span>}</span>) },
  { id: 'renewed_on', label: 'Renewed on', sort: 'renewed_on', render: (e) => <span className="tabular-nums">{formatDate(e.renewed_on)}</span> },
  { id: 'created_at', label: 'Logged at', sort: 'created_at', render: (e) => <span className="tabular-nums text-gray-500">{new Date(e.created_at).toLocaleString()}</span> },
]
const SORTS: SortDef[] = [
  { id: 'created_at', label: 'Logged at', kind: 'date' }, { id: 'record', label: 'Record' }, { id: 'record_type', label: 'Record type' },
  { id: 'old_date', label: 'Previous expiry', kind: 'date' }, { id: 'new_date', label: 'New expiry', kind: 'date' }, { id: 'renewed_on', label: 'Renewed on', kind: 'date' },
]
const get = (e: RenewalEntry, slug: string): unknown => {
  switch (slug) {
    case 'record': return e.record_name
    case 'record_type': return e.record_type
    case 'early': return early(e)
    default: return (e as unknown as Record<string, unknown>)[slug]
  }
}

export default function AutoRenewalLog() {
  const userId = useAuthStore((s) => s.user?.id)
  const t = useTableState({ key: 'autorenew', defaultSort: 'created_at', defaultOrder: 'desc', defaultColumns: ['record_type', 'old_date', 'new_date', 'created_at'] })
  const { data, isLoading, isFetching, error } = useQuery({ queryKey: ['automatic-renewals', userId, 'all'], queryFn: fetchAll })
  const all = data ?? NONE
  const fields = useMemo(() => [
    filterField('record_type', 'Record type', 'select', [...new Set(all.map((e) => e.record_type))].sort()),
    filterField('created_at', 'Logged', 'date'),
    filterField('old_date', 'Previous expiry', 'date'),
    filterField('new_date', 'New expiry', 'date'),
    filterField('early', 'Recorded early', 'boolean'),
  ], [all])
  const view = clientRows(all, t, fields, get, (e) => `${e.record_name} ${e.record_type}`)
  const filtered = !!t.search || Object.keys(t.filters).length > 0

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <header className="shrink-0">
        <h2 className="text-lg font-semibold">Auto-renewal log</h2>
        <p className="mt-1 text-sm text-gray-500">Automatic renewals across the record types you can see.</p>
      </header>

      <TableToolbar state={t} searchPlaceholder="Record or type…" filterFields={fields} sorts={SORTS} columns={COLUMNS} />

      <DataTable rows={view.rows} rowKey={(e) => e.id} columns={COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading} fetching={isFetching && !isLoading} error={error ? `Could not load the auto-renewal log. ${errorMessage(error)}` : null}
        empty={<EmptyRows icon={<RefreshCcw className="h-9 w-9" />} title={filtered ? 'No renewals match' : 'No automatic renewals yet'} hint={filtered ? 'Try clearing the filters.' : undefined} />}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'renewals' }} />
    </div>
  )
}
