import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, ScrollText } from 'lucide-react'
import api from '@/lib/api'
import { errorMessage } from '@workspace/core'
import Modal from '@/components/ui/modal'
import { Badge } from '@/components/ui/badge'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, TitleCell, csv, filterField, range, useTableState,
  type Column, type SortDef,
} from '@/components/data-table'
import type { FilterState } from '@/components/FilterBar'
import { cn } from '@/lib/utils'

interface AuditChange { field: string; old: unknown; new: unknown }
interface AuditEntry {
  id: number
  user_id: number | null
  user_name: string | null
  action: string
  action_label?: string
  category?: string
  summary?: string
  entity_type: string
  entity_label?: string
  entity_id: number | null
  entity_name: string | null
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  changes?: AuditChange[]
  details: string | null
  ip_address: string | null
  timestamp: string
}
interface Option { value: string; label: string; category?: string | null }
interface FilterOptions { actions: Option[]; entity_types: Option[]; users: Option[]; categories: Option[] }
interface Page { items: AuditEntry[]; total: number; total_pages: number }

/** Fallback when the server sends no label: "asset_repair.update" -> "Asset repair update". */
function humanize(raw: string | null | undefined): string {
  const words = (raw ?? '').replace(/[._-]+/g, ' ').trim()
  return words ? words[0].toUpperCase() + words.slice(1).toLowerCase() : 'Activity'
}
const actionLabel = (e: AuditEntry) => e.action_label || humanize(e.action)
const entityLabel = (e: AuditEntry) => e.entity_label || humanize(e.entity_type)
const summaryOf = (e: AuditEntry) => e.summary || (e.entity_name ? `${actionLabel(e)}: ${e.entity_name}` : actionLabel(e))

type Tab = 'all' | 'change' | 'signin' | 'deletion'
const TABS: { id: Tab; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'change', label: 'Changes' }, { id: 'signin', label: 'Sign-ins' }, { id: 'deletion', label: 'Deletions' },
]
const TONE: Record<string, string> = {
  change: 'bg-sky-50 text-sky-700', signin: 'bg-violet-50 text-violet-700', deletion: 'bg-red-50 text-red-700', other: 'bg-gray-100 text-gray-700',
}

function toParams(f: FilterState): Record<string, string | undefined> {
  const when = range(f.timestamp)
  return { user_id: csv(f.user), action: csv(f.action), entity_type: csv(f.entity_type), category: csv(f.category), date_from: when.from, date_to: when.to }
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const dash = <span className="text-gray-400">-</span>

const COLUMNS: Column<AuditEntry>[] = [
  { id: 'timestamp', label: 'When', sort: 'timestamp', render: (e) => <span className="tabular-nums text-gray-500">{when(e.timestamp)}</span> },
  { id: 'user', label: 'Person', sort: 'user', render: (e) => e.user_name ? <span className="font-medium text-gray-900">{e.user_name}</span> : <span className="text-gray-500">System</span> },
  { id: 'activity', label: 'Activity', locked: true, render: (e) => <TitleCell className="max-w-[28rem]" title={summaryOf(e)} sub={e.details && e.details !== summaryOf(e) ? e.details : undefined} /> },
  { id: 'action', label: 'Action', sort: 'action', render: (e) => (
    <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONE[e.category ?? 'other'] ?? TONE.other)}>{actionLabel(e)}</span>) },
  { id: 'entity_type', label: 'Area', sort: 'entity_type', render: (e) => <Badge variant="secondary">{entityLabel(e)}</Badge> },
  { id: 'entity_name', label: 'Item', sort: 'entity_name', render: (e) => e.entity_name ? <span className="block max-w-[16rem] truncate">{e.entity_name}</span> : dash },
  { id: 'changes', label: 'Changes', render: (e) => {
    const n = e.changes?.length ?? 0
    return n ? <span className="text-xs text-gray-500">{n === 1 ? `${e.changes![0].field} changed` : `${n} fields changed`}</span> : dash
  } },
  { id: 'ip_address', label: 'IP address', render: (e) => e.ip_address ? <span className="font-mono text-xs">{e.ip_address}</span> : dash },
]
const SORTS: SortDef[] = [
  { id: 'timestamp', label: 'Time', kind: 'date' }, { id: 'user', label: 'Person' }, { id: 'action', label: 'Action' },
  { id: 'entity_type', label: 'Area' }, { id: 'entity_name', label: 'Item' },
]

export default function AuditLogs() {
  const t = useTableState({ key: 'audit', defaultSort: 'timestamp', defaultOrder: 'desc', defaultColumns: ['timestamp', 'user', 'action', 'entity_type', 'changes'] })
  const [open, setOpen] = useState<AuditEntry | null>(null)

  const { data: opts } = useQuery<FilterOptions>({ queryKey: ['audit-logs', 'filters'], queryFn: async () => (await api.get('/audit-logs/filters')).data, staleTime: 60_000 })
  const fields = useMemo(() => [
    filterField('user', 'Person', 'select', opts?.users ?? []),
    filterField('action', 'Action', 'select', opts?.actions ?? []),
    filterField('entity_type', 'Area', 'select', opts?.entity_types ?? []),
    filterField('timestamp', 'Date', 'date'),
  ], [opts])

  const panel = toParams(t.filters)
  const params = {
    ...panel, category: t.tab !== 'all' ? t.tab : undefined, q: t.search || undefined,
    page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order,
  }
  const { data, isLoading, isFetching, error } = useQuery<Page>({
    queryKey: ['audit-logs', params],
    queryFn: async () => (await api.get('/audit-logs', { params })).data,
    placeholderData: (prev) => prev,
    retry: 1,
  })
  const filtered = !!t.search || Object.keys(t.filters).length > 0 || t.tab !== 'all'

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold">Audit logs</h2>
        <p className="mt-1 text-sm text-gray-500">Who did what, across the whole app. Click an entry to see exactly what changed.</p>
      </div>

      <TableTabs tabs={TABS} value={t.tab} onChange={t.setTab} />

      <TableToolbar state={t} searchPlaceholder="Item, person or detail…" filterFields={fields} sorts={SORTS} columns={COLUMNS} />

      <DataTable rows={data?.items ?? []} rowKey={(e) => e.id} columns={COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null} onRowClick={setOpen}
        empty={<EmptyRows icon={<ScrollText className="h-9 w-9" />} title={filtered ? 'No entries match' : 'No activity yet'} hint={filtered ? 'Try another tab or clear the filters.' : undefined} />}
        pager={{ page: t.page, pages: data?.total_pages ?? 1, total: data?.total ?? 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'entries' }} />

      {open && <AuditDetail entry={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

/** A value as plain text: lists joined, objects as "key: value", empty as a dash. */
function show(v: unknown): ReactNode {
  if (v === null || v === undefined || v === '') return <span className="text-gray-400">empty</span>
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (Array.isArray(v)) return v.length ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ') : <span className="text-gray-400">none</span>
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>
    if ('value' in o && Object.keys(o).length === 1) return show(o.value)
    return Object.entries(o).map(([k, x]) => `${humanize(k)}: ${typeof x === 'object' && x !== null ? JSON.stringify(x) : String(x ?? '')}`).join('; ')
  }
  return String(v)
}

/** Fallback when the server sends no change list. */
function localChanges(e: AuditEntry): AuditChange[] {
  if (e.changes) return e.changes
  const o = e.old_values ?? {}, n = e.new_values ?? {}
  return [...new Set([...Object.keys(o), ...Object.keys(n)])]
    .filter((k) => JSON.stringify(o[k]) !== JSON.stringify(n[k]))
    .map((k) => ({ field: humanize(k), old: o[k], new: n[k] }))
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="grid grid-cols-[7rem_1fr] gap-3 py-1.5 text-sm"><dt className="text-gray-500">{label}</dt><dd className="min-w-0 break-words text-gray-900">{children}</dd></div>
}

function AuditDetail({ entry: e, onClose }: { entry: AuditEntry; onClose: () => void }) {
  const changes = localChanges(e)
  return (
    <Modal size="lg" title={summaryOf(e)} subtitle={`${e.user_name || 'System'}, ${when(e.timestamp)}`} onClose={onClose}>
      <div className="space-y-5">
        <dl className="divide-y divide-gray-100">
          <Row label="Action"><span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', TONE[e.category ?? 'other'] ?? TONE.other)}>{actionLabel(e)}</span></Row>
          <Row label="Area">{entityLabel(e)}</Row>
          {e.entity_name && <Row label="Item">{e.entity_name}</Row>}
          <Row label="Person">{e.user_name || 'System (automatic job)'}</Row>
          <Row label="When">{new Date(e.timestamp).toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })}</Row>
          {e.details && <Row label="Details">{e.details}</Row>}
          {e.ip_address && <Row label="IP address"><span className="font-mono text-xs">{e.ip_address}</span></Row>}
        </dl>
        {changes.length > 0 && (
          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-gray-500">What changed</h3>
            <ul className="divide-y rounded-lg border">
              {changes.map((c, i) => (
                <li key={`${c.field}-${i}`} className="grid gap-1 px-3 py-2 text-sm sm:grid-cols-[10rem_1fr]">
                  <span className="font-medium text-gray-700">{c.field}</span>
                  <span className="flex min-w-0 flex-wrap items-center gap-1.5 break-words">
                    {c.old !== null && c.old !== undefined && c.old !== '' && <><span className="text-gray-500 line-through decoration-gray-300">{show(c.old)}</span><ArrowRight className="h-3.5 w-3.5 shrink-0 text-gray-400" /></>}
                    <span className="text-gray-900">{show(c.new)}</span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  )
}
