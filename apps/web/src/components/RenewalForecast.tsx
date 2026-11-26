import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAuthStore } from '../store/auth'
import type { RecordType } from '../types'
import { Select } from '@/components/ui/select'

interface MoneyGroup {
  currency: string | null
  amount: string | null
  renewals: number
  unpriced_renewals: number
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
  items: {
    record_id: number; name: string; type_name: string; type_slug: string; renewal_date: string
    amount: string | null; currency: string | null; business_unit: string | null
    vendor: string | null; cycle: string | null; projected: boolean
  }[]
}

// The API sends decimal strings; preserve cents instead of doing float arithmetic.
function money(value: string | null) {
  if (value === null) return 'Unknown'
  const [whole, fraction = ''] = value.split('.')
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${fraction.padEnd(2, '0').slice(0, 2)}`
}
const ALL = '__all__'
const inputClass = 'h-10 w-full rounded-md border bg-background px-3 text-sm'
const thClass = 'sticky top-0 bg-gray-50 px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap'
const tdClass = 'px-3 py-2 text-sm'

export default function RenewalForecast({ recordTypes }: { recordTypes: RecordType[] }) {
  const { hasPermission, user } = useAuthStore()
  const [months, setMonths] = useState(12)
  const [start, setStart] = useState('')
  const [type, setType] = useState(ALL)
  const [unit, setUnit] = useState(ALL)
  const [currency, setCurrency] = useState(ALL)
  const [vendor, setVendor] = useState(ALL)
  const [repeat, setRepeat] = useState(true)
  const [page, setPage] = useState(1)
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const params = {
    months, start: start || undefined, repeat_cycles: repeat,
    record_type_id: type === ALL ? undefined : Number(type),
    business_unit: unit === ALL ? undefined : unit,
    currency: currency === ALL ? undefined : currency,
    vendor: vendor === ALL ? undefined : vendor,
  }
  const { data, error, isPending, isFetching } = useQuery<Forecast>({
    queryKey: ['renewal-forecast', user?.id, params, page],
    queryFn: async () => (await api.get('/reports/forecast', { params: { ...params, page, page_size: 25 } })).data,
    placeholderData: previous => previous,
    enabled: !!user,
    retry: false,
  })

  const download = async () => {
    setExporting(true)
    setExportError('')
    try {
      const response = await api.get('/reports/forecast.csv', { params, responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `renewal_forecast_${data?.start}_${data?.end}.csv`
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    } catch {
      setExportError('Could not export the forecast. Please try again.')
    } finally { setExporting(false) }
  }

  return (
    <Card aria-busy={isFetching}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Renewal forecast</CardTitle>
          {hasPermission('report.export') && <Button size="sm" variant="outline" onClick={download} disabled={!data || isFetching || exporting}>
            {exporting ? 'Preparing…' : 'Export forecast CSV'}
          </Button>}
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-gray-500">
          Plan renewal costs by month and business unit. Each currency stays separate; no exchange rates are applied.
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="space-y-1 text-xs font-medium text-gray-500">From (blank = today)
            <input aria-label="Forecast from" type="date" className={inputClass} value={start} onChange={e => { setStart(e.target.value); setPage(1) }} />
          </label>
          <label className="space-y-1 text-xs font-medium text-gray-500">Calendar months
            <Select aria-label="Forecast months" className={inputClass} value={months} onChange={e => { setMonths(Number(e.target.value)); setPage(1) }}>
              {[3, 6, 12, 24].map(n => <option key={n} value={n}>{n} months</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium text-gray-500">Record type
            <Select aria-label="Forecast record type" className={inputClass} value={type} onChange={e => {
              setType(e.target.value); setUnit(ALL); setCurrency(ALL); setVendor(ALL); setPage(1)
            }}>
              <option value={ALL}>All accessible types</option>
              {recordTypes.filter(t => t.active).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium text-gray-500">Business unit
            <Select aria-label="Forecast business unit" className={inputClass} value={unit} onChange={e => { setUnit(e.target.value); setPage(1) }}>
              <option value={ALL}>All business units</option><option value="">Unassigned</option>
              {(data?.options.business_units || []).map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium text-gray-500">Currency
            <Select aria-label="Forecast currency" className={inputClass} value={currency} onChange={e => { setCurrency(e.target.value); setPage(1) }}>
              <option value={ALL}>All currencies</option><option value="">Unspecified</option>
              {(data?.options.currencies || []).map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          </label>
          <label className="space-y-1 text-xs font-medium text-gray-500">Vendor / provider
            <Select aria-label="Forecast vendor" className={inputClass} value={vendor} onChange={e => { setVendor(e.target.value); setPage(1) }}>
              <option value={ALL}>All vendors</option><option value="">Unspecified</option>
              {(data?.options.vendors || []).map(v => <option key={v} value={v}>{v}</option>)}
            </Select>
          </label>
        </div>
        <label className="flex gap-2 items-center text-sm">
          <input type="checkbox" checked={repeat} onChange={e => { setRepeat(e.target.checked); setPage(1) }} />
          Repeat known billing cycles at the current cost
        </label>
        <details className="rounded-md bg-gray-50 p-3 text-xs text-gray-600">
          <summary className="cursor-pointer font-medium">How this estimate is calculated</summary>
          <p className="mt-2">Only active, unarchived records are included. The configured expiry date is used, not a promised payment date.
            Cost means the stored price per renewal; prices, seat counts and business units are assumed unchanged.</p>
          <p className="mt-2">With repeats enabled, known billing cycles are projected even when auto-renew is off. Unknown cycles appear once.
            One-time purchases and overdue dates are excluded. Renewals already recorded early move the next estimate to the new expiry.</p>
          <p className="mt-2">Missing or invalid prices and missing currencies are flagged, never treated as free. No payment or renewal is performed.</p>
        </details>
        {(error || exportError) && <p role="alert" className="rounded-md bg-red-50 p-3 text-sm text-red-700">
          {exportError || (error as any)?.response?.data?.error?.message || 'Could not load the forecast.'}
        </p>}
        {isPending && <p role="status" className="text-sm text-gray-500">Calculating forecast…</p>}
        {data && !error && <div className={`space-y-5 ${isFetching ? 'opacity-50' : ''}`}>
          <div className="rounded border bg-amber-50 p-3 text-sm space-y-1"><p className="font-medium">Forecast coverage and assumptions</p><p>{data.summary.unpriced_renewals} renewals have missing/invalid prices. {data.coverage.missing_date_records} records have no usable date; {data.coverage.overdue_records} overdue records and {data.coverage.one_time_records} one-time records are excluded.</p><p>Amounts are separate per currency; no exchange-rate conversion is applied. {repeat ? 'Known billing cycles repeat at the current stored price.' : 'Only the next renewal is included.'} Dates and amounts are estimates, not scheduled payments.</p></div>
          <p role="status" className="text-sm text-gray-500">
            {isFetching ? 'Updating… ' : ''}{data.start} to {data.end} · {data.summary.renewals.toLocaleString()} estimated renewals across {data.summary.records.toLocaleString()} records
          </p>
          {data.summary.unpriced_renewals > 0 && <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            {data.summary.unpriced_renewals.toLocaleString()} renewals have an unknown price or currency. The totals below include known amounts only.
          </p>}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {data.currencies.map(row => <div key={row.currency || ''} className="rounded-md border p-3">
              <p className="text-xs text-gray-500">{row.currency || 'Unspecified currency'} · known estimate</p>
              <p className="mt-1 text-xl font-semibold tabular-nums break-all">{money(row.amount)}</p>
              <p className="mt-1 text-xs text-gray-500">{row.renewals.toLocaleString()} renewals{row.unpriced_renewals ? ` · ${row.unpriced_renewals} unpriced` : ''}</p>
            </div>)}
          </div>
          <p className="text-xs text-gray-500">
            Outside this estimate: {data.coverage.overdue_records} overdue records, {data.coverage.missing_date_records} without a valid configured date,
            {' '}{data.coverage.one_time_records} one-time purchases. {data.coverage.single_date_records} records have no known repeat cycle.
          </p>
          {data.total === 0 ? <p className="rounded-md border p-6 text-sm text-center text-gray-500">No renewals match this forecast window and filters.</p> : <>
            <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
              <section>
                <h3 className="mb-2 text-sm font-medium">Monthly estimate</h3>
                <div className="max-h-80 overflow-auto rounded-md border">
                  <table className="w-full"><caption className="sr-only">Monthly renewal totals by currency</caption>
                    <thead><tr>{['Month', 'Currency', 'Known amount', 'Renewals'].map(h => <th key={h} className={thClass}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y">{data.monthly.map(r => <tr key={`${r.month}-${r.currency}`}>
                      <td className={tdClass}>{r.month}</td><td className={tdClass}>{r.currency || 'Unspecified'}</td>
                      <td className={`${tdClass} tabular-nums`}>{money(r.amount)}{r.unpriced_renewals > 0 && <span className="block text-xs text-amber-700">{r.unpriced_renewals} unpriced</span>}</td>
                      <td className={tdClass}>{r.renewals}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </section>
              <section>
                <h3 className="mb-2 text-sm font-medium">Estimate by business unit</h3>
                <div className="max-h-80 overflow-auto rounded-md border">
                  <table className="w-full"><caption className="sr-only">Business unit renewal totals by currency</caption>
                    <thead><tr>{['Business unit', 'Currency', 'Known amount', 'Renewals'].map(h => <th key={h} className={thClass}>{h}</th>)}</tr></thead>
                    <tbody className="divide-y">{data.business_units.map(r => <tr key={JSON.stringify([r.business_unit, r.currency])}>
                      <td className={tdClass}>{r.business_unit || 'Unassigned'}</td><td className={tdClass}>{r.currency || 'Unspecified'}</td>
                      <td className={`${tdClass} tabular-nums`}>{money(r.amount)}{r.unpriced_renewals > 0 && <span className="block text-xs text-amber-700">{r.unpriced_renewals} unpriced</span>}</td>
                      <td className={tdClass}>{r.renewals}</td>
                    </tr>)}</tbody>
                  </table>
                </div>
              </section>
            </div>
            <section>
              <h3 className="mb-2 text-sm font-medium">Renewal details</h3>
              <div className="max-h-96 overflow-auto rounded-md border">
                <table className="w-full"><caption className="sr-only">Renewals included in the forecast</caption>
                  <thead><tr>{['Date', 'Record', 'Business unit', 'Vendor', 'Estimate', 'Basis'].map(h => <th key={h} className={thClass}>{h}</th>)}</tr></thead>
                  <tbody className="divide-y">{data.items.map(r => <tr key={`${r.record_id}-${r.renewal_date}`}>
                    <td className={`${tdClass} whitespace-nowrap`}>{r.renewal_date}</td>
                    <td className={tdClass}>{hasPermission('record.view') ? <Link className="text-primary hover:underline" to={`/records/${r.type_slug}/${r.record_id}`}>{r.name}</Link> : r.name}<span className="block text-xs text-gray-500">{r.type_name}</span></td>
                    <td className={tdClass}>{r.business_unit || 'Unassigned'}</td><td className={tdClass}>{r.vendor || 'Unspecified'}</td>
                    <td className={`${tdClass} whitespace-nowrap tabular-nums`}>{money(r.amount)} {r.currency || '(currency missing)'}</td>
                    <td className={`${tdClass} text-xs text-gray-500`}>{r.projected ? 'Cycle projection' : 'Next expiry'}<span className="block">{r.cycle || 'Cycle not set'}</span></td>
                  </tr>)}</tbody>
                </table>
              </div>
              <div className="mt-3 flex justify-end items-center gap-3 text-sm">
                <Button size="sm" variant="outline" disabled={page <= 1 || isFetching} onClick={() => setPage(p => p - 1)}>Previous</Button>
                <span>Page {page} of {Math.max(1, data.total_pages)}</span>
                <Button size="sm" variant="outline" disabled={page >= data.total_pages || isFetching} onClick={() => setPage(p => p + 1)}>Next</Button>
              </div>
            </section>
          </>}
        </div>}
      </CardContent>
    </Card>
  )
}
