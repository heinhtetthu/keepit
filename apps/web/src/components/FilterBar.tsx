import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQuery } from '@tanstack/react-query'
import { Check, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { cn } from '@/lib/utils'
import { todayLocal } from '@/lib/seats'
import type { RecordField } from '../types'

/* Filters: one side panel with the right control for every field, edited as a
   draft and applied together; active filters show as removable chips.

   Value shapes sent to the API (see services/record.py get_records):
     choice   {in: [..]}            text     "contains"
     yes/no   true | {notTrue:true} number   {gte, lte}
     date     {gte, lte} | {lt}     any      {isEmpty} | {notEmpty}
     __renewed_days: N  (renewed in the last N days)   __logic: 'and' | 'or' */

export type FilterState = { [slug: string]: any } & { __logic?: 'and' | 'or'; __renewed_days?: number }

type Kind = 'text' | 'choice' | 'boolean' | 'date' | 'number'
const KIND: Record<string, Kind> = {
  text: 'text', email: 'text', url: 'text', long_text: 'text', phone: 'text',
  select: 'choice', multi_select: 'choice', employee: 'choice', business_unit: 'choice',
  boolean: 'boolean', date: 'date', datetime: 'date',
  integer: 'number', decimal: 'number', currency: 'number', percentage: 'number',
}
const RENEWED = [7, 30, 60, 90, 180, 365]

const iso = (offset: number) => {
  const d = new Date(`${todayLocal()}T00:00:00`)
  d.setDate(d.getDate() + offset)
  return d.toLocaleDateString('en-CA')
}
const DATE_PRESETS: { label: string; value: () => object }[] = [
  { label: 'Overdue', value: () => ({ lt: iso(0) }) },
  { label: 'Next 7 days', value: () => ({ gte: iso(0), lte: iso(7) }) },
  { label: 'Next 30 days', value: () => ({ gte: iso(0), lte: iso(30) }) },
  { label: 'Next 90 days', value: () => ({ gte: iso(0), lte: iso(90) }) },
  { label: 'Last 30 days', value: () => ({ gte: iso(-30), lte: iso(0) }) },
  { label: 'This year', value: () => ({ gte: `${iso(0).slice(0, 4)}-01-01`, lte: `${iso(0).slice(0, 4)}-12-31` }) },
]

const isMeta = (k: string) => k === '__logic' || k === '__tab'
const isSet = (v: unknown) => v !== undefined && v !== null && v !== '' && !(typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)

/** Old saved views stored a plain string for choice fields. */
function choiceValues(v: any): string[] {
  if (v == null) return []
  if (Array.isArray(v)) return v.map(String)
  if (typeof v === 'object') return Array.isArray(v.in) ? v.in.map(String) : []
  return [String(v)]
}

export function filterCount(value: FilterState): number {
  return Object.entries(value).filter(([k, v]) => !isMeta(k) && isSet(v)).length
}

function useChoiceOptions(field: RecordField, enabled: boolean): string[] {
  const master = field.field_type === 'employee' || field.field_type === 'business_unit'
  const { data } = useQuery<string[]>({
    queryKey: ['filter-options', field.field_type],
    queryFn: async () => (await api.get(field.field_type === 'employee' ? '/employees' : '/business-units')).data.map((x: { name: string }) => x.name),
    enabled: enabled && master,
    staleTime: 60_000,
  })
  return master ? data || [] : (field.options || []).map((o) => o.value)
}

function describe(field: RecordField | undefined, slug: string, v: any): string {
  if (slug === '__renewed_days') return `Renewed in last ${v} days`
  if (!field) return slug
  if (v?.isEmpty) return `${field.name} is empty`
  if (v?.notEmpty) return `${field.name} is set`
  const kind = KIND[field.field_type]
  if (kind === 'choice') {
    const vals = choiceValues(v).map((x) => field.options?.find((o) => o.value === x)?.label || x)
    return `${field.name}: ${vals.length > 2 ? `${vals.slice(0, 2).join(', ')} +${vals.length - 2}` : vals.join(', ')}`
  }
  if (kind === 'boolean') return `${field.name}: ${v === true ? 'Yes' : 'No'}`
  if (kind === 'text') return `${field.name} contains "${v}"`
  const fmt = (x: string) => (kind === 'date' ? String(x).slice(0, 10) : x)
  if (v?.lt) return `${field.name} before ${fmt(v.lt)}`
  if (v?.gte && v?.lte) return `${field.name} ${fmt(v.gte)} – ${fmt(v.lte)}`
  if (v?.gte) return `${field.name} ≥ ${fmt(v.gte)}`
  if (v?.lte) return `${field.name} ≤ ${fmt(v.lte)}`
  return field.name
}

/** Removable chips for the filters in effect, shown under the toolbar. */
export function ActiveFilters({ fields, value, onChange, simple }: { fields: RecordField[]; value: FilterState; onChange: (f: FilterState) => void; simple?: boolean }) {
  const entries = Object.entries(value).filter(([k, v]) => !isMeta(k) && isSet(v))
  if (!entries.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {entries.map(([slug, v]) => (
        <span key={slug} className="inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 py-1 pl-3 pr-1 text-xs font-medium text-gray-800">
          {describe(fields.find((f) => f.slug === slug), slug, v)}
          <button
            className="rounded-full p-0.5 text-gray-400 hover:bg-white hover:text-red-600"
            aria-label="Remove filter"
            onClick={() => { const next = { ...value }; delete next[slug]; onChange(next) }}
          ><X className="h-3.5 w-3.5" /></button>
        </span>
      ))}
      {entries.length > 1 && !simple && (
        <button
          className="rounded-full px-2 py-1 text-xs text-gray-500 hover:text-gray-900"
          onClick={() => onChange(value.__logic === 'or' ? { ...value, __logic: 'and' } : { ...value, __logic: 'or' })}
          title="Switch between matching all filters and matching any filter"
        >
          Match <b>{value.__logic === 'or' ? 'any' : 'all'}</b>
        </button>
      )}
      <button className="px-2 py-1 text-xs text-gray-500 hover:text-red-600" onClick={() => onChange({})}>Clear all</button>
    </div>
  )
}

export default function FilterButton({ fields, value, onChange, showRenewed, simple }: {
  fields: RecordField[]
  value: FilterState
  onChange: (f: FilterState) => void
  /** Plain AND filters with no "is empty" options (lists whose API has fixed filters, like assets). */
  simple?: boolean
  /** Offer the "Renewed recently" section (types with an expiry field). */
  showRenewed?: boolean
}) {
  const [open, setOpen] = useState(false)
  const count = filterCount(value)
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)} className={cn(count > 0 && 'border-primary/50 text-primary')}>
        <SlidersHorizontal className="h-3.5 w-3.5 sm:mr-1.5" />
        <span className="hidden sm:inline">Filters</span>
        {count > 0 && <span className="ml-1.5 inline-flex min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">{count}</span>}
      </Button>
      {open && <FilterPanel fields={fields} value={value} showRenewed={showRenewed} simple={simple} onClose={() => setOpen(false)} onApply={(f) => { onChange(f); setOpen(false) }} />}
    </>
  )
}

function FilterPanel({ fields, value, onApply, onClose, showRenewed, simple }: {
  simple?: boolean
  fields: RecordField[]
  value: FilterState
  onApply: (f: FilterState) => void
  onClose: () => void
  showRenewed?: boolean
}) {
  const [draft, setDraft] = useState<FilterState>(value)
  const [find, setFind] = useState('')
  const filterable = useMemo(() => fields
    .filter((f) => f.active && f.filterable !== false && KIND[f.field_type] && f.field_type !== 'secret')
    .sort((a, b) => a.display_order - b.display_order), [fields])
  const shown = filterable.filter((f) => f.name.toLowerCase().includes(find.trim().toLowerCase()))
  const set = (slug: string, v: unknown) => setDraft((d) => {
    const next = { ...d }
    if (isSet(v)) next[slug] = v
    else delete next[slug]
    return next
  })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className="fixed inset-0 z-[90] flex justify-end bg-gray-900/30" onMouseDown={onClose}>
      <aside
        className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Filters"
      >
        <header className="flex items-center justify-between border-b px-5 py-4">
          <h2 className="text-base font-semibold">Filters</h2>
          <button onClick={onClose} className="rounded-md p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-5 w-5" /></button>
        </header>
        <div className="flex-1 overflow-y-auto">
          {filterable.length > 6 && (
            <div className="sticky top-0 z-10 border-b bg-white px-5 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <Input value={find} onChange={(e) => setFind(e.target.value)} placeholder="Find a field" className="h-9 pl-9" />
              </div>
            </div>
          )}
          {showRenewed && !find && (
            <Section title="Renewed recently" icon={<RefreshCw className="h-3.5 w-3.5" />} active={isSet(draft.__renewed_days)} onClear={() => set('__renewed_days', null)}>
              <div className="flex flex-wrap gap-1.5">
                {RENEWED.map((d) => (
                  <Pill key={d} on={draft.__renewed_days === d} onClick={() => set('__renewed_days', draft.__renewed_days === d ? null : d)}>
                    {d < 365 ? `Last ${d} days` : 'Last year'}
                  </Pill>
                ))}
              </div>
            </Section>
          )}
          {shown.map((f) => (
            <FieldSection key={f.id} field={f} value={draft[f.slug]} simple={simple} onChange={(v) => set(f.slug, v)} />
          ))}
          {!shown.length && <p className="px-5 py-10 text-center text-sm text-gray-400">No fields match.</p>}
        </div>
        <footer className="flex items-center gap-2 border-t bg-gray-50 px-5 py-3">
          {filterCount(draft) > 1 && !simple && (
            <div className="mr-auto flex rounded-md border bg-white p-0.5 text-xs">
              {(['and', 'or'] as const).map((m) => (
                <button key={m} onClick={() => setDraft({ ...draft, __logic: m })} className={cn('rounded px-2 py-1', (draft.__logic ?? 'and') === m ? 'bg-gray-900 text-white' : 'text-gray-500')}>
                  {m === 'and' ? 'Match all' : 'Match any'}
                </button>
              ))}
            </div>
          )}
          <Button variant="ghost" className={cn((filterCount(draft) <= 1 || simple) && 'mr-auto')} onClick={() => setDraft({})}>Clear all</Button>
          <Button onClick={() => onApply(draft)}>Show results</Button>
        </footer>
      </aside>
    </div>,
    document.body,
  )
}

function Section({ title, icon, active, onClear, children }: { title: string; icon?: React.ReactNode; active: boolean; onClear: () => void; children: React.ReactNode }) {
  return (
    <section className="border-b px-5 py-4 last:border-0">
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className={cn('flex items-center gap-1.5 text-sm font-medium', active ? 'text-primary' : 'text-gray-800')}>{icon}{title}</h3>
        {active && <button onClick={onClear} className="text-xs text-gray-400 hover:text-red-600">Clear</button>}
      </div>
      {children}
    </section>
  )
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn(
      'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm transition-colors',
      on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50',
    )}>
      {on && <Check className="h-3 w-3" />}{children}
    </button>
  )
}

function FieldSection({ field, value, onChange, simple }: { field: RecordField; value: any; onChange: (v: unknown) => void; simple?: boolean }) {
  const kind = KIND[field.field_type]
  const emptyMode = value?.isEmpty ? 'empty' : value?.notEmpty ? 'set' : null
  const options = useChoiceOptions(field, kind === 'choice')
  const [q, setQ] = useState('')
  const selected = choiceValues(value)

  const emptyToggles = (
    <div className="mt-2 flex gap-1.5">
      <Pill on={emptyMode === 'empty'} onClick={() => onChange(emptyMode === 'empty' ? null : { isEmpty: true })}>Is empty</Pill>
      <Pill on={emptyMode === 'set'} onClick={() => onChange(emptyMode === 'set' ? null : { notEmpty: true })}>Has a value</Pill>
    </div>
  )

  let control: React.ReactNode
  if (kind === 'choice') {
    const visible = options.filter((o) => o.toLowerCase().includes(q.trim().toLowerCase()))
    const toggle = (o: string) => {
      const next = selected.includes(o) ? selected.filter((x) => x !== o) : [...selected, o]
      onChange(next.length ? { in: next } : null)
    }
    const label = (o: string) => field.options?.find((x) => x.value === o)?.label || o
    control = options.length > 10 ? (
      <div className="rounded-lg border">
        <div className="relative border-b">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${field.name.toLowerCase()}`} className="h-9 w-full rounded-t-lg pl-9 pr-3 text-sm outline-none" />
        </div>
        <div className="max-h-48 overflow-y-auto py-1">
          {visible.map((o) => (
            <label key={o} className="flex cursor-pointer items-center gap-2.5 px-3 py-1.5 text-sm hover:bg-gray-50">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={selected.includes(o)} onChange={() => toggle(o)} />
              <span className="truncate">{label(o)}</span>
            </label>
          ))}
          {!visible.length && <p className="px-3 py-3 text-center text-xs text-gray-400">No matches</p>}
        </div>
      </div>
    ) : options.length ? (
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => <Pill key={o} on={selected.includes(o)} onClick={() => toggle(o)}>{label(o)}</Pill>)}
      </div>
    ) : <p className="text-xs text-gray-400">No options yet.</p>
  } else if (kind === 'boolean') {
    control = (
      <div className="flex gap-1.5">
        <Pill on={value === true} onClick={() => onChange(value === true ? null : true)}>Yes</Pill>
        <Pill on={!!value?.notTrue || value === false} onClick={() => onChange(value?.notTrue || value === false ? null : { notTrue: true })}>No</Pill>
      </div>
    )
  } else if (kind === 'date' || kind === 'number') {
    const cur = value && typeof value === 'object' && !value.isEmpty && !value.notEmpty ? value : {}
    const bound = (op: 'gte' | 'lte', raw: string) => {
      const next: Record<string, string> = { ...cur }
      delete next.lt
      if (raw) next[op] = raw
      else delete next[op]
      onChange(Object.keys(next).length ? next : null)
    }
    control = (
      <div className="space-y-2.5">
        {kind === 'date' && (
          <div className="flex flex-wrap gap-1.5">
            {DATE_PRESETS.map((p) => {
              const pv = p.value() as Record<string, string>
              const on = JSON.stringify(pv) === JSON.stringify({ ...cur })
              return <Pill key={p.label} on={on} onClick={() => onChange(on ? null : pv)}>{p.label}</Pill>
            })}
          </div>
        )}
        <div className="flex items-center gap-2">
          <Input type={kind === 'date' ? 'date' : 'number'} step="any" className="h-9" value={cur.gte ?? ''} onChange={(e) => bound('gte', e.target.value)} aria-label={`${field.name} from`} placeholder="Min" />
          <span className="text-gray-400">–</span>
          <Input type={kind === 'date' ? 'date' : 'number'} step="any" className="h-9" value={cur.lte ?? ''} onChange={(e) => bound('lte', e.target.value)} aria-label={`${field.name} to`} placeholder="Max" />
        </div>
      </div>
    )
  } else {
    control = (
      <Input className="h-9" placeholder="Contains…" value={typeof value === 'string' ? value : ''} onChange={(e) => onChange(e.target.value || null)} />
    )
  }

  return (
    <Section title={field.name} active={isSet(value)} onClear={() => onChange(null)}>
      {control}
      {kind !== 'boolean' && !simple && emptyToggles}
    </Section>
  )
}
