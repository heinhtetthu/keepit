import { useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'
import { Download, Play, Users } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import type { RecordType, AllocationReport } from '../../types'
import { useAuthStore } from '../../store/auth'
import RenewalForecast from '@/components/RenewalForecast'
import ReportDownloads, { downloadCsv, downloadReportJob } from '@/components/ReportDownloads'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, choices, clientRows, filterField, filterRows, pageOf, sortRows, useTableState, type Column, type SortDef,
} from '@/components/data-table'

function ym(d: Date) { return d.toISOString().slice(0, 10) }
function yearsAgo(n: number) { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d }

export type RenewalSection = 'forecast' | 'allocation' | 'export' | 'downloads'

/** Renewal reports; the Reports hub shows one section at a time, with the report picker first in its toolbar. */
export default function RenewalReports({ section, picker }: { section: RenewalSection; picker?: ReactNode }) {
  const { user } = useAuthStore()
  const [sp, setSp] = useSearchParams()
  const { data: recordTypes } = useQuery<RecordType[]>({
    queryKey: ['record-types', user?.id],
    queryFn: async () => (await api.get('/record-types')).data,
  })

  if (section === 'forecast') return <RenewalForecast recordTypes={recordTypes || []} picker={picker} />
  if (section === 'allocation') return <Allocation recordTypes={recordTypes || []} picker={picker} initialJob={sp.get('job')} />
  if (section === 'downloads') return <ReportDownloads picker={picker} onOpenAllocation={(id) => setSp({ report: 'allocation', job: id }, { replace: true })} />
  return <ExportRecords recordTypes={recordTypes || []} picker={picker} />
}

/* License cost allocation: generated in the worker, then shown as seats or business-unit totals. */

type Seat = AllocationReport['records'][number]
type UnitRow = { id: string; business_unit: string | null; currency: string | null; allocated: number; seats: number; days: number }
const num = (n: number) => (n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })
const SEAT_COLUMNS: Column<Seat>[] = [
  { id: 'name', label: 'Seat', sort: 'name', locked: true, render: (r) => (
    <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-gray-900">{r.name}<Badge variant="secondary">{r.status}</Badge></span>) },
  { id: 'product', label: 'Product', sort: 'product', render: (r) => r.product || <span className="text-gray-300">-</span> },
  { id: 'holder', label: 'Holder · BU', sort: 'holder', nowrap: false, render: (r) => (
    <div className="space-y-0.5 text-xs">{r.spans.map((s) => (
      <div key={`${s.assignment_id}-${s.from}`} className="whitespace-nowrap"><span className="font-medium text-gray-800">{s.employee_name}</span>{s.business_unit && <span className="text-gray-500"> · {s.business_unit}</span>}</div>
    ))}</div>) },
  { id: 'span', label: 'Span', sort: 'from', render: (r) => <div className="space-y-0.5 text-xs tabular-nums">{r.spans.map((s) => <div key={`${s.assignment_id}-${s.from}`}>{s.from} to {s.to}</div>)}</div> },
  { id: 'days', label: 'Days', sort: 'days', align: 'right', render: (r) => <div className="space-y-0.5 text-xs">{r.spans.map((s) => <div key={`${s.assignment_id}-${s.from}`}>{s.days}</div>)}</div> },
  { id: 'allocated', label: 'Allocated', sort: 'allocated', align: 'right', render: (r) => (
    <div className="space-y-0.5 text-xs">{r.spans.map((s) => <div key={`${s.assignment_id}-${s.from}`}>{num(s.allocated)}{s.currency ? ` ${s.currency}` : ''}</div>)}</div>) },
]
const UNIT_COLUMNS: Column<UnitRow>[] = [
  { id: 'unit', label: 'Business unit', sort: 'business_unit', locked: true, render: (r) => <span className="font-medium text-gray-900">{r.business_unit || '(no BU)'}</span> },
  { id: 'currency', label: 'Currency', sort: 'currency', render: (r) => r.currency || 'Unspecified' },
  { id: 'unit_allocated', label: 'Allocated', sort: 'allocated', align: 'right', render: (r) => num(r.allocated) },
  { id: 'unit_seats', label: 'Seats', sort: 'seats', align: 'right', render: (r) => r.seats },
  { id: 'unit_days', label: 'Seat days', sort: 'days', align: 'right', render: (r) => r.days.toLocaleString() },
]
const SEAT_SORTS: SortDef[] = [
  { id: 'name', label: 'Seat' }, { id: 'product', label: 'Product' }, { id: 'holder', label: 'Holder' },
  { id: 'from', label: 'Span start', kind: 'date' }, { id: 'days', label: 'Days', kind: 'number' }, { id: 'allocated', label: 'Allocated', kind: 'number' },
]
const UNIT_SORTS: SortDef[] = [
  { id: 'allocated', label: 'Allocated', kind: 'number' }, { id: 'business_unit', label: 'Business unit' }, { id: 'currency', label: 'Currency' },
  { id: 'seats', label: 'Seats', kind: 'number' }, { id: 'days', label: 'Seat days', kind: 'number' },
]

const seatValue = (r: Seat, k: string): unknown => {
  switch (k) {
    case 'holder': return r.spans.map((s) => s.employee_name)
    case 'business_unit': return r.spans.map((s) => s.business_unit || '(no BU)')
    case 'from': return r.spans[0]?.from ?? null
    case 'days': return r.spans.reduce((n, s) => n + (s.days || 0), 0)
    case 'allocated': return r.allocated ?? r.spans.reduce((n, s) => n + (s.allocated || 0), 0)
    default: return (r as unknown as Record<string, unknown>)[k]
  }
}
// Sorting a list of holders uses the first one.
const seatSortValue = (r: Seat, k: string) => { const v = seatValue(r, k); return Array.isArray(v) ? v[0] : v }

async function fetchAllocation(job: string) {
  const first = (await api.get(`/reports/jobs/${job}/data`, { params: { page: 1, page_size: 100 } })).data as AllocationReport & { total: number }
  const pages = Math.min(50, Math.ceil(first.total / 100))
  const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) =>
    api.get(`/reports/jobs/${job}/data`, { params: { page: i + 2, page_size: 100 } }).then((r) => (r.data as AllocationReport).records)))
  return { ...first, records: [...first.records, ...rest.flat()], truncated: first.total > pages * 100 }
}

function Allocation({ recordTypes, picker, initialJob }: { recordTypes: RecordType[]; picker?: ReactNode; initialJob: string | null }) {
  const client = useQueryClient()
  const { hasPermission, user } = useAuthStore()
  const canExport = hasPermission('report.export')
  const [job, setJob] = useState<string | null>(initialJob)
  const [queueing, setQueueing] = useState(false)
  const [error, setError] = useState('')
  const [start, setStart] = useState(ym(yearsAgo(1)))
  const [end, setEnd] = useState(ym(new Date()))
  const [product, setProduct] = useState('')
  const t = useTableState({ key: 'rpt-allocation', defaultSort: 'name', defaultTab: 'seats',
    defaultColumns: [...SEAT_COLUMNS, ...UNIT_COLUMNS].map((c) => c.id) })

  const tracked = recordTypes.filter((rt) => rt.track_ownership)
  const typeId = tracked[0]?.id ?? null
  const { data: status } = useQuery<any>({
    queryKey: ['allocation-job', user?.id, job], queryFn: async () => (await api.get(`/reports/jobs/${job}`)).data, enabled: !!job,
    refetchInterval: (q) => ['pending', 'processing'].includes(q.state.data?.status) ? 2500 : false,
  })
  const { data: report, isFetching } = useQuery({
    queryKey: ['allocation-result', user?.id, job], queryFn: () => fetchAllocation(job!), enabled: !!job && status?.status === 'ready', retry: false,
  })
  const busy = queueing || isFetching || ['pending', 'processing'].includes(status?.status)
  const productOptions = Array.from(new Set((recordTypes.find((rt) => rt.id === typeId)?.fields.find((f) => f.name === 'Product Name')?.options || []).map((o) => o.label)))

  const seats = useMemo(() => report?.records ?? [], [report])
  const fields = useMemo(() => {
    const uniq = (vals: (string | null | undefined)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))
    return [
      filterField('product', 'Product', 'select', uniq(seats.map((s) => s.product))),
      filterField('status', 'Status', 'select', uniq(seats.map((s) => s.status))),
      filterField('holder', 'Holder', 'select', uniq(seats.flatMap((s) => s.spans.map((x) => x.employee_name)))),
      filterField('business_unit', 'Business unit', 'select', uniq(seats.flatMap((s) => s.spans.map((x) => x.business_unit || '(no BU)')))),
      filterField('days', 'Days held', 'integer'),
      filterField('allocated', 'Allocated', 'currency'),
    ]
  }, [seats])

  const unitsTab = t.tab === 'units'
  const state = { search: t.search, filters: t.filters, sort: t.sort, order: t.order, page: t.page, pageSize: t.pageSize }
  const seatView = useMemo(() => {
    const needle = t.search.toLowerCase()
    const searched = needle ? seats.filter((r) => [r.name, r.product, r.status, ...r.spans.flatMap((s) => [s.employee_name, s.business_unit])].join(' ').toLowerCase().includes(needle)) : seats
    const all = sortRows(filterRows(searched, t.filters, fields, seatValue), unitsTab ? 'name' : t.sort, unitsTab ? 'asc' : t.order, seatSortValue)
    return { all, rows: pageOf(all, t.page, t.pageSize), total: all.length, pages: Math.max(1, Math.ceil(all.length / t.pageSize)) }
  }, [seats, fields, t.search, t.filters, t.sort, t.order, t.page, t.pageSize, unitsTab])
  // Business-unit totals follow the filters: only matching seats, and only spans in the chosen units / holders.
  const units = useMemo(() => {
    const bu = choices(t.filters.business_unit), who = choices(t.filters.holder)
    const map = new Map<string, UnitRow>()
    for (const seat of seatView.all) {
      for (const s of seat.spans) {
        const name = s.business_unit || '(no BU)'
        if ((bu.length && !bu.includes(name)) || (who.length && !who.includes(s.employee_name))) continue
        const id = JSON.stringify([s.business_unit, s.currency])
        const row = map.get(id) ?? { id, business_unit: s.business_unit, currency: s.currency, allocated: 0, seats: 0, days: 0 }
        row.allocated += s.allocated || 0; row.seats += 1; row.days += s.days || 0
        map.set(id, row)
      }
    }
    return [...map.values()].map((r) => ({ ...r, allocated: Math.round(r.allocated * 100) / 100 }))
  }, [seatView.all, t.filters])
  const unitView = clientRows(units, { ...state, search: '', filters: {} }, [], (r, k) => (r as unknown as Record<string, unknown>)[k])
  const filtered = !!t.search || Object.keys(t.filters).length > 0

  const generate = async () => {
    setQueueing(true); setError('')
    try {
      const { data } = await api.post('/reports/jobs', { kind: 'allocation', record_type_id: typeId, start, end, product: product || undefined })
      setJob(data.id); t.setPage(1); client.invalidateQueries({ queryKey: ['export-jobs'] })
    } catch { setError('Could not queue allocation. Check the date range and permissions.') }
    finally { setQueueing(false) }
  }
  // Unfiltered: the worker's full CSV. Filtered: the rows on screen.
  const exportCsv = () => {
    if (!job) return
    if (!filtered) { downloadReportJob(job, 'allocation').catch(() => setError('Allocation download failed. Check permissions and regenerate.')); return }
    if (unitsTab) downloadCsv('allocation-units', ['Business unit', 'Currency', 'Allocated', 'Seats', 'Seat days'], unitView.all.map((r) => [r.business_unit || '', r.currency || '', r.allocated, r.seats, r.days]))
    else downloadCsv('allocation-seats', ['Seat', 'Status', 'Product', 'Holder', 'Business unit', 'From', 'To', 'Days', 'Allocated', 'Currency'],
      seatView.all.flatMap((r) => r.spans.map((s) => [r.name, r.status, r.product || '', s.employee_name, s.business_unit || '', s.from, s.to, s.days, s.allocated, s.currency || ''])))
  }

  if (tracked.length === 0) return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">{picker}</div>
      <p className="rounded-xl border bg-white p-6 text-sm text-gray-500">No record type tracks ownership yet. Turn on ownership tracking for a type (for example Licenses) to see cost by business unit.</p>
    </>
  )
  const validWindow = !!start && !!end && end >= start
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {picker}
        <Input type="date" className="h-9 w-40" value={start} onChange={(e) => setStart(e.target.value)} aria-label="From" />
        <span className="text-gray-400">to</span>
        <Input type="date" className="h-9 w-40" value={end} onChange={(e) => setEnd(e.target.value)} aria-label="To" />
        {productOptions.length > 0 && (
          <Select className="w-44" value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Product">
            <option value="">All products</option>
            {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
          </Select>
        )}
        <Button size="sm" onClick={generate} disabled={queueing || !typeId || !validWindow}><Play className="h-3.5 w-3.5 sm:mr-1.5" />Generate</Button>
        {canExport && <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv} disabled={!report || !seats.length}><Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">CSV</span></Button>}
      </div>
      <p className="shrink-0 text-sm text-gray-500">
        {!validWindow ? <span className="text-amber-600">Pick a valid date window.</span>
          : busy ? 'Calculating…'
          : report ? <>Seat costs prorated by exact days held, {report.record_type_name}, {report.start} to {report.end} ({report.window_days} days). Generate again after changing the window.</>
          : 'Each seat cost is prorated by exact days held per business unit inside the window. Pick a window and generate.'}
      </p>
      {(error || status?.error) && <p role="alert" className="shrink-0 rounded-md bg-red-50 p-3 text-sm text-red-700">{error || status.error}</p>}

      {report && <>
        <TableTabs tabs={[{ id: 'seats', label: 'Seats', count: seatView.total }, { id: 'units', label: 'Business units', count: units.length }]} value={t.tab}
          onChange={(id) => { t.setTab(id); t.setSort(id === 'units' ? 'allocated' : 'name', id === 'units' ? 'desc' : 'asc') }} />
        <TableToolbar state={t} searchPlaceholder="Seat, product, holder, unit…" filterFields={fields} sorts={unitsTab ? UNIT_SORTS : SEAT_SORTS}
          columns={unitsTab ? UNIT_COLUMNS : SEAT_COLUMNS} />
        {unitsTab
          ? <DataTable rows={unitView.rows} rowKey={(r) => r.id} columns={UNIT_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
              fetching={isFetching} empty={<EmptyRows icon={<Users className="h-9 w-9" />} title="No business units" hint={filtered ? 'Clear the search or filters.' : undefined} />}
              pager={{ page: t.page, pages: unitView.pages, total: unitView.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'units' }} />
          : <DataTable rows={seatView.rows} rowKey={(r) => r.record_id} columns={SEAT_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
              fetching={isFetching} rowClassName={() => 'align-top'}
              empty={<EmptyRows title="No seats" hint={filtered ? 'Clear the search or filters.' : 'No tracked records with ownership history in this window.'} />}
              pager={{ page: t.page, pages: seatView.pages, total: seatView.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'seats' }} />}
        {report.truncated && <p className="shrink-0 text-xs text-amber-700">Showing the first 5,000 seats. Download the CSV for all of them.</p>}
      </>}
    </>
  )
}

/* Classic record-type export (Excel or PDF, generated in the worker). */
function ExportRecords({ recordTypes, picker }: { recordTypes: RecordType[]; picker?: ReactNode }) {
  const client = useQueryClient()
  const canExport = useAuthStore((s) => s.hasPermission('report.export'))
  const [selectedType, setSelectedType] = useState<number | null>(null)
  const [downloading, setDownloading] = useState<'pdf' | 'excel' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const download = async (format: 'pdf' | 'excel') => {
    if (!selectedType) return
    setMessage(null); setDownloading(format)
    try {
      await api.post('/reports/jobs', { kind: format, record_type_id: selectedType })
      client.invalidateQueries({ queryKey: ['export-jobs'] })
      setMessage({ ok: true, text: 'Queued. It appears in My downloads when ready.' })
    } catch { setMessage({ ok: false, text: 'Download failed. Please try again.' }) } finally { setDownloading(null) }
  }
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {picker}
        <Select className="w-56" value={selectedType || ''} onChange={(e) => setSelectedType(Number(e.target.value) || null)} aria-label="Record type">
          <option value="">Choose a record type…</option>
          {recordTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
        </Select>
        {canExport && <>
          <Button size="sm" onClick={() => download('excel')} disabled={!selectedType || downloading !== null}>{downloading === 'excel' ? 'Preparing…' : 'Export Excel'}</Button>
          <Button size="sm" variant="outline" onClick={() => download('pdf')} disabled={!selectedType || downloading !== null}>{downloading === 'pdf' ? 'Preparing…' : 'Export PDF'}</Button>
        </>}
      </div>
      {!canExport && <p className="text-sm text-amber-600">You do not have permission to export reports.</p>}
      {message && <p role="status" className={message.ok ? 'text-sm text-green-700' : 'rounded-md bg-red-50 p-3 text-sm text-red-700'}>{message.text}</p>}
      <p className="text-sm text-gray-500">Exports run in the background so you can keep working. Find finished files under My downloads.</p>
    </>
  )
}
