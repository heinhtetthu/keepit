import { lazy, Suspense, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  BarChart3, Boxes, CalendarClock, ChevronDown, ClipboardCheck, Download, FileDown, Handshake, Laptop,
  ShieldCheck, TrendingUp, Users, Wrench,
} from 'lucide-react'
import { errorMessage, formatDate, formatMoney, useApi, type AssetReport, type AssetReportKind } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Popover from '@/components/ui/popover'
import { toast } from '@/components/ui/toaster'
import {
  DataTable, EmptyRows, TableToolbar, clientRows, filterField, useTableState, type Column, type SortDef,
} from '@/components/data-table'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'
import type { RenewalSection } from './RenewalReports'
const RenewalReports = lazy(() => import('./RenewalReports'))

type ReportDef = { key: string; group: 'Assets' | 'Renewals'; title: string; description: string; icon: typeof Laptop; permission: string; dated?: boolean }

const REPORTS: ReportDef[] = [
  { key: 'inventory', group: 'Assets', title: 'Asset inventory', description: 'Every asset with holder, status, value and warranty', icon: Boxes, permission: 'asset.view' },
  { key: 'repairs', group: 'Assets', title: 'Repairs & costs', description: 'What broke, who fixed it and what it cost', icon: Wrench, permission: 'itlog.view', dated: true },
  { key: 'maintenance', group: 'Assets', title: 'Maintenance checks', description: 'Checks done and issues found', icon: ClipboardCheck, permission: 'itlog.view', dated: true },
  { key: 'borrows', group: 'Assets', title: 'Borrows', description: 'Items lent out, due and overdue', icon: Handshake, permission: 'itlog.view', dated: true },
  { key: 'warranties', group: 'Assets', title: 'Warranty expiry', description: 'Warranties ending soon or already expired', icon: ShieldCheck, permission: 'asset.view', dated: true },
  { key: 'holders', group: 'Assets', title: 'Who holds what', description: 'Assets per person and business unit', icon: Users, permission: 'asset.view' },
  { key: 'forecast', group: 'Renewals', title: 'Renewal forecast', description: 'Upcoming renewal costs by month', icon: TrendingUp, permission: 'report.view' },
  { key: 'allocation', group: 'Renewals', title: 'License cost allocation', description: 'Seat costs by business unit', icon: BarChart3, permission: 'report.view' },
  { key: 'export', group: 'Renewals', title: 'Export records', description: 'Excel or PDF of a record type', icon: FileDown, permission: 'report.view' },
  { key: 'downloads', group: 'Renewals', title: 'My downloads', description: 'Reports you generated recently', icon: Download, permission: 'report.view' },
]
const ASSET_KINDS = new Set(['inventory', 'repairs', 'maintenance', 'borrows', 'warranties', 'holders'])

/** Reports: one compact picker in the toolbar, so the report gets the full width. */
export default function Reports() {
  const has = useAuthStore((s) => s.hasPermission)
  const [sp, setSp] = useSearchParams()
  const available = REPORTS.filter((r) => has(r.permission))
  const current = available.find((r) => r.key === sp.get('report')) ?? available[0]

  if (!current) return <p className="rounded-xl border bg-white p-8 text-center text-sm text-gray-500">You don’t have access to any reports yet.</p>
  const picker = <ReportPicker reports={available} current={current} onPick={(key) => setSp({ report: key }, { replace: true })} />
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Reports</h1>
        <p className="mt-1 text-sm text-gray-500">{current.description}</p>
      </div>
      <section key={current.key} className="flex min-h-0 min-w-0 flex-1 animate-page-in flex-col gap-4">
        {ASSET_KINDS.has(current.key)
          ? <AssetReportView def={current} picker={picker} />
          : <Suspense fallback={<div className="skeleton h-64" />}><RenewalReports section={current.key as RenewalSection} picker={picker} /></Suspense>}
      </section>
    </div>
  )
}

function ReportPicker({ reports, current, onPick }: { reports: ReportDef[]; current: ReportDef; onPick: (key: string) => void }) {
  const groups = (['Assets', 'Renewals'] as const).map((g) => ({ g, items: reports.filter((r) => r.group === g) })).filter((x) => x.items.length)
  return (
    <Popover align="left" panelClassName="w-[min(34rem,calc(100vw-2rem))] p-2" trigger={
      <Button variant="outline" className="h-9 gap-2 pl-2 pr-2.5 font-medium" aria-label={`Report: ${current.title}. Change report`}>
        <span className="flex h-6 w-6 items-center justify-center rounded-md bg-primary text-primary-foreground"><current.icon className="h-3.5 w-3.5" /></span>
        <span className="max-w-[12rem] truncate">{current.title}</span>
        <ChevronDown className="h-4 w-4 text-gray-400" />
      </Button>
    }>
      {(close) => (
        <div className="grid gap-x-2 sm:grid-cols-2">
          {groups.map(({ g, items }) => (
            <div key={g}>
              <p className="px-2 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g}</p>
              {items.map((r) => {
                const active = r.key === current.key
                return (
                  <button key={r.key} onClick={() => { onPick(r.key); close() }} aria-current={active ? 'page' : undefined}
                    className={cn('flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors', active ? 'bg-primary-soft' : 'hover:bg-gray-50')}>
                    <span className={cn('mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md', active ? 'bg-primary text-primary-foreground' : 'bg-gray-100 text-gray-500')}><r.icon className="h-3.5 w-3.5" /></span>
                    <span className="min-w-0">
                      <span className={cn('block text-sm font-medium', active ? 'text-primary' : 'text-gray-800')}>{r.title}</span>
                      <span className="block text-xs text-gray-500">{r.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      )}
    </Popover>
  )
}

const RANGES = [
  { key: '30', label: 'Last 30 days' }, { key: '90', label: 'Last 90 days' }, { key: 'year', label: 'This year' },
  { key: 'next90', label: 'Next 90 days' }, { key: 'all', label: 'All time' }, { key: 'custom', label: 'Custom…' },
]
const iso = (d: Date) => d.toISOString().slice(0, 10)
function rangeDates(key: string): { from?: string; to?: string } {
  const now = new Date()
  if (key === '30' || key === '90') { const f = new Date(); f.setDate(now.getDate() - Number(key)); return { from: iso(f), to: iso(now) } }
  if (key === 'year') return { from: `${now.getFullYear()}-01-01`, to: iso(now) }
  if (key === 'next90') { const t = new Date(); t.setDate(now.getDate() + 90); return { from: iso(now), to: iso(t) } }
  return {}
}
type ColType = NonNullable<AssetReport['columns'][number]['type']>
type Row = Record<string, string | number | null> & { __i: number }

/** Per report: the column that is always shown, the default sort and the columns hidden at first. */
const SETUP: Record<AssetReportKind, { lock: string; sort: string; order: 'asc' | 'desc'; columns: string[] }> = {
  inventory: { lock: 'asset', sort: 'asset', order: 'asc', columns: ['type', 'holder', 'status', 'location', 'purchased', 'cost', 'warranty_end'] },
  repairs: { lock: 'asset', sort: 'date', order: 'desc', columns: ['date', 'type', 'issue', 'vendor', 'status', 'cost'] },
  maintenance: { lock: 'asset', sort: 'date', order: 'desc', columns: ['date', 'type', 'body', 'os', 'issues'] },
  borrows: { lock: 'item', sort: 'borrowed', order: 'desc', columns: ['serial', 'borrower', 'borrowed', 'due', 'returned', 'state'] },
  warranties: { lock: 'asset', sort: 'warranty_end', order: 'asc', columns: ['warranty_end', 'days_left', 'state', 'type', 'holder', 'location'] },
  holders: { lock: 'employee', sort: 'count', order: 'desc', columns: ['title', 'business_unit', 'count', 'value', 'items'] },
}
const FILTER_TYPE: Record<ColType, string> = { text: 'text', choice: 'select', date: 'date', money: 'currency', number: 'integer' }
const BADGE: Record<string, string> = {
  Overdue: 'bg-red-50 text-red-700', Expired: 'bg-red-50 text-red-700', 'In Progress': 'bg-amber-50 text-amber-700', 'In Repair': 'bg-amber-50 text-amber-700',
  'Within 30 days': 'bg-amber-50 text-amber-700', Out: 'bg-violet-50 text-violet-700', Borrowed: 'bg-violet-50 text-violet-700',
  Assigned: 'bg-blue-50 text-blue-700', Returned: 'bg-green-50 text-green-700', Complete: 'bg-green-50 text-green-700', Operational: 'bg-green-50 text-green-700',
  'Written-Off': 'bg-gray-100 text-gray-600', Unassigned: 'bg-gray-100 text-gray-600',
}
const dash = <span className="text-gray-300">-</span>

function cell(key: string, type: ColType, row: Row) {
  const v = row[key]
  if (v === null || v === undefined || v === '') return dash
  if (type === 'money') return formatMoney(v, (row.currency as string) || undefined)
  if (type === 'date') return <span className="tabular-nums">{formatDate(String(v))}</span>
  if (key === 'days_left') return <span className={cn('tabular-nums', Number(v) < 0 ? 'text-red-600' : Number(v) <= 30 ? 'text-amber-700' : '')}>{Number(v) < 0 ? `${-Number(v)} days ago` : `${v} days`}</span>
  if (BADGE[String(v)]) return <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', BADGE[String(v)])}>{v}</span>
  if ((key === 'asset' || key === 'item') && row.asset_id) return <Link className="font-medium text-gray-900 hover:text-primary hover:underline" to={`/assets/${row.asset_id}`}>{v}</Link>
  if (key === 'employee' && row.employee_id) return <Link className="font-medium text-gray-900 hover:text-primary hover:underline" to={`/employees/${row.employee_id}`}>{v}</Link>
  if (key === 'asset' || key === 'item' || key === 'employee') return <span className="font-medium text-gray-900">{v}</span>
  if (key === 'serial') return <span className="font-mono text-xs">{v}</span>
  return String(v)
}

function AssetReportView({ def, picker }: { def: ReportDef; picker: ReactNode }) {
  const api = useApi()
  const kind = def.key as AssetReportKind
  const setup = SETUP[kind]
  const t = useTableState({ key: `rpt-${kind}`, defaultSort: setup.sort, defaultOrder: setup.order, defaultColumns: setup.columns })
  const [period, setPeriod] = useState(kind === 'warranties' ? 'next90' : def.dated ? '90' : 'all')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [exporting, setExporting] = useState(false)
  const dates = period === 'custom' ? { from: custom.from || undefined, to: custom.to || undefined } : rangeDates(period)
  const params = def.dated ? dates : {}
  const { data, isLoading, isFetching, error } = useQuery<AssetReport>({
    queryKey: ['asset-report', kind, params], queryFn: () => api.reports.asset(kind, params), placeholderData: (p) => p,
  })

  const cols = useMemo(() => (data?.columns ?? []).map((c) => ({ ...c, type: (c.type ?? 'text') as ColType })), [data])
  const all = useMemo<Row[]>(() => (data?.rows ?? []).map((r, i) => ({ ...r, __i: i })), [data])
  // Filters come from the report's own columns; choice filters list the values present in the rows.
  const fields = useMemo(() => cols.map((c, i) => {
    const options = c.type === 'choice'
      ? [...new Set(all.map((r) => r[c.key]).filter((v) => v !== null && v !== undefined && v !== '').map(String))].sort((a, b) => a.localeCompare(b))
      : []
    return filterField(c.key, c.label, FILTER_TYPE[c.type], options, i)
  }), [cols, all])
  const columns = useMemo<Column<Row>[]>(() => cols.map((c) => ({
    id: c.key, label: c.label, sort: c.key, locked: c.key === setup.lock,
    align: c.type === 'money' || c.type === 'number' ? 'right' : undefined,
    className: c.type === 'text' && !['asset', 'item', 'employee', 'serial'].includes(c.key) ? 'max-w-[18rem] truncate' : undefined,
    render: (r: Row) => cell(c.key, c.type, r),
  })), [cols, setup.lock])
  const sorts = useMemo<SortDef[]>(() => cols.map((c) => ({ id: c.key, label: c.label, kind: c.type === 'date' ? 'date' : c.type === 'money' || c.type === 'number' ? 'number' : 'text' })), [cols])

  const view = clientRows(all, { search: t.search, filters: t.filters, sort: t.sort, order: t.order, page: t.page, pageSize: t.pageSize },
    fields, (r, k) => r[k], (r) => cols.map((c) => r[c.key] ?? '').join(' '))
  const visibleKeys = cols.filter((c) => c.key === setup.lock || t.columns.includes(c.key)).map((c) => c.key)
  const filtered = !!t.search || Object.keys(t.filters).length > 0

  // The server applies the same search, filters, sort and columns, so the CSV holds what is on screen.
  const exportCsv = async () => {
    setExporting(true)
    try {
      const hasFilters = Object.keys(t.filters).length > 0
      const blob = await api.reports.assetCsv(kind, {
        ...params, search: t.search || undefined, filters: hasFilters ? JSON.stringify(t.filters) : undefined,
        sort: t.sort, order: t.order, columns: visibleKeys.join(','),
      })
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${kind}-${iso(new Date())}.csv` })
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch (e) { toast.error(errorMessage(e)) } finally { setExporting(false) }
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {picker}
        {def.dated && (
          <Select className="w-40" value={period} onChange={(e) => { setPeriod(e.target.value); t.setPage(1) }} aria-label="Period">
            {RANGES.filter((r) => kind === 'warranties' || r.key !== 'next90').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
        )}
        {def.dated && period === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" className="h-9 w-40" value={custom.from} onChange={(e) => { setCustom({ ...custom, from: e.target.value }); t.setPage(1) }} aria-label="From" />
            <span className="text-gray-400">to</span>
            <Input type="date" className="h-9 w-40" value={custom.to} onChange={(e) => { setCustom({ ...custom, to: e.target.value }); t.setPage(1) }} aria-label="To" />
          </div>
        )}
        <Button variant="outline" size="sm" className="ml-auto" disabled={!view.total || exporting} onClick={exportCsv}
          title={filtered ? 'Export the rows that match the current filters' : 'Export every row in this report'}>
          <Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">{exporting ? 'Preparing…' : filtered ? `CSV (${view.total})` : 'CSV'}</span>
        </Button>
      </div>

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {(data?.summary ?? [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]).map((s, i) => (
          <div key={i} className={cn('rounded-xl border bg-white px-3.5 py-2.5 shadow-soft', !data && 'skeleton h-14 border-0')}>
            {data && <><p className="truncate text-xs text-gray-500">{s.label}</p><p className="truncate text-lg font-semibold tabular-nums text-gray-900">{typeof s.value === 'number' && /cost|value/i.test(s.label) ? formatMoney(s.value) : s.value}</p></>}
          </div>
        ))}
      </div>

      <TableToolbar state={t} searchPlaceholder={`Search ${def.title.toLowerCase()}…`} filterFields={fields} sorts={sorts} columns={columns} />

      <DataTable rows={view.rows} rowKey={(r) => r.__i} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null}
        empty={<EmptyRows icon={<CalendarClock className="h-9 w-9" />} title="Nothing to show" hint={filtered ? 'Clear the search or filters.' : def.dated ? 'Try a wider period.' : undefined} />}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'rows' }} />
      {data?.truncated && <p className="shrink-0 text-xs text-amber-700">Showing the first 5,000 rows. Narrow the period for a complete view.</p>}
    </>
  )
}
