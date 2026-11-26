import { Link } from 'react-router-dom'
import { AlertTriangle, Clock, FileWarning, Laptop } from 'lucide-react'
import { formatMoney, useAssetSummary, useCurrency } from '@workspace/core'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/** Asset overview. Charts are plain CSS bars: no chart library in the bundle. */
export default function AssetDashboard() {
  const { data, isLoading } = useAssetSummary()
  const { data: cur } = useCurrency()
  if (isLoading || !data) return <div className="h-40 animate-pulse rounded-lg bg-gray-100" />
  const s = data.by_assignment_status
  const stats = [
    { label: 'Assets', value: data.total, sub: `${s.Assigned ?? 0} assigned · ${s.Unassigned ?? 0} free`, icon: Laptop, to: '/assets' },
    { label: 'In repair', value: data.by_condition['In Repair'] ?? 0, sub: `${data.by_condition['Written-Off'] ?? 0} written off`, icon: AlertTriangle, to: '/assets?condition=In+Repair' },
    { label: 'Overdue borrows', value: data.overdue_borrows, sub: `${data.open_borrows} out now`, icon: Clock, to: '/it-logs?tab=borrows', warn: data.overdue_borrows > 0 },
    { label: 'Expiring in 60 days', value: data.warranty_expiring_60d + data.documents_expiring_60d, sub: `${data.warranty_expiring_60d} warranties · ${data.documents_expiring_60d} documents`, icon: FileWarning, to: '/assets?sort=warranty_end_date&order=asc' },
  ]
  const maxCost = Math.max(1, ...data.repair_costs_12m.map((m) => m.cost))
  return (
    <section className="space-y-4" aria-label="Assets overview">
      <h2 className="text-lg font-semibold text-gray-900">Assets</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {stats.map((c) => (
          <Link key={c.label} to={c.to}><Card className="card-hover h-full"><CardContent className="p-4">
            <div className="flex items-center justify-between text-xs text-gray-500">{c.label}<c.icon className={`h-4 w-4 ${c.warn ? 'text-red-500' : 'text-gray-400'}`} /></div>
            <p className={`mt-1 text-2xl font-semibold ${c.warn ? 'text-red-600' : 'text-gray-900'}`}>{c.value}</p>
            <p className="text-xs text-gray-500">{c.sub}</p>
          </CardContent></Card></Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Bars title="By type" rows={data.by_type.map((t) => ({ label: t.name, value: t.count, to: `/assets?type=${encodeURIComponent(t.name)}` }))} />
        <Bars title="By business unit" rows={data.by_business_unit.map((t) => ({ label: t.name, value: t.count }))} />
        <Bars title="By age" rows={['< 1 yr', '1–3 yrs', '3–5 yrs', '5+ yrs', 'Unknown'].filter((k) => data.by_age[k]).map((k) => ({ label: k, value: data.by_age[k] }))} />
      </div>
      {data.repair_costs_12m.length > 0 && (
        <Card><CardHeader className="pb-2"><CardTitle className="text-sm">Repair spend, last 12 months</CardTitle></CardHeader><CardContent>
          <div className="flex h-36 items-end gap-1.5" role="list">
            {data.repair_costs_12m.map((m) => (
              <div key={m.month} role="listitem" className="group flex flex-1 flex-col items-center gap-1" title={`${m.month}: ${formatMoney(m.cost, cur?.default_currency)} (${m.count} repairs)`}>
                <div className="w-full rounded-t bg-primary/70 group-hover:bg-primary" style={{ height: `${Math.max(4, (m.cost / maxCost) * 112)}px` }} />
                <span className="text-[10px] text-gray-500">{m.month.slice(5)}</span>
              </div>
            ))}
          </div>
        </CardContent></Card>
      )}
    </section>
  )
}

function Bars({ title, rows }: { title: string; rows: { label: string; value: number; to?: string }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader><CardContent className="space-y-1.5">
      {rows.length === 0 && <p className="text-sm text-gray-400">No data yet</p>}
      {rows.slice(0, 8).map((r) => {
        const bar = (
          <div className="flex items-center gap-2 text-xs">
            <span className="w-24 shrink-0 truncate text-gray-600">{r.label}</span>
            <span className="h-2 flex-1 overflow-hidden rounded bg-gray-100"><span className="block h-full rounded bg-primary/70" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="w-8 text-right font-medium text-gray-800">{r.value}</span>
          </div>
        )
        return r.to ? <Link key={r.label} to={r.to} className="block hover:opacity-80">{bar}</Link> : <div key={r.label}>{bar}</div>
      })}
    </CardContent></Card>
  )
}
