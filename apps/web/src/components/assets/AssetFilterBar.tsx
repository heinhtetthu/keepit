import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SlidersHorizontal, X } from 'lucide-react'
import { ASSIGNMENT_STATUSES, CONDITION_STATUSES, useEmployees, useReference } from '@workspace/core'
import api from '@/lib/api'
import Popover from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import SearchableSelect from '@/components/SearchableSelect'
import { EmployeePicker } from './shared'
import { cn } from '@/lib/utils'

/** URL search-param keys; they match the API's asset filter names. */
export const ASSET_FILTER_KEYS = [
  'asset_type', 'brand', 'model', 'assignment_status', 'condition_status', 'location', 'supplier', 'business_unit',
  'employee_id', 'purchase_from', 'purchase_to', 'warranty', 'warranty_from', 'warranty_to', 'cost_min', 'cost_max', 'open_repair',
] as const
type Key = (typeof ASSET_FILTER_KEYS)[number]
export type AssetFilterValues = Partial<Record<Key, string>>

const LABELS: Record<Key, string> = {
  asset_type: 'Type', brand: 'Brand', model: 'Model', assignment_status: 'Assignment', condition_status: 'Condition', location: 'Location',
  supplier: 'Supplier', business_unit: 'Business unit', employee_id: 'Holder', purchase_from: 'Bought from', purchase_to: 'Bought until',
  warranty: 'Warranty', warranty_from: 'Warranty from', warranty_to: 'Warranty until', cost_min: 'Cost ≥', cost_max: 'Cost ≤', open_repair: 'Open repair',
}
const WARRANTY = [['active', 'Active'], ['expiring', 'Ending in 90 days'], ['expired', 'Expired'], ['none', 'No warranty']] as const

function Multi({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <label className="block space-y-1"><span className="text-xs font-medium text-gray-600">{label}</span>
      <SearchableSelect multiple options={options} value={value} onChange={(v) => onChange(v as string[])} placeholder="Any" />
    </label>
  )
}

function Range({ label, type, from, to, onFrom, onTo }: { label: string; type: 'date' | 'number'; from?: string; to?: string; onFrom: (v: string) => void; onTo: (v: string) => void }) {
  const num = type === 'number'
  return (
    <div className="space-y-1"><span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="flex items-center gap-2">
        <Input type={type} min={num ? 0 : undefined} placeholder={num ? 'Min' : undefined} value={from ?? ''} onChange={(e) => onFrom(e.target.value)} aria-label={`${label} from`} />
        <span className="text-gray-400">→</span>
        <Input type={type} min={num ? 0 : undefined} placeholder={num ? 'Max' : undefined} value={to ?? ''} onChange={(e) => onTo(e.target.value)} aria-label={`${label} to`} />
      </div>
    </div>
  )
}

/** "Filters" button with a panel holding every asset filter, plus removable chips for active ones. */
export default function AssetFilterBar({ values, onChange }: { values: AssetFilterValues; onChange: (next: AssetFilterValues) => void }) {
  const { data: ref } = useReference()
  const { data: employees = [] } = useEmployees(true)
  const { data: units = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['business-units'], queryFn: async () => (await api.get('/business-units')).data, staleTime: 60_000 })
  const [draft, setDraft] = useState<AssetFilterValues>(values)
  const active = ASSET_FILTER_KEYS.filter((k) => values[k])
  const list = (k: Key) => (draft[k] ? draft[k]!.split(',') : [])
  const setList = (k: Key, v: string[]) => setDraft({ ...draft, [k]: v.join(',') || undefined })
  const set = (k: Key, v: string | undefined) => setDraft({ ...draft, [k]: v || undefined })
  const opts = (names: readonly string[]) => names.map((n) => ({ value: n, label: n }))

  const chipText = useMemo(() => (k: Key) => {
    const v = values[k]!
    if (k === 'employee_id') return employees.find((e) => String(e.id) === v)?.name ?? `#${v}`
    if (k === 'warranty') return WARRANTY.find(([w]) => w === v)?.[1] ?? v
    if (k === 'open_repair') return v === 'true' ? 'Yes' : 'No'
    return v.split(',').join(', ')
  }, [values, employees])

  return (
    <>
      <Popover align="left" panelClassName="w-[min(40rem,calc(100vw-2rem))] p-0"
        trigger={
          <Button variant="outline" onClick={() => setDraft(values)} className={cn(active.length && 'border-primary/40 text-primary')}>
            <SlidersHorizontal className="h-4 w-4" />Filters
            {active.length > 0 && <span className="ml-0.5 rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{active.length}</span>}
          </Button>
        }>
        {(close) => (
          <div className="flex max-h-[min(36rem,var(--popover-room,calc(100dvh-10rem)))] flex-col">
            <div className="grid flex-1 gap-4 overflow-y-auto p-4 sm:grid-cols-2">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 sm:col-span-2">What it is</p>
              <Multi label={LABELS.asset_type} options={opts((ref?.asset_type ?? []).map((t) => t.name))} value={list('asset_type')} onChange={(v) => setList('asset_type', v)} />
              <Multi label={LABELS.brand} options={opts((ref?.brand ?? []).map((t) => t.name))} value={list('brand')} onChange={(v) => setList('brand', v)} />
              <label className="block space-y-1"><span className="text-xs font-medium text-gray-600">Model contains</span><Input value={draft.model ?? ''} onChange={(e) => set('model', e.target.value)} placeholder="e.g. Latitude" /></label>
              <Multi label={LABELS.supplier} options={opts((ref?.vendor ?? []).map((t) => t.name))} value={list('supplier')} onChange={(v) => setList('supplier', v)} />

              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 sm:col-span-2">Where and who</p>
              <Multi label={LABELS.assignment_status} options={opts(ASSIGNMENT_STATUSES)} value={list('assignment_status')} onChange={(v) => setList('assignment_status', v)} />
              <Multi label={LABELS.condition_status} options={opts(CONDITION_STATUSES)} value={list('condition_status')} onChange={(v) => setList('condition_status', v)} />
              <Multi label={LABELS.location} options={opts((ref?.location ?? []).map((t) => t.name))} value={list('location')} onChange={(v) => setList('location', v)} />
              <Multi label={LABELS.business_unit} options={opts(units.map((u) => u.name))} value={list('business_unit')} onChange={(v) => setList('business_unit', v)} />
              <label className="block space-y-1 sm:col-span-2"><span className="text-xs font-medium text-gray-600">Holder</span>
                <EmployeePicker includeInactive value={draft.employee_id ? Number(draft.employee_id) : null} onChange={(id) => set('employee_id', id ? String(id) : undefined)} placeholder="Anyone" />
              </label>

              <p className="pt-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400 sm:col-span-2">Dates, money and health</p>
              <Range label="Purchased" type="date" from={draft.purchase_from} to={draft.purchase_to} onFrom={(v) => set('purchase_from', v)} onTo={(v) => set('purchase_to', v)} />
              <Range label="Purchase cost" type="number" from={draft.cost_min} to={draft.cost_max} onFrom={(v) => set('cost_min', v)} onTo={(v) => set('cost_max', v)} />
              <label className="block space-y-1"><span className="text-xs font-medium text-gray-600">Warranty</span>
                <Select value={draft.warranty ?? ''} onChange={(e) => set('warranty', e.target.value)}><option value="">Any</option>{WARRANTY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
              </label>
              <Range label="Warranty ends" type="date" from={draft.warranty_from} to={draft.warranty_to} onFrom={(v) => set('warranty_from', v)} onTo={(v) => set('warranty_to', v)} />
              <label className="block space-y-1"><span className="text-xs font-medium text-gray-600">Open repair</span>
                <Select value={draft.open_repair ?? ''} onChange={(e) => set('open_repair', e.target.value)}><option value="">Any</option><option value="true">Has an open repair</option><option value="false">No open repair</option></Select>
              </label>
            </div>
            <div className="flex items-center gap-2 border-t bg-gray-50/80 px-4 py-3">
              <Button variant="ghost" size="sm" onClick={() => setDraft({})}>Reset</Button>
              <Button variant="outline" size="sm" className="ml-auto" onClick={close}>Cancel</Button>
              <Button size="sm" onClick={() => { onChange(draft); close() }}>Apply filters</Button>
            </div>
          </div>
        )}
      </Popover>
      {active.length > 0 && (
        <div className="flex w-full flex-wrap items-center gap-1.5">
          {active.map((k) => (
            <span key={k} className="inline-flex animate-pop-in items-center gap-1 rounded-full border border-primary/30 bg-primary-soft py-0.5 pl-2.5 pr-1 text-xs text-primary">
              <span className="font-medium">{LABELS[k]}:</span><span className="max-w-[14rem] truncate">{chipText(k)}</span>
              <button aria-label={`Remove ${LABELS[k]} filter`} onClick={() => onChange({ ...values, [k]: undefined })} className="rounded-full p-0.5 hover:bg-primary/15"><X className="h-3 w-3" /></button>
            </span>
          ))}
          <button onClick={() => onChange({})} className="text-xs text-gray-500 hover:text-gray-900 hover:underline">Clear all</button>
        </div>
      )}
    </>
  )
}
