import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Bot, ChevronDown, History, RotateCcw } from 'lucide-react'
import { errorMessage, useApi, useEntityHistory, type HistoryChange, type HistoryEntity, type HistoryEntry } from '@workspace/core'
import { Button } from '@/components/ui/button'
import Modal from '@/components/ui/modal'
import Avatar from '@/components/ui/avatar'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'

const SUBJECT: Record<HistoryEntity, string> = { asset: 'This asset', record: 'This record', employee: 'This employee' }
const SHOWN_CHANGES = 3

/** Query keys refreshed after a restore, so the page around the timeline shows the restored values. */
const AFTER_RESTORE: Record<HistoryEntity, string[]> = {
  asset: ['asset', 'assets', 'asset-summary', 'employee-overview'],
  record: ['record', 'records', 'records-summary', 'dashboard'],
  employee: ['employee-overview', 'employees'],
}

function show(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'empty'
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  if (Array.isArray(value)) return value.length ? value.map((v) => show(v)).join(', ') : 'empty'
  if (typeof value === 'object') {
    const parts = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== null && v !== '')
    return parts.length ? parts.map(([k, v]) => `${k}: ${show(v)}`).join(', ') : 'empty'
  }
  const text = String(value)
  return /^\d{4}-\d{2}-\d{2}T/.test(text) ? new Date(text).toLocaleString() : text
}

function relative(iso: string): string {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000
  const fmt = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [number, Intl.RelativeTimeFormatUnit][] = [[60, 'second'], [60, 'minute'], [24, 'hour'], [7, 'day'], [4.35, 'week'], [12, 'month']]
  let value = -diff
  for (const [size, unit] of steps) {
    if (Math.abs(value) < size) return fmt.format(Math.round(value), unit)
    value /= size
  }
  return fmt.format(Math.round(value), 'year')
}

function exact(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function ChangeChip({ change }: { change: HistoryChange }) {
  const before = show(change.before)
  const after = show(change.after)
  const created = change.before === null || change.before === undefined
  return (
    <li className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-md border bg-gray-50 px-2 py-1 text-xs">
      <span className="font-medium text-gray-700">{change.label}:</span>
      {!created && <span className="max-w-[16rem] truncate text-gray-400 line-through" title={before}>{before}</span>}
      {!created && <ArrowRight className="h-3 w-3 shrink-0 text-gray-400" aria-label="changed to" />}
      <span className="max-w-[16rem] truncate text-gray-900" title={after}>{after}</span>
    </li>
  )
}

function linkTo(entry: HistoryEntry): string | null {
  if (!entry.link) return null
  if (entry.link.type === 'asset') return `/assets/${entry.link.id}`
  if (entry.link.type === 'record') return `/records/${entry.link.slug || 'records'}/${entry.link.id}`
  return null
}

function Entry({ entry, entity, last, canRestore, onRestore }: {
  entry: HistoryEntry; entity: HistoryEntity; last: boolean; canRestore: boolean; onRestore: (e: HistoryEntry) => void
}) {
  const [open, setOpen] = useState(false)
  const changes = open ? entry.changes : entry.changes.slice(0, SHOWN_CHANGES)
  const hidden = entry.changes.length - SHOWN_CHANGES
  const actor = entry.actor_name || (entry.actor_id ? 'A former user' : 'System')
  const href = linkTo(entry)
  const showDetails = entry.details && entry.changes.length === 0
  return (
    <li className="relative flex gap-3 pb-5 last:pb-0">
      {!last && <span className="absolute bottom-0 left-[15px] top-9 w-px bg-gray-200" aria-hidden />}
      {entry.actor_name ? <Avatar name={entry.actor_name} size="sm" /> : (
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          {entry.subject ? <History className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1 text-sm text-gray-700">
            <span className="font-medium text-gray-900">{entry.subject ? SUBJECT[entity] : actor}</span>{' '}
            {href ? <Link to={href} className="hover:underline">{entry.summary}</Link> : entry.summary}
          </p>
          {canRestore && entry.restorable && (
            <Button variant="ghost" size="xs" className="press shrink-0" onClick={() => onRestore(entry)}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" />Restore this version
            </Button>
          )}
        </div>
        <p className="text-xs text-gray-500">
          <time dateTime={entry.timestamp} title={exact(entry.timestamp)}>{relative(entry.timestamp)}</time>
          <span className="text-gray-400"> · {exact(entry.timestamp)}</span>
          {entry.subject && entry.actor_name && <span className="text-gray-400"> · recorded by {entry.actor_name}</span>}
        </p>
        {showDetails && <p className="mt-1 text-xs text-gray-500">{entry.details}</p>}
        {changes.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {changes.map((c) => <ChangeChip key={c.field} change={c} />)}
            {hidden > 0 && (
              <li>
                <button type="button" onClick={() => setOpen((v) => !v)} className="press inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-primary-soft">
                  {open ? 'Show less' : `Show ${hidden} more`}
                  <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                </button>
              </li>
            )}
          </ul>
        )}
      </div>
    </li>
  )
}

function RestoreDialog({ entity, id, entry, onClose }: { entity: HistoryEntity; id: number; entry: HistoryEntry; onClose: () => void }) {
  const api = useApi()
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState('')
  const check = useQuery({
    queryKey: ['entity-history-preview', entity, id, entry.audit_id],
    queryFn: () => api.history.previewRestore(entity, id, entry.audit_id as number),
    enabled: !!entry.audit_id, gcTime: 0, staleTime: 0, retry: false,
  })
  const preview = check.data?.changes ?? null
  const error = failed || (check.error ? errorMessage(check.error, 'Could not load this version') : '')
  const restore = async () => {
    if (!entry.audit_id) return
    setBusy(true)
    try {
      await api.history.restore(entity, id, entry.audit_id)
      await Promise.all([...AFTER_RESTORE[entity], 'entity-history'].map((k) => qc.invalidateQueries({ queryKey: [k] })))
      toast.success('Previous version restored')
      onClose()
    } catch (e) {
      setFailed(errorMessage(e, 'Could not restore this version'))
    } finally {
      setBusy(false)
    }
  }
  const nothing = preview !== null && preview.length === 0
  return (
    <Modal title="Restore this version?" subtitle={`Saved ${exact(entry.timestamp)}${entry.actor_name ? ` by ${entry.actor_name}` : ''}`} onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={restore} disabled={busy || !preview || nothing}>{busy ? 'Restoring…' : 'Restore'}</Button>
      </>}>
      <p className="text-sm text-gray-600">These fields go back to how they were right after this change. Everything else stays as it is, and the restore is added to the history.</p>
      {error && <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {!preview && !error && <p className="mt-4 text-sm text-gray-400">Checking what will change…</p>}
      {nothing && <p className="mt-4 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-600">The current values already match this version.</p>}
      {preview && preview.length > 0 && (
        <ul className="mt-4 divide-y rounded-lg border">
          {preview.map((c) => (
            <li key={c.field} className="grid grid-cols-[minmax(0,8rem)_1fr] gap-3 px-3 py-2 text-sm">
              <span className="truncate font-medium text-gray-700" title={c.label}>{c.label}</span>
              <span className="min-w-0 break-words">
                <span className="text-gray-400 line-through">{show(c.before)}</span>
                <ArrowRight className="mx-1.5 inline h-3.5 w-3.5 text-gray-400" aria-label="becomes" />
                <span className="font-medium text-gray-900">{show(c.after)}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  )
}

/** Vertical activity timeline for one asset, record or employee, with "restore this version". */
export default function EntityHistory({ entity, id, className }: { entity: HistoryEntity; id: number; className?: string }) {
  const [kind, setKind] = useState('')
  const [restoring, setRestoring] = useState<HistoryEntry | null>(null)
  const all = useEntityHistory(entity, id)
  const filtered = useEntityHistory(entity, id, kind || undefined)
  const query = kind ? filtered : all
  const first = all.data?.pages[0]
  const kinds = first?.kinds ?? []
  const total = kinds.reduce((n, k) => n + k.count, 0)
  const entries = query.data?.pages.flatMap((p) => p.items) ?? []
  const canRestore = !!first?.can_restore

  return (
    <section className={cn('rounded-xl border bg-white', className)}>
      {kinds.length > 1 && (
        <div className="flex flex-wrap gap-1.5 border-b px-4 py-3" role="tablist" aria-label="Filter history">
          {[{ key: '', label: 'All', count: total }, ...kinds].map((k) => (
            <button key={k.key || 'all'} type="button" role="tab" aria-selected={kind === k.key} onClick={() => setKind(k.key)}
              className={cn('press inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium',
                kind === k.key ? 'border-primary bg-primary-soft text-primary' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
              {k.label}<span className="tabular-nums text-gray-400">{k.count}</span>
            </button>
          ))}
        </div>
      )}
      <div className="px-4 py-4">
        {query.isLoading ? <p className="py-6 text-center text-sm text-gray-400">Loading history…</p>
          : query.error ? <p className="py-6 text-center text-sm text-red-600">{errorMessage(query.error, 'Could not load history')}</p>
          : entries.length === 0 ? <p className="py-6 text-center text-sm text-gray-400">No activity yet.</p>
          : (
            <ol className="animate-page-in">
              {entries.map((e, i) => (
                <Entry key={e.id} entry={e} entity={entity} last={i === entries.length - 1} canRestore={canRestore} onRestore={setRestoring} />
              ))}
            </ol>
          )}
        {query.hasNextPage && (
          <div className="mt-4 flex justify-center">
            <Button variant="outline" size="sm" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
              {query.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </Button>
          </div>
        )}
      </div>
      {restoring && <RestoreDialog entity={entity} id={id} entry={restoring} onClose={() => setRestoring(null)} />}
    </section>
  )
}
