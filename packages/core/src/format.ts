/** Formatting helpers with no DOM dependency. */
export function formatDate(value?: string | null): string {
  if (!value) return '—'
  const d = new Date(value.length === 10 ? `${value}T00:00:00` : value)
  return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function formatMoney(amount?: string | number | null, currency?: string | null): string {
  if (amount === null || amount === undefined || amount === '') return '—'
  const n = typeof amount === 'number' ? amount : Number(amount)
  if (Number.isNaN(n)) return String(amount)
  const s = n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return currency ? `${s} ${currency}` : s
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export function todayISO(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysUntil(iso?: string | null): number | null {
  if (!iso) return null
  const ms = new Date(`${iso}T00:00:00`).getTime() - new Date(`${todayISO()}T00:00:00`).getTime()
  return Math.round(ms / 86_400_000)
}

/** Client-side preview of the server's auto product-number format. */
export function formatSerial(format: string, seq: number, date = new Date(), assetType = ''): string {
  const safe = Math.max(1, Math.floor(seq))
  return (format || '').replace(/\{([A-Za-z0-9:_-]*)\}/g, (_m, inner: string) => {
    if (/^SEQ(?::\d+)?$/.test(inner)) {
      const digits = inner.includes(':') ? Number(inner.split(':')[1]) || 4 : 4
      return String(safe).padStart(Math.min(Math.max(digits, 1), 10), '0')
    }
    if (inner === 'YY') return String(date.getFullYear()).slice(-2)
    if (inner === 'MM') return String(date.getMonth() + 1).padStart(2, '0')
    if (inner === 'DD') return String(date.getDate()).padStart(2, '0')
    if (inner === 'TYPE') return assetType.toUpperCase().replace(/[\s-]+/g, '_')
    return inner
  }).trim()
}

/** Minimal RFC-4180 CSV parser for bulk imports (no dependency). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++ }
      else if (c === '"') quoted = false
      else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((v) => v.trim())) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((v) => v.trim())) rows.push(row)
  return rows
}

/** CSV rows -> objects keyed by normalized header (lowercase, spaces→_). */
export function csvToObjects(text: string): Record<string, string>[] {
  const [header, ...rest] = parseCsv(text)
  if (!header) return []
  const keys = header.map((h) => h.trim().toLowerCase().replace(/[\s/-]+/g, '_'))
  return rest.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])))
}
