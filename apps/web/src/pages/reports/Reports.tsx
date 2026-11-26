import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import {
  ArrowDownUp, BarChart3, Boxes, CalendarClock, ClipboardCheck, Download, FileDown, Handshake, Laptop, Search,
  ShieldCheck, TrendingUp, Users, Wrench,
} from 'lucide-react'
import { errorMessage, formatDate, formatMoney, useApi, useReference, type AssetReport, type AssetReportKind } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
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

/** Reports hub: pick a report on the left, see it on the right. */
export default function Reports() {
  const has = useAuthStore((s) => s.hasPermission)
  const [sp, setSp] = useSearchParams()
  const available = REPORTS.filter((r) => has(r.permission))
  const current = available.find((r) => r.key === sp.get('report')) ?? available[0]
  const groups = (['Assets', 'Renewals'] as const).map((g) => ({ g, items: available.filter((r) => r.group === g) })).filter((x) => x.items.length)

  if (!current) return <p className="rounded-xl border bg-white p-8 text-center text-sm text-gray-500">You don’t have access to any reports yet.</p>
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Reports</h1>
        <p className="mt-1 text-sm text-gray-500">Pick a report. Filter it, sort any column, and download it as CSV.</p>
      </div>
      <div className="grid gap-5 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Reports" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:block lg:space-y-5 lg:overflow-visible lg:px-0">
          {groups.map(({ g, items }) => (
            <div key={g} className="contents lg:block lg:space-y-1">
              <p className="hidden px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 lg:block">{g}</p>
              {items.map((r) => {
                const active = r.key === current.key
                return (
                  <button key={r.key} onClick={() => setSp({ report: r.key }, { replace: true })} aria-current={active ? 'page' : undefined}
                    className={cn('press flex shrink-0 items-center gap-3 rounded-xl border px-3 py-2.5 text-left lg:w-full',
                      active ? 'border-primary/30 bg-primary-soft' : 'bg-white hover:bg-gray-50 lg:border-transparent lg:bg-transparent')}>
                    <span className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-lg', active ? 'bg-primary text-primary-foreground' : 'bg-gray-100 text-gray-500')}><r.icon className="h-4 w-4" /></span>
                    <span className="min-w-0">
                      <span className={cn('block whitespace-nowrap text-sm font-medium lg:whitespace-normal', active ? 'text-primary' : 'text-gray-800')}>{r.title}</span>
                      <span className="hidden text-xs text-gray-500 lg:block">{r.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ))}
        </nav>
        <section key={current.key} className="min-w-0 animate-page-in space-y-4">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-gradient text-primary-foreground"><current.icon className="h-5 w-5" /></span>
            <div><h2 className="text-lg font-semibold text-gray-900">{current.title}</h2><p className="text-sm text-gray-500">{current.description}</p></div>
          </div>
          {ASSET_KINDS.has(current.key)
            ? <AssetReportView def={current} />
            : <Suspense fallback={<div className="skeleton h-64" />}><RenewalReports section={current.key as RenewalSection} /></Suspense>}
        </section>
      </div>
    </div>
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

function AssetReportView({ def }: { def: ReportDef }) {
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
      <div className="flex flex-wrap items-center gap-2">
        <form className="relative w-full sm:w-64" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()) }}>
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
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {(data?.summary ?? [{ label: '', value: '' }, { label: '', value: '' }, { label: '', value: '' }]).map((s, i) => (
          <div key={i} className={cn('rounded-xl border bg-white p-4 shadow-soft', !data && 'skeleton h-20 border-0')}>
            {data && <><p className="text-xs text-gray-500">{s.label}</p><p className="mt-1 truncate text-xl font-semibold text-gray-900">{typeof s.value === 'number' && /cost|value/i.test(s.label) ? formatMoney(s.value) : s.value}</p></>}
          </div>
        ))}
      </div>

      <TableCard footer={<TablePager shown={shown.length} total={rows.length} noun="rows" page={page} pages={pages} onPage={setPage} pageSize={pageSize} onPageSize={(n) => { setPageSize(n); setPage(1) }} />}>
        <TableScrollArea className="max-h-[60vh]">
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
