import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { CalendarClock, Download } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { useAuthStore } from '../store/auth'
import type { RecordType } from '../types'
import { downloadCsv } from '@/components/ReportDownloads'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, clientRows, filterField, useTableState, type Column, type SortDef,
} from '@/components/data-table'

interface MoneyGroup {
  currency: string | null
  amount: string | null
  renewals: number
  unpriced_renewals: number
}
type Item = {
  record_id: number; name: string; type_name: string; type_slug: string; renewal_date: string
  amount: string | null; currency: string | null; business_unit: string | null
  vendor: string | null; cycle: string | null; projected: boolean
}
interface Forecast {
  start: string
  end: string
  as_of: string
  total: number
  total_pages: number
  summary: { records: number; renewals: number; unpriced_renewals: number; projected_renewals: number }
  coverage: { overdue_records: number; missing_date_records: number; one_time_records: number; single_date_records: number }
  currencies: MoneyGroup[]
  monthly: (MoneyGroup & { month: string })[]
  business_units: (MoneyGroup & { business_unit: string | null })[]
  options: { business_units: string[]; currencies: string[]; vendors: string[] }
  items: Item[]
}
type GroupRow = MoneyGroup & { id: string; month?: string; business_unit?: string | null }

// The API sends decimal strings; preserve cents instead of doing float arithmetic.
function money(value: string | null) {
  if (value === null) return 'Unknown'
  const neg = value.startsWith('-')
  const [whole, fraction = ''] = value.replace('-', '').split('.')
  return `${neg ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`
}
/** Exact sum of decimal strings. */
function addDecimals(values: string[]): string | null {
  if (!values.length) return null
  const scale = Math.max(0, ...values.map((v) => (v.split('.')[1] ?? '').length))
  let total = BigInt(0)
  for (const v of values) {
    const neg = v.startsWith('-')
    const [w, f = ''] = v.replace('-', '').split('.')
    const n = BigInt((w || '0') + f.padEnd(scale, '0'))
    total += neg ? -n : n
  }
  const neg = total < BigInt(0)
  const digits = (neg ? -total : total).toString().padStart(scale + 1, '0')
  return (neg ? '-' : '') + (scale ? `${digits.slice(0, -scale)}.${digits.slice(-scale)}` : digits)
}
function group(items: Item[], key: (i: Item) => (string | null)[]): GroupRow[] {
  const map = new Map<string, { parts: (string | null)[]; items: Item[] }>()
  for (const i of items) {
    const parts = key(i), id = JSON.stringify(parts)
    const g = map.get(id) ?? { parts, items: [] }
    g.items.push(i); map.set(id, g)
  }
  return [...map.entries()].map(([id, g]) => {
    const currency = g.parts[g.parts.length - 1]
    return {
      id, currency, renewals: g.items.length,
      unpriced_renewals: g.items.filter((i) => i.amount === null || i.currency === null).length,
      amount: addDecimals(g.items.filter((i) => i.amount !== null && i.currency !== null).map((i) => i.amount!)),
      ...(g.parts.length === 3 ? { month: g.parts[0]! } : { business_unit: g.parts[0] }),
    } as GroupRow
  })
}

const PAGE = 100
const MAX_PAGES = 20
const basis = (i: Item) => (i.projected ? 'Cycle projection' : 'Next expiry')
const itemValue = (i: Item, k: string): unknown => {
  switch (k) {
    case 'business_unit': return i.business_unit || 'Unassigned'
    case 'vendor': return i.vendor || 'Unspecified'
    case 'currency': return i.currency || 'Unspecified'
    case 'basis': return basis(i)
    case 'cycle': return i.cycle || 'Cycle not set'
    case 'amount': return i.amount === null ? null : Number(i.amount)
    default: return (i as unknown as Record<string, unknown>)[k]
  }
}
const groupValue = (r: GroupRow, k: string): unknown => (k === 'amount' ? (r.amount === null ? null : Number(r.amount)) : (r as unknown as Record<string, unknown>)[k])
const amountCell = (r: MoneyGroup) => (
  <span className="tabular-nums">{money(r.amount)}{r.unpriced_renewals > 0 && <span className="ml-2 text-xs text-amber-700">{r.unpriced_renewals} unpriced</span>}</span>
)

const MONTH_COLUMNS: Column<GroupRow>[] = [
  { id: 'month', label: 'Month', sort: 'month', locked: true, render: (r) => <span className="font-medium tabular-nums text-gray-900">{r.month}</span> },
  { id: 'g_currency', label: 'Currency', sort: 'currency', render: (r) => r.currency || 'Unspecified' },
  { id: 'g_amount', label: 'Known amount', sort: 'amount', align: 'right', render: amountCell },
  { id: 'g_renewals', label: 'Renewals', sort: 'renewals', align: 'right', render: (r) => r.renewals.toLocaleString() },
]
const UNIT_COLUMNS: Column<GroupRow>[] = [
  { id: 'unit', label: 'Business unit', sort: 'business_unit', locked: true, render: (r) => <span className="font-medium text-gray-900">{r.business_unit || 'Unassigned'}</span> },
  ...MONTH_COLUMNS.slice(1),
]
const GROUP_SORTS = (first: SortDef): SortDef[] => [first, { id: 'currency', label: 'Currency' }, { id: 'amount', label: 'Known amount', kind: 'number' }, { id: 'renewals', label: 'Renewals', kind: 'number' }]
const ITEM_SORTS: SortDef[] = [
  { id: 'renewal_date', label: 'Renewal date', kind: 'date' }, { id: 'name', label: 'Record' }, { id: 'type_name', label: 'Record type' },
  { id: 'business_unit', label: 'Business unit' }, { id: 'vendor', label: 'Vendor' }, { id: 'amount', label: 'Estimate', kind: 'number' },
]
const TAB_SORT: Record<string, [string, 'asc' | 'desc']> = { renewals: ['renewal_date', 'asc'], months: ['month', 'asc'], units: ['amount', 'desc'] }

export default function RenewalForecast({ recordTypes, picker }: { recordTypes: RecordType[]; picker?: ReactNode }) {
  const { hasPermission, user } = useAuthStore()
  const canLink = hasPermission('record.view')
  const [months, setMonths] = useState(12)
  const [start, setStart] = useState('')
  const [repeat, setRepeat] = useState(true)
  const t = useTableState({ key: 'rpt-forecast', defaultSort: 'renewal_date', defaultTab: 'renewals',
    defaultColumns: ['renewal_date', 'type_name', 'business_unit', 'vendor', 'amount', 'basis', 'g_currency', 'g_amount', 'g_renewals'] })
  const params = { months, start: start || undefined, repeat_cycles: repeat }

  // The whole forecast (up to 2,000 renewals) loads at once so search, filters, sort and totals work together.
  const { data, error, isPending, isFetching } = useQuery({
    queryKey: ['renewal-forecast-all', user?.id, params],
    queryFn: async () => {
      const get = async (page: number) => (await api.get('/reports/forecast', { params: { ...params, page, page_size: PAGE } })).data as Forecast
      const first = await get(1)
      const pages = Math.min(MAX_PAGES, first.total_pages)
      const rest = await Promise.all(Array.from({ length: Math.max(0, pages - 1) }, (_, i) => get(i + 2).then((r) => r.items)))
      return { ...first, items: [...first.items, ...rest.flat()], truncated: first.total_pages > pages }
    },
    placeholderData: (previous) => previous,
    enabled: !!user,
    retry: false,
  })

  const items = useMemo(() => data?.items ?? [], [data])
  const fields = useMemo(() => {
    const uniq = (vals: (string | null | undefined)[]) => [...new Set(vals.filter((v): v is string => !!v))].sort((a, b) => a.localeCompare(b))
    return [
      filterField('type_name', 'Record type', 'select', uniq([...recordTypes.filter((x) => x.active).map((x) => x.name), ...items.map((i) => i.type_name)])),
      filterField('business_unit', 'Business unit', 'select', uniq(['Unassigned', ...(data?.options.business_units ?? [])])),
      filterField('vendor', 'Vendor / provider', 'select', uniq(['Unspecified', ...(data?.options.vendors ?? [])])),
      filterField('currency', 'Currency', 'select', uniq(['Unspecified', ...(data?.options.currencies ?? [])])),
      filterField('renewal_date', 'Renewal date', 'date'),
      filterField('amount', 'Estimate', 'currency'),
      filterField('basis', 'Basis', 'select', ['Next expiry', 'Cycle projection']),
      filterField('cycle', 'Billing cycle', 'select', uniq(items.map((i) => i.cycle || 'Cycle not set'))),
      filterField('name', 'Record name', 'text'),
    ]
  }, [recordTypes, items, data])

  const state = { search: t.search, filters: t.filters, sort: t.sort, order: t.order, page: t.page, pageSize: t.pageSize }
  const searchText = (i: Item) => [i.name, i.type_name, i.business_unit, i.vendor, i.currency, i.cycle].join(' ')
  const matching = useMemo(() => clientRows(items, { ...state, sort: 'renewal_date', order: 'asc', page: 1, pageSize: 1 }, fields, itemValue, searchText).all,
    [items, fields, t.search, t.filters]) // eslint-disable-line react-hooks/exhaustive-deps
  const filtered = !!t.search || Object.keys(t.filters).length > 0
  // Totals follow the filters; with a partial load and no filters, the server's totals cover everything.
  const useServer = !!data?.truncated && !filtered
  const totals = useMemo(() => ({
    currencies: useServer ? data!.currencies.map((r) => ({ ...r, id: r.currency ?? '' })) : group(matching, (i) => [i.currency]),
    monthly: useServer ? data!.monthly.map((r) => ({ ...r, id: `${r.month}-${r.currency}` })) : group(matching, (i) => [i.renewal_date.slice(0, 7), 'm', i.currency]),
    units: useServer ? data!.business_units.map((r) => ({ ...r, id: JSON.stringify([r.business_unit, r.currency]) })) : group(matching, (i) => [i.business_unit, i.currency]),
  }), [useServer, data, matching])
  const renewalCount = useServer ? data!.summary.renewals : matching.length
  const unpriced = useServer ? data!.summary.unpriced_renewals : matching.filter((i) => i.amount === null || i.currency === null).length

  const itemColumns = useMemo<Column<Item>[]>(() => [
    { id: 'renewal_date', label: 'Date', sort: 'renewal_date', render: (r) => <span className="tabular-nums">{r.renewal_date}</span> },
    { id: 'name', label: 'Record', sort: 'name', locked: true, render: (r) => canLink
      ? <Link className="font-medium text-gray-900 hover:text-primary hover:underline" to={`/records/${r.type_slug}/${r.record_id}`}>{r.name}</Link>
      : <span className="font-medium text-gray-900">{r.name}</span> },
    { id: 'type_name', label: 'Type', sort: 'type_name', render: (r) => r.type_name },
    { id: 'business_unit', label: 'Business unit', sort: 'business_unit', render: (r) => r.business_unit || <span className="text-gray-400">Unassigned</span> },
    { id: 'vendor', label: 'Vendor', sort: 'vendor', render: (r) => r.vendor || <span className="text-gray-400">Unspecified</span> },
    { id: 'amount', label: 'Estimate', sort: 'amount', align: 'right', render: (r) => (
      <span className="tabular-nums">{money(r.amount)} {r.currency || <span className="text-amber-700">(currency missing)</span>}</span>) },
    { id: 'basis', label: 'Basis', sort: 'basis', render: (r) => <span className="text-xs text-gray-500">{basis(r)} · {r.cycle || 'Cycle not set'}</span> },
  ], [canLink])

  const tab = t.tab in TAB_SORT ? t.tab : 'renewals'
  const itemView = clientRows(items, state, fields, itemValue, searchText)
  const groupRows = tab === 'months' ? totals.monthly : totals.units
  const groupView = clientRows(groupRows, { ...state, search: '', filters: {} }, [], groupValue)

  const exportCsv = async () => {
    if (tab === 'renewals') {
      downloadCsv('renewal-forecast', ['Date', 'Record', 'Type', 'Business unit', 'Vendor', 'Estimate', 'Currency', 'Basis', 'Cycle'],
        itemView.all.map((r) => [r.renewal_date, r.name, r.type_name, r.business_unit || '', r.vendor || '', r.amount ?? '', r.currency || '', basis(r), r.cycle || '']))
      return
    }
    const first = tab === 'months' ? 'Month' : 'Business unit'
    downloadCsv(tab === 'months' ? 'forecast-by-month' : 'forecast-by-unit', [first, 'Currency', 'Known amount', 'Renewals', 'Unpriced renewals'],
      groupView.all.map((r) => [tab === 'months' ? r.month : r.business_unit || 'Unassigned', r.currency || 'Unspecified', r.amount ?? '', r.renewals, r.unpriced_renewals]))
  }

  const errMsg = (error as any)?.response?.data?.error?.message || (error ? 'Could not load the forecast.' : '')
  return (
    <>
      <div className="flex shrink-0 flex-wrap items-center gap-2" aria-busy={isFetching}>
        {picker}
        <Input aria-label="Forecast from (blank is today)" title="From (blank is today)" type="date" className="h-9 w-40" value={start} onChange={(e) => { setStart(e.target.value); t.setPage(1) }} />
        <Select aria-label="Forecast months" className="w-32" value={months} onChange={(e) => { setMonths(Number(e.target.value)); t.setPage(1) }}>
          {[3, 6, 12, 24].map((n) => <option key={n} value={n}>{n} months</option>)}
        </Select>
        <label className="flex items-center gap-2 whitespace-nowrap text-sm text-gray-600" title="Repeat known billing cycles at the current cost">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={repeat} onChange={(e) => { setRepeat(e.target.checked); t.setPage(1) }} />Repeat cycles
        </label>
        {hasPermission('report.export') && <Button variant="outline" size="sm" className="ml-auto" onClick={exportCsv} disabled={!data || isFetching}
          title={filtered ? 'Export the rows that match the current filters' : 'Export this tab'}>
          <Download className="h-4 w-4 sm:mr-1.5" /><span className="hidden sm:inline">CSV</span>
        </Button>}
      </div>

      {errMsg && <p role="alert" className="shrink-0 rounded-md bg-red-50 p-3 text-sm text-red-700">{errMsg}</p>}

      <div className="grid shrink-0 grid-cols-2 gap-2 sm:grid-cols-4">
        {!data ? [0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-16 rounded-xl" />) : <>
          <div className="rounded-xl border bg-white px-3.5 py-2.5 shadow-soft">
            <p className="truncate text-xs text-gray-500">Estimated renewals</p>
            <p className="truncate text-lg font-semibold tabular-nums text-gray-900">{renewalCount.toLocaleString()}</p>
            <p className="truncate text-xs text-gray-500">{data.start} to {data.end}</p>
          </div>
          {totals.currencies.slice(0, 3).map((r) => (
            <div key={r.id} className="rounded-xl border bg-white px-3.5 py-2.5 shadow-soft">
              <p className="truncate text-xs text-gray-500">{r.currency || 'Unspecified currency'} · known estimate</p>
              <p className="truncate text-lg font-semibold tabular-nums text-gray-900">{money(r.amount)}</p>
              <p className="truncate text-xs text-gray-500">{r.renewals.toLocaleString()} renewals{r.unpriced_renewals ? ` · ${r.unpriced_renewals} unpriced` : ''}</p>
            </div>
          ))}
        </>}
      </div>

      {data && (
        <details className="shrink-0 rounded-lg border bg-white px-3 py-2 text-xs text-gray-600">
          <summary className="cursor-pointer select-none">
            {unpriced > 0 && <span className="mr-2 font-medium text-amber-700">{unpriced.toLocaleString()} renewals have no price or currency, so totals include known amounts only.</span>}
            How this estimate is calculated
          </summary>
          <div className="mt-2 space-y-1.5">
            <p>Only active, unarchived records are included. The configured expiry date is used, not a promised payment date. Cost is the stored price per renewal; prices, seat counts and business units are assumed unchanged.</p>
            <p>{repeat ? 'Known billing cycles repeat at the current stored price, even when auto-renew is off.' : 'Only the next renewal is included.'} Unknown cycles appear once. Each currency stays separate; no exchange rates are applied.</p>
            <p>Outside this estimate: {data.coverage.overdue_records} overdue records, {data.coverage.missing_date_records} without a valid date, {data.coverage.one_time_records} one-time purchases. {data.coverage.single_date_records} records have no known repeat cycle.</p>
          </div>
        </details>
      )}

      <TableTabs tabs={[
        { id: 'renewals', label: 'Renewals', count: data ? itemView.total : null },
        { id: 'months', label: 'By month', count: data ? totals.monthly.length : null },
        { id: 'units', label: 'By business unit', count: data ? totals.units.length : null },
      ]} value={tab} onChange={(id) => { t.setTab(id); t.setSort(TAB_SORT[id][0], TAB_SORT[id][1]) }} />
      <TableToolbar state={t} searchPlaceholder="Record, type, unit, vendor…" filterFields={fields}
        sorts={tab === 'renewals' ? ITEM_SORTS : GROUP_SORTS(tab === 'months' ? { id: 'month', label: 'Month', kind: 'date' } : { id: 'business_unit', label: 'Business unit' })}
        columns={tab === 'renewals' ? itemColumns : tab === 'months' ? MONTH_COLUMNS : UNIT_COLUMNS} />
      {tab === 'renewals'
        ? <DataTable rows={itemView.rows} rowKey={(r) => `${r.record_id}-${r.renewal_date}`} columns={itemColumns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
            loading={isPending} fetching={isFetching} rowClassName={(r) => r.projected && 'text-gray-500'}
            empty={<EmptyRows icon={<CalendarClock className="h-9 w-9" />} title="No renewals" hint={filtered ? 'Clear the search or filters.' : 'No renewals fall in this forecast window.'} />}
            pager={{ page: t.page, pages: itemView.pages, total: itemView.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'renewals' }} />
        : <DataTable rows={groupView.rows} rowKey={(r) => r.id} columns={tab === 'months' ? MONTH_COLUMNS : UNIT_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
            loading={isPending} fetching={isFetching}
            empty={<EmptyRows icon={<CalendarClock className="h-9 w-9" />} title="No totals" hint={filtered ? 'Clear the search or filters.' : undefined} />}
            pager={{ page: t.page, pages: groupView.pages, total: groupView.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: tab === 'months' ? 'months' : 'units' }} />}
      {data?.truncated && <p className="shrink-0 text-xs text-amber-700">Showing the first {(PAGE * MAX_PAGES).toLocaleString()} renewals, so search and filters only cover those. Shorten the window for a complete view.</p>}
    </>
  )
}
