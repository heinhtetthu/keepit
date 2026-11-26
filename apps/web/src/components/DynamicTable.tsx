import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowLeftRight, ArrowUp, ArrowUpDown, Archive, Columns3, Copy, Eye, Pencil, RefreshCw, UserMinus, UserPlus } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { Button } from '@/components/ui/button'
import Popover from '@/components/ui/popover'
import RowMenu from '@/components/ui/menu'
import Avatar from '@/components/ui/avatar'
import TruncatedText from '@/components/ui/truncated-text'
import { cn } from '@/lib/utils'
import { seatFields, type SeatFields } from '@/lib/seats'
import type { RecordType, RecordItem, RecordField } from '../types'
import type { SeatMode } from './SeatDialog'

/* One table for every record type.
   - Tracked (seat) types lead with the holder; other types lead with the name.
   - The expiry field becomes a single "Expires" column with a countdown.
   - Cost and Currency share one cell; the auto-renew flag is an inline switch.
   - Row actions live in one ⋯ menu. */

interface Props {
  recordType: RecordType
  today?: string
  records: RecordItem[]
  visibleColumns: string[]
  onView: (record: RecordItem) => void
  onEdit: (record: RecordItem) => void
  onArchive?: (record: RecordItem) => void
  onDuplicate?: (record: RecordItem) => void
  onSeatAction?: (mode: SeatMode, record: RecordItem) => void
  onToggle?: (record: RecordItem, field: RecordField, value: boolean) => void
  selectedIds: Set<number>
  onSelectionChange: (ids: Set<number>) => void
  sort?: string
  order?: 'asc' | 'desc'
  onSort?: (slug: string) => void
}

/** Fields folded into other cells, so they never show as their own column. */
function foldedSlugs(rt: RecordType, f: SeatFields): Set<string> {
  const out = new Set<string>()
  if (f.expiry) out.add(f.expiry.slug)
  if (f.currency && f.cost) out.add(f.currency.slug)
  if (rt.track_ownership) {
    if (f.assignee) out.add(f.assignee.slug)
    if (f.email) out.add(f.email.slug)
  }
  return out
}

export function listableFields(rt: RecordType | undefined): RecordField[] {
  if (!rt) return []
  const folded = foldedSlugs(rt, seatFields(rt))
  return (rt.fields || [])
    .filter((f) => f.active && f.show_in_list && !folded.has(f.slug) && f.field_type !== 'secret')
    .sort((a, b) => a.display_order - b.display_order)
}

const DEFAULT_COLUMNS = 5

/** Visible list columns, persisted per user and record type. */
export function useVisibleColumns(recordType: RecordType | undefined) {
  const userId = useAuthStore((s) => s.user?.id)
  const configuredFields = useMemo(() => listableFields(recordType), [recordType])
  const key = `record-columns-v2-${userId}-${recordType?.id}`
  const [visibleSlugs, setVisibleSlugs] = useState<string[]>([])

  useEffect(() => {
    if (!recordType) return
    const defaults = configuredFields.filter((f) => !['long_text', 'url', 'multi_select'].includes(f.field_type)).slice(0, DEFAULT_COLUMNS).map((f) => f.slug)
    try {
      const saved = JSON.parse(localStorage.getItem(key) || 'null')
      if (Array.isArray(saved)) {
        setVisibleSlugs(saved.filter((s: string) => configuredFields.some((f) => f.slug === s)))
        return
      }
    } catch { /* fall back to defaults */ }
    setVisibleSlugs(defaults)
  }, [key, configuredFields]) // eslint-disable-line react-hooks/exhaustive-deps

  const persist = (next: string[]) => {
    try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* storage unavailable */ }
    return next
  }
  const toggleColumn = (slug: string) => setVisibleSlugs((prev) => persist(prev.includes(slug) ? prev.filter((s) => s !== slug) : [...prev, slug]))
  const setColumns = (slugs: string[]) => setVisibleSlugs(persist(slugs))
  return { configuredFields, visibleSlugs, toggleColumn, setColumns }
}

export function ColumnPicker({ configuredFields, visibleSlugs, toggleColumn }: {
  configuredFields: RecordField[]
  visibleSlugs: string[]
  toggleColumn: (slug: string) => void
}) {
  return (
    <Popover
      align="right"
      panelClassName="p-1.5 w-60 max-h-80 overflow-y-auto"
      trigger={
        <Button variant="outline" size="sm" title="Choose columns">
          <Columns3 className="h-3.5 w-3.5 sm:mr-1.5" />
          <span className="hidden sm:inline">Columns</span>
        </Button>
      }
    >
      <p className="px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-gray-400">Show columns</p>
      {configuredFields.map((field) => (
        <label key={field.id} className="flex items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-gray-50 cursor-pointer">
          <input type="checkbox" className="h-4 w-4 accent-primary" checked={visibleSlugs.includes(field.slug)} onChange={() => toggleColumn(field.slug)} />
          <span className="truncate">{field.name}</span>
        </label>
      ))}
      {configuredFields.length === 0 && <p className="p-2 text-xs text-gray-400">No extra columns for this type.</p>}
    </Popover>
  )
}

function daysUntil(dateStr: string | null, today?: string): number | null {
  if (!dateStr || !today) return null
  const days = Math.round((Date.parse(dateStr.slice(0, 10) + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
  return Number.isFinite(days) ? days : null
}

function formatValue(field: RecordField, value: any): string {
  if (value === null || value === undefined || value === '') return ''
  if (field.field_type === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.join(', ')
  if (field.field_type === 'date' && typeof value === 'string') return value.slice(0, 10)
  if (['currency', 'decimal'].includes(field.field_type) && typeof value === 'number') return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return String(value)
}

export function Expiry({ date, today, autoRenew }: { date: string | null; today?: string; autoRenew?: boolean | null }) {
  if (!date) return <span className="text-gray-300">-</span>
  const days = daysUntil(date, today)
  const tone = days === null ? 'text-gray-500' : days < 0 ? 'text-red-600' : days <= 7 ? 'text-orange-600' : days <= 30 ? 'text-amber-600' : 'text-gray-500'
  const label = days === null ? '' : days < 0 ? `${-days}d overdue` : days === 0 ? 'today' : `in ${days}d`
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <TruncatedText text={date.slice(0, 10)} className="text-gray-900 tabular-nums" />
      <TruncatedText
        text={`${label}${autoRenew === true ? ' · auto-renews' : ''}${autoRenew === false && days !== null && days <= 30 ? ' · renew manually' : ''}`}
        className={cn('text-xs', tone)}
      >
        {label}
        {autoRenew === true && <span className="text-gray-400"> · auto</span>}
        {autoRenew === false && days !== null && days <= 30 && <span className="font-medium text-amber-700"> · renew manually</span>}
      </TruncatedText>
    </span>
  )
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className={cn(
        'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-emerald-500' : 'bg-gray-300',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

/* ---- Column widths: proportional weights that always fill the table ----
   Widths are weights, not pixels: the columns always add up to the table's
   width, so there is never a horizontal scrollbar. Dragging a border moves
   width between the two neighbouring columns. */

const SELECT_PX = 40
const ACTIONS_PX = 48
const MIN_COL_PX = 64

function defaultWeight(key: string, field?: RecordField): number {
  if (key === '__primary') return 2.4
  if (key === '__expiry') return 1.1
  switch (field?.field_type) {
    case 'long_text': return 1.6
    case 'text': case 'email': case 'url': case 'employee': return 1.4
    case 'select': case 'multi_select': case 'business_unit': return 1.2
    case 'boolean': return 0.8
    case 'currency': case 'decimal': case 'integer': case 'percentage': return 0.9
    default: return 1
  }
}

type Col = { key: string; field?: RecordField }

function useColumnWidths(recordType: RecordType, cols: Col[]) {
  const userId = useAuthStore((s) => s.user?.id)
  const storageKey = `record-colwidths-${userId}-${recordType.id}`
  const [saved, setSaved] = useState<Record<string, number>>({})
  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem(storageKey) || '{}') || {}) } catch { setSaved({}) }
  }, [storageKey])
  const weights = cols.map((c) => (saved[c.key] > 0 ? saved[c.key] : defaultWeight(c.key, c.field)))
  const save = (next: Record<string, number>) => {
    setSaved(next)
    try { localStorage.setItem(storageKey, JSON.stringify(next)) } catch { /* storage unavailable */ }
  }
  return { weights, saved, save }
}

export default function DynamicTable({
  recordType, records, today, visibleColumns, onView, onEdit, onArchive, onDuplicate,
  onSeatAction, onToggle, selectedIds, onSelectionChange, sort, order, onSort,
}: Props) {
  const canInType = useAuthStore((s) => s.canInType)
  const canEdit = canInType('record.edit', recordType.id)
  const canCreate = canInType('record.create', recordType.id)
  const canDelete = canInType('record.delete', recordType.id)
  const sf = seatFields(recordType)
  const tracked = recordType.track_ownership
  const fields = listableFields(recordType).filter((f) => visibleColumns.includes(f.slug))
  const showExpiry = !!recordType.reminder_field_id

  const cols: Col[] = [
    { key: '__primary' },
    ...fields.map((f) => ({ key: f.slug, field: f })),
    ...(showExpiry ? [{ key: '__expiry' }] : []),
  ]
  const { weights, saved, save } = useColumnWidths(recordType, cols)
  const [live, setLive] = useState<number[] | null>(null) // weights while dragging
  const shown = live && live.length === weights.length ? live : weights

  const tableRef = useRef<HTMLTableElement>(null)
  const [tableWidth, setTableWidth] = useState(0)
  useLayoutEffect(() => {
    const host = tableRef.current?.parentElement
    if (!host) return
    const measure = () => setTableWidth(host.clientWidth)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(host)
    return () => ro.disconnect()
  }, [])
  const available = Math.max(1, tableWidth - SELECT_PX - ACTIONS_PX)
  const total = shown.reduce((a, b) => a + b, 0) || 1
  const px = shown.map((w) => Math.floor((available * w) / total))

  /** Drag the border between column i and i+1: they trade width, the total stays the same. */
  const startResize = (i: number, e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const base = [...shown]
    const pair = base[i] + base[i + 1]
    const minW = Math.min((MIN_COL_PX / available) * total, pair / 2)
    let latest = base
    const move = (ev: PointerEvent) => {
      const dw = ((ev.clientX - startX) / available) * total
      const a = Math.min(Math.max(base[i] + dw, minW), pair - minW)
      latest = base.map((w, j) => (j === i ? a : j === i + 1 ? pair - a : w))
      setLive(latest)
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      save({ ...saved, ...Object.fromEntries(cols.map((c, j) => [c.key, Number(latest[j].toFixed(3))])) })
      setLive(null)
    }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const allSelected = records.length > 0 && records.every((r) => selectedIds.has(r.id))
  const someSelected = records.some((r) => selectedIds.has(r.id))
  const toggleRow = (id: number) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onSelectionChange(next)
  }
  const toggleAll = () => onSelectionChange(allSelected ? new Set() : new Set(records.map((r) => r.id)))

  const cell = (record: RecordItem, field: RecordField) => {
    const v = record.values?.[field.slug]
    if (field.field_type === 'boolean') {
      const on = v === true || v === 'true'
      if (onToggle && canEdit && !record.archived) {
        return <Switch checked={on} onChange={(next) => onToggle(record, field, next)} label={`${field.name}: ${on ? 'on' : 'off'}`} />
      }
      return <span className={on ? 'text-emerald-700' : 'text-gray-400'}>{on ? 'On' : 'Off'}</span>
    }
    if (field.id === sf.cost?.id && v !== null && v !== undefined && v !== '') {
      const cur = sf.currency ? record.values?.[sf.currency.slug] : null
      return (
        <TruncatedText text={`${formatValue(field, v)}${cur ? ` ${cur}` : ''}`} className="tabular-nums">
          {formatValue(field, v)}{cur ? <span className="text-gray-400"> {cur}</span> : null}
        </TruncatedText>
      )
    }
    if (field.field_type === 'url' && v) {
      return (
        <TruncatedText text={String(v)}>
          <a href={String(v)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{String(v).replace(/^https?:\/\//, '')}</a>
        </TruncatedText>
      )
    }
    const text = formatValue(field, v)
    return text ? <TruncatedText text={text} /> : <span className="text-gray-300">-</span>
  }

  const header = (c: Col) => {
    if (c.key === '__primary') return { slug: tracked && sf.assignee ? sf.assignee.slug : 'name', label: tracked ? 'Holder' : 'Name', disabled: false }
    if (c.key === '__expiry') return { slug: sf.expiry?.slug || '', label: 'Expires', disabled: !sf.expiry }
    const f = c.field!
    return { slug: f.slug, label: f.name, disabled: f.sortable === false || ['long_text', 'multi_select'].includes(f.field_type) }
  }

  return (
    <table ref={tableRef} className="w-full table-fixed text-sm">
      <colgroup>
        <col style={{ width: SELECT_PX }} />
        {cols.map((c, i) => <col key={c.key} style={tableWidth ? { width: px[i] } : undefined} />)}
        <col style={{ width: ACTIONS_PX }} />
      </colgroup>
      <thead className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur text-left text-xs font-medium text-gray-500">
        <tr className="border-b">
          <th className="pl-4 pr-1 py-2.5">
            <input
              type="checkbox"
              className="h-4 w-4 cursor-pointer align-middle accent-primary"
              checked={allSelected}
              ref={(el) => { if (el) el.indeterminate = someSelected && !allSelected }}
              onChange={toggleAll}
              aria-label="Select all on this page"
            />
          </th>
          {cols.map((c, i) => {
            const h = header(c)
            return (
              <SortTh
                key={c.key}
                slug={h.slug}
                disabled={h.disabled}
                sort={sort}
                order={order}
                onSort={onSort}
                resizer={i < cols.length - 1 ? (
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Resize ${h.label} column`}
                    title="Drag to resize · double-click to reset"
                    onPointerDown={(e) => startResize(i, e)}
                    onDoubleClick={() => save({})}
                    onClick={(e) => e.stopPropagation()}
                    className="group/resize absolute -right-1.5 top-0 z-10 flex h-full w-3 cursor-col-resize touch-none justify-center"
                  >
                    <span className={cn('my-2 w-px bg-gray-200 transition-all group-hover/resize:my-0 group-hover/resize:w-0.5 group-hover/resize:bg-primary', live && 'bg-primary/40')} />
                  </span>
                ) : undefined}
              >{h.label}</SortTh>
            )
          })}
          <th className="px-2 py-2.5"><span className="sr-only">Actions</span></th>
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100">
        {records.map((record) => {
          const selected = selectedIds.has(record.id)
          const holder = tracked && sf.assignee ? record.values?.[sf.assignee.slug] : null
          const email = tracked && sf.email ? record.values?.[sf.email.slug] : null
          const auto = sf.autoRenew ? record.values?.[sf.autoRenew.slug] : undefined
          const sub = email || (sf.product ? record.values?.[sf.product.slug] : null) || record.name
          return (
            <tr
              key={record.id}
              className={cn('group cursor-pointer transition-colors hover:bg-gray-50', selected && 'bg-primary/5 hover:bg-primary/10', record.archived && 'opacity-60')}
              onClick={() => onView(record)}
            >
              <td className="pl-4 pr-1 py-2.5" onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={selected} onChange={() => toggleRow(record.id)} aria-label={`Select ${record.name}`} />
              </td>
              <td className="overflow-hidden px-3 py-2.5">
                {tracked ? (
                  <div className="flex min-w-0 items-center gap-2.5">
                    <Avatar name={holder} />
                    <div className="min-w-0 flex-1">
                      <TruncatedText text={holder || 'Unassigned'} className={cn('font-medium', holder ? 'text-gray-900' : 'italic text-gray-400')} />
                      <TruncatedText text={String(sub)} className="text-xs text-gray-500" />
                    </div>
                  </div>
                ) : (
                  <div className="min-w-0">
                    <TruncatedText text={record.name} className="font-medium text-gray-900" />
                    {(record.status !== 'active' || record.archived) && (
                      <p className="text-xs capitalize text-gray-500">{record.archived ? 'Archived' : record.status}</p>
                    )}
                  </div>
                )}
              </td>
              {fields.map((f) => (
                <td key={f.id} className="overflow-hidden whitespace-nowrap px-3 py-2.5 text-gray-600" onClick={f.field_type === 'boolean' ? (e) => e.stopPropagation() : undefined}>
                  {cell(record, f)}
                </td>
              ))}
              {showExpiry && (
                <td className="overflow-hidden whitespace-nowrap px-3 py-2.5">
                  <Expiry date={record.reminder_date} today={today} autoRenew={auto === undefined ? undefined : auto === true || auto === 'true'} />
                </td>
              )}
              <td className="px-2 py-2.5 text-right" onClick={(e) => e.stopPropagation()}>
                <RowMenu items={[
                  { label: 'Open', icon: <Eye />, onSelect: () => onView(record) },
                  { label: holder ? 'Reassign' : 'Assign', icon: <UserPlus />, onSelect: () => onSeatAction?.('reassign', record), hidden: !tracked || !canEdit || record.archived || !onSeatAction },
                  { label: 'Swap with…', icon: <ArrowLeftRight />, onSelect: () => onSeatAction?.('swap', record), hidden: !tracked || !canEdit || record.archived || !onSeatAction },
                  { label: 'Unassign', icon: <UserMinus />, onSelect: () => onSeatAction?.('unassign', record), hidden: !tracked || !canEdit || record.archived || !holder || !onSeatAction },
                  { label: 'Edit', icon: <Pencil />, onSelect: () => onEdit(record), hidden: !canEdit || record.archived, divider: tracked },
                  { label: 'Duplicate', icon: <Copy />, onSelect: () => onDuplicate?.(record), hidden: !canCreate || !onDuplicate || record.archived },
                  { label: 'Archive', icon: <Archive />, onSelect: () => onArchive?.(record), hidden: !canDelete || !onArchive || record.archived, danger: true, divider: true },
                ]} />
              </td>
            </tr>
          )
        })}
        {records.length === 0 && (
          <tr>
            <td colSpan={cols.length + 2} className="px-4 py-16 text-center">
              <RefreshCw className="mx-auto mb-2 h-5 w-5 text-gray-300" />
              <p className="text-sm font-medium text-gray-600">Nothing here</p>
              <p className="mt-1 text-xs text-gray-400">Try another tab, clear the search, or add a record.</p>
            </td>
          </tr>
        )}
      </tbody>
    </table>
  )
}

export function SortTh({ slug, sort, order, onSort, disabled, resizer, children }: {
  slug: string
  sort?: string
  order?: 'asc' | 'desc'
  onSort?: (slug: string) => void
  disabled?: boolean
  resizer?: React.ReactNode
  children: string
}) {
  const active = sort === slug
  return (
    <th className="relative px-1.5 py-1.5" aria-sort={active ? (order === 'asc' ? 'ascending' : 'descending') : undefined}>
      {!onSort || disabled ? (
        <span className="block px-1.5 py-1"><TruncatedText text={children} /></span>
      ) : (
        <button
          onClick={() => onSort(slug)}
          className={cn('group/sort flex max-w-full items-center gap-1 rounded px-1.5 py-1 hover:bg-gray-200/60 hover:text-gray-900', active && 'text-gray-900')}
        >
          <TruncatedText text={children} className="min-w-0" />
          {active
            ? (order === 'asc' ? <ArrowUp className="h-3 w-3 shrink-0" /> : <ArrowDown className="h-3 w-3 shrink-0" />)
            : <ArrowUpDown className="h-3 w-3 shrink-0 opacity-0 group-hover/sort:opacity-60" />}
        </button>
      )}
      {resizer}
    </th>
  )
}
