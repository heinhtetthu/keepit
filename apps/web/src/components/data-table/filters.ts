import type { FilterState } from '@/components/FilterBar'
import type { RecordField } from '@/types'

/**
 * Build a filter-panel field. The records filter panel works on record
 * fields, so every other list describes its filters in the same shape.
 * field_type: 'select' (choice pills), 'text', 'date', 'currency'/'integer' (range), 'boolean', 'business_unit', 'employee'.
 */
export function filterField(slug: string, name: string, field_type: string, options: (string | { value: string; label?: string })[] = [], order = 0): RecordField {
  return {
    id: hash(slug), record_type_id: 0, name, slug, field_type, required: false, unique: false, searchable: false, sortable: true, filterable: true,
    show_in_list: true, show_in_details: true, show_in_reports: true, display_order: order, default_value: null, help_text: null, active: true,
    options: options.map((o) => (typeof o === 'string' ? { value: o, label: o } : { value: o.value, label: o.label ?? o.value }))
      .map((o, i) => ({ id: i + 1, value: o.value, label: o.label, display_order: i })) as RecordField['options'],
  }
}
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) || 1 }

/** Values of a choice filter ({in: [...]}). */
export const choices = (v: any): string[] => (Array.isArray(v?.in) ? v.in.map(String) : Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [])
/** Comma list for an API parameter, or undefined. */
export const csv = (v: any) => (choices(v).length ? choices(v).join(',') : undefined)
const dayBefore = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10) }
/** {gte, lte, lt} → inclusive from/to. */
export const range = (v: any): { from?: string; to?: string } =>
  v && typeof v === 'object' && !Array.isArray(v) ? { from: v.gte, to: v.lte ?? (v.lt ? dayBefore(v.lt) : undefined) } : {}
/** true / {notTrue} → 'true' | 'false'. */
export const yesNo = (v: any) => (v === true ? 'true' : v?.notTrue || v === false ? 'false' : undefined)

/** Apply panel filters in the browser, for lists the server sends whole. */
export function filterRows<T>(rows: T[], filters: FilterState, fields: RecordField[], get: (row: T, slug: string) => unknown): T[] {
  const active = fields.filter((f) => filters[f.slug] !== undefined && filters[f.slug] !== null && filters[f.slug] !== '')
  if (!active.length) return rows
  return rows.filter((row) => active.every((f) => {
    const want = filters[f.slug]
    const raw = get(row, f.slug)
    const values = (Array.isArray(raw) ? raw : [raw]).filter((x) => x !== null && x !== undefined && x !== '').map(String)
    switch (f.field_type) {
      case 'text': return values.some((x) => x.toLowerCase().includes(String(want).toLowerCase()))
      case 'boolean': return want === true ? raw === true : raw !== true
      case 'date': case 'datetime': case 'integer': case 'decimal': case 'currency': {
        const r = range(want); const x = values[0]
        if (x === undefined) return false
        const num = f.field_type !== 'date' && f.field_type !== 'datetime'
        const cmp = (a: string, b: string) => (num ? Number(a) - Number(b) : a.slice(0, 10).localeCompare(b))
        return (!r.from || cmp(x, r.from) >= 0) && (!r.to || cmp(x, r.to) <= 0)
      }
      default: { const set = choices(want); return !set.length || values.some((x) => set.includes(x)) }
    }
  }))
}

/** Sort and page rows in the browser. */
export function sortRows<T>(rows: T[], sort: string, order: 'asc' | 'desc', get: (row: T, slug: string) => unknown): T[] {
  const dir = order === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = get(a, sort), y = get(b, sort)
    if (x === y) return 0
    if (x === null || x === undefined || x === '') return 1
    if (y === null || y === undefined || y === '') return -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * dir
  })
}
export const pageOf = <T,>(rows: T[], page: number, size: number) => rows.slice((page - 1) * size, page * size)

/** Search, filter, sort and page a list held in memory. */
export function clientRows<T>(rows: T[], s: { search: string; filters: FilterState; sort: string; order: 'asc' | 'desc'; page: number; pageSize: number },
  fields: RecordField[], get: (row: T, slug: string) => unknown, searchText?: (row: T) => string) {
  const needle = s.search.toLowerCase()
  const searched = needle && searchText ? rows.filter((r) => searchText(r).toLowerCase().includes(needle)) : rows
  const sorted = sortRows(filterRows(searched, s.filters, fields, get), s.sort, s.order, get)
  return { rows: pageOf(sorted, s.page, s.pageSize), all: sorted, total: sorted.length, pages: Math.max(1, Math.ceil(sorted.length / s.pageSize)) }
}
