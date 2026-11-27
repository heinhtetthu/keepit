import { useState } from 'react'
import { Check, Database, Laptop, Minus } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useAccessCatalog, type LevelInfo } from './AccessDialog'
import { cn } from '@/lib/utils'

/** "What does each level mean?": side-by-side comparison for Assets and Records. */
export default function RolesExplained() {
  const { data: cat } = useAccessCatalog()
  const [area, setArea] = useState<'assets' | 'records'>('assets')
  if (!cat) return <div className="skeleton h-72" />
  const levels: LevelInfo[] = cat[area].levels.filter((l) => l.key !== 'none')
  const rows = [...new Set(levels.flatMap((l) => l.can.filter((c) => !c.startsWith('Everything'))))]
  const has = (idx: number, row: string) => levels.slice(0, idx + 1).some((l) => l.can.includes(row))
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center gap-3">
          <CardTitle className="text-base">What each access level allows</CardTitle>
          <div role="tablist" className="ml-auto flex rounded-lg bg-gray-100 p-0.5 text-sm font-medium">
            {([['assets', 'Assets', Laptop], ['records', 'Records', Database]] as const).map(([k, label, I]) => (
              <button key={k} role="tab" aria-selected={area === k} onClick={() => setArea(k)}
                className={cn('press inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1', area === k ? 'bg-white text-primary shadow-soft' : 'text-gray-500')}><I className="h-3.5 w-3.5" />{label}</button>
            ))}
          </div>
        </div>
        <p className="text-sm text-gray-500">{cat[area].summary}</p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div key={area} className="grid animate-page-in gap-3 md:grid-cols-3">
          {levels.map((l) => (
            <div key={l.key} className="rounded-xl border p-3">
              <p className="whitespace-nowrap text-sm font-semibold text-gray-900">{l.title}</p>
              <p className="mt-1 text-xs leading-relaxed text-gray-600">{l.description}</p>
              {l.cannot.length > 0 && <p className="mt-2 text-[11px] text-gray-500"><span className="font-medium">Not included:</span> {l.cannot.join('; ')}.</p>}
            </div>
          ))}
        </div>
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-[11px] uppercase tracking-wider text-gray-500">
              <tr><th className="whitespace-nowrap px-3 py-2">Can…</th>{levels.map((l) => <th key={l.key} className="whitespace-nowrap px-3 py-2 text-center">{l.title}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r}><td className="px-3 py-2 text-gray-700">{r}</td>
                  {levels.map((l, i) => <td key={l.key} className="px-3 py-2 text-center">{has(i, r) ? <Check className="mx-auto h-4 w-4 text-green-600" /> : <Minus className="mx-auto h-4 w-4 text-gray-300" />}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {area === 'records' && <p className="text-xs text-gray-500"><span className="font-medium text-gray-700">Per record type:</span> {cat.grants.description} Example: Records Editor with Licenses = Edit and Domains = View can renew licenses but only look at domains.</p>}
        <div className="grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
          <p className="rounded-lg bg-gray-50 p-2.5"><span className="whitespace-nowrap font-medium text-gray-900">{cat.workspace.title}:</span> {cat.workspace.description}</p>
          <p className="rounded-lg bg-gray-50 p-2.5"><span className="whitespace-nowrap font-medium text-gray-900">{cat.assistant.title}:</span> {cat.assistant.description}</p>
          <p className="rounded-lg bg-gray-50 p-2.5"><span className="whitespace-nowrap font-medium text-gray-900">{cat.superuser.title}:</span> {cat.superuser.description}</p>
        </div>
      </CardContent>
    </Card>
  )
}
