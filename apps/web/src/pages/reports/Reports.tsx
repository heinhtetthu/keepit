import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownUp, BarChart3, Boxes, CalendarClock, ChevronDown, ClipboardCheck, Download, FileDown, Handshake, Laptop, Search,
  ShieldCheck, TrendingUp, Users, Wrench,
} from 'lucide-react'
import { errorMessage, formatDate, formatMoney, useApi, useReference, type AssetReport, type AssetReportKind } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Popover from '@/components/ui/popover'
import { toast } from '@/components/ui/toaster'
import { TableCard, TableScrollArea, TH_STICKY, TablePager, usePageSize } from '@/components/table_shell'
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
          : <>
            <div className="flex shrink-0 flex-wrap items-center gap-2">{picker}</div>
            <Suspense fallback={<div className="skeleton h-64" />}><RenewalReports section={current.key as RenewalSection} /></Suspense>
          </>}
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
const MONEY_KEYS = new Set(['cost', 'value'])
const DATE_KEYS = new Set(['date', 'purchased', 'warranty_end', 'borrowed', 'due', 'returned'])
const BADGE: Record<string, string> = {
  Overdue: 'bg-red-50 text-red-700', Expired: 'bg-red-50 text-red-700', 'In Progress': 'bg-amber-50 text-amber-700', 'In Repair': 'bg-amber-50 text-amber-700',
  'Within 30 days': 'bg-amber-50 text-amber-700', Out: 'bg-violet-50 text-violet-700', Borrowed: 'bg-violet-50 text-violet-700',
  Assigned: 'bg-blue-50 text-blue-700', Returned: 'bg-green-50 text-green-700', Complete: 'bg-green-50 text-green-700', Operational: 'bg-green-50 text-green-700',
  'Written-Off': 'bg-gray-100 text-gray-600', Unassigned: 'bg-gray-100 text-gray-600',
}

function AssetReportView({ def, picker }: { def: ReportDef; picker: ReactNode }) {
  const api = useApi()
  const { data: ref } = useReference()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [type, setType] = useState('')
  const [range, setRange] = useState(def.key === 'warranties' ? 'next90' : def.dated ? '90' : 'all')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('report-page-size', 25)
  const dates = range === 'custom' ? { from: custom.from || undefined, to: custom.to || undefined } : rangeDates(range)
  const params = { q: search || undefined, asset_type: type || undefined, ...(def.dated ? dates : {}) }
  const { data, isLoading, isFetching, error } = useQuery<AssetReport>({
    queryKey: ['asset-report', def.key, params], queryFn: () => api.reports.asset(def.key as AssetReportKind, params), placeholderData: (p) => p,
  })
  useEffect(() => setPage(1), [def.key, search, type, range, custom.from, custom.to])

  const rows = useMemo(() => {
    const all = data?.rows ?? []
    if (!sort) return all
    return [...all].sort((a, b) => {
      const x = a[sort.key], y = b[sort.key]
      if (x === y) return 0
      if (x === null || x === undefined) return 1
      if (y === null || y === undefined) return -1
      return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir
    })
  }, [data, sort])
  const pages = Math.max(1, Math.ceil(rows.length / pageSize))
  const shown = rows.slice((page - 1) * pageSize, page * pageSize)

  const exportCsv = async () => {
    try {
      const blob = await api.reports.assetCsv(def.key as AssetReportKind, params)
      const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${def.key}-${iso(new Date())}.csv` })
      a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const cell = (key: string, v: string | number | null | undefined, row: Record<string, unknown>) => {
    if (v === null || v === undefined || v === '') return <span className="text-gray-300">—</span>
    if (MONEY_KEYS.has(key)) return formatMoney(v, (row.currency as string) || undefined)
    if (DATE_KEYS.has(key)) return formatDate(String(v))
    if (key === 'days_left') return <span className={Number(v) < 0 ? 'text-red-600' : Number(v) <= 30 ? 'text-amber-700' : ''}>{Number(v) < 0 ? `${-Number(v)} days ago` : `${v} days`}</span>
    if (BADGE[String(v)]) return <span className={cn('inline-flex rounded-full px-2 py-0.5 text-xs font-medium', BADGE[String(v)])}>{v}</span>
    if ((key === 'asset' || key === 'item') && row.asset_id) return <Link className="font-medium text-gray-900 hover:text-primary hover:underline" to={`/assets/${row.asset_id}`}>{v}</Link>
    if (key === 'employee' && row.employee_id) return <Link className="font-medium text-gray-900 hover:text-primary hover:underline" to={`/employees/${row.employee_id}`}>{v}</Link>
    return String(v)
  }

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {picker}
        <form className="relative w-full sm:w-56" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()) }}>
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setSearch(q.trim())} />
        </form>
        {def.key !== 'borrows' && (
          <Select className="w-40" value={type} onChange={(e) => setType(e.target.value)} aria-label="Asset type">
            <option value="">All types</option>{(ref?.asset_type ?? []).map((t) => <option key={t.id}>{t.name}</option>)}
          </Select>
        )}
        {def.dated && (
          <Select className="w-40" value={range} onChange={(e) => setRange(e.target.value)} aria-label="Period">
            {RANGES.filter((r) => def.key === 'warranties' || r.key !== 'next90').map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
          </Select>
        )}
        {def.dated && range === 'custom' && (
          <div className="flex items-center gap-2">
            <Input type="date" className="w-40" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} aria-label="From" />
            <span className="text-gray-400">→</span>
            <Input type="date" className="w-40" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} aria-label="To" />
          </div>
        )}
        <Button variant="outline" size="sm" className="ml-auto" disabled={!rows.length} onClick={exportCsv}><Download className="h-4 w-4" />CSV</Button>
      </div>

      {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{errorMessage(error)}</p>}
      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {(data?.summary ?? [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]).map((s, i) => (
          <div key={i} className={cn('rounded-xl border bg-white px-3.5 py-2.5 shadow-soft', !data && 'skeleton h-14 border-0')}>
            {data && <><p className="text-xs text-gray-500">{s.label}</p><p className="truncate text-lg font-semibold tabular-nums text-gray-900">{typeof s.value === 'number' && /cost|value/i.test(s.label) ? formatMoney(s.value) : s.value}</p></>}
          </div>
        ))}
      </div>

      <TableCard className="min-h-[18rem] flex-1" footer={<TablePager shown={shown.length} total={rows.length} noun="rows" page={page} pages={pages} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1) }} />}>
        <TableScrollArea className="flex-1">
          {isLoading ? <div className="space-y-2 p-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-8" />)}</div> : !rows.length ? (
            <div className="flex flex-col items-center gap-2 py-14 text-center"><CalendarClock className="h-9 w-9 text-gray-300" /><p className="text-sm font-medium text-gray-700">Nothing to show</p><p className="text-sm text-gray-500">Try a wider period or clear the filters.</p></div>
          ) : (
            <table className={cn('w-full text-sm transition-opacity', isFetching && 'opacity-60')}>
              <thead><tr>{data!.columns.map((c) => (
                <th key={c.key} className={cn(TH_STICKY, 'whitespace-nowrap px-3 py-2 text-left font-medium text-gray-500')}>
                  <button className="inline-flex items-center gap-1 hover:text-gray-900" onClick={() => setSort((s) => s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 })}>
                    {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : <ArrowDownUp className="h-3 w-3 opacity-30" />}
                  </button>
                </th>
              ))}</tr></thead>
              <tbody className="divide-y">{shown.map((r, i) => (
                <tr key={i} className="transition-colors hover:bg-gray-50">{data!.columns.map((c) => <td key={c.key} className="max-w-[18rem] truncate px-3 py-2 text-gray-700">{cell(c.key, r[c.key], r)}</td>)}</tr>
              ))}</tbody>
            </table>
          )}
        </TableScrollArea>
      </TableCard>
      {data?.truncated && <p className="text-xs text-amber-700">Showing the first 5,000 rows. Narrow the filters for a complete view.</p>}
    </>
  )
}
