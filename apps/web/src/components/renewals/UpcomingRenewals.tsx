import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BellOff, BellRing, CalendarClock, CalendarDays, ExternalLink, LayoutList, RefreshCw, Repeat, Rows3, Settings2 } from 'lucide-react'
import { formatDate } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import RowMenu from '@/components/ui/menu'
import TypeIcon from '@/components/TypeIcon'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, TitleCell, clientRows, filterField,
  type Column, type SortDef, type TableState,
} from '@/components/data-table'
import { cn } from '@/lib/utils'
import type { RecordType } from '@/types'
import RenewDialog from './RenewDialog'
import { DuePill, intervalLabel, money, type UpcomingItem, type UpcomingResponse } from './shared'

export type UpcomingTab = 'all' | 'overdue' | 'week' | 'month' | 'auto' | 'manual'
export const UPCOMING_TABS: { id: UpcomingTab; label: string; test: (i: UpcomingItem) => boolean; tone?: string }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'overdue', label: 'Overdue', test: (i) => i.days_remaining < 0, tone: 'text-red-700' },
  { id: 'week', label: 'This week', test: (i) => i.days_remaining >= 0 && i.days_remaining <= 7, tone: 'text-amber-700' },
  { id: 'month', label: 'Next 30 days', test: (i) => i.days_remaining >= 0 && i.days_remaining <= 30 },
  { id: 'auto', label: 'Auto-renew on', test: (i) => i.auto_renew === true },
  { id: 'manual', label: 'Renew manually', test: (i) => i.auto_renew !== true && !i.will_auto_renew },
]
const WINDOWS = [30, 60, 90, 180, 365]
const dash = <span className="text-gray-400">-</span>

function ReminderCell({ item }: { item: UpcomingItem }) {
  if (item.will_auto_renew) {
    return <span className="inline-flex items-center gap-1 text-emerald-700"><Repeat className="h-3.5 w-3.5" />Auto-renews {item.auto_renew_date ? formatDate(item.auto_renew_date) : ''}</span>
  }
  if (item.days_remaining < 0) return <span className="text-red-600">Past due, no more reminders</span>
  if (!item.next_reminder) return <span className="inline-flex items-center gap-1 text-gray-400"><BellOff className="h-3.5 w-3.5" />No rule left</span>
  return (
    <span className="inline-flex items-center gap-1">
      <BellRing className="h-3.5 w-3.5 text-primary" />
      <span className="tabular-nums">{formatDate(item.next_reminder.date)}</span>
      <span className="text-gray-400">({intervalLabel(item.next_reminder.days_before)})</span>
    </span>
  )
}

const COLUMNS: Column<UpcomingItem>[] = [
  { id: 'record', label: 'Record', sort: 'name', locked: true, render: (i) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border bg-gray-50"><TypeIcon icon={i.record_type_icon} className="h-4 w-4 text-gray-500" /></span>
      <TitleCell title={i.name} sub={i.record_type_name} />
    </div>
  ) },
  { id: 'due', label: 'Due', sort: 'days_remaining', render: (i) => <DuePill days={i.days_remaining} /> },
  { id: 'expiry', label: 'Expiry date', sort: 'expiry_date', render: (i) => <span className="tabular-nums">{formatDate(i.expiry_date)}</span> },
  { id: 'reminder', label: 'Next reminder', sort: 'next_reminder', render: (i) => <ReminderCell item={i} /> },
  { id: 'auto_renew', label: 'Auto-renew', sort: 'auto_renew', render: (i) => i.auto_renew === null ? dash
    : <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', i.auto_renew ? 'text-emerald-700' : 'text-gray-500')}>
      <span className={cn('h-1.5 w-1.5 rounded-full', i.auto_renew ? 'bg-emerald-500' : 'bg-gray-300')} />{i.auto_renew ? 'On' : 'Off'}</span> },
  { id: 'type', label: 'Type', sort: 'record_type', render: (i) => i.record_type_name },
  { id: 'cycle', label: 'Billing cycle', sort: 'cycle', render: (i) => (i.cycle ? String(i.cycle) : dash) },
  { id: 'cost', label: 'Cost', sort: 'cost', align: 'right', render: (i) => money(i.cost, i.currency) ?? dash },
]
const SORTS: SortDef[] = [
  { id: 'expiry_date', label: 'Expiry date', kind: 'date' }, { id: 'days_remaining', label: 'Days left', kind: 'number' },
  { id: 'name', label: 'Record name' }, { id: 'record_type', label: 'Record type' }, { id: 'next_reminder', label: 'Next reminder', kind: 'date' },
  { id: 'auto_renew', label: 'Auto-renew' }, { id: 'cost', label: 'Cost', kind: 'number' },
]

function get(i: UpcomingItem, slug: string): unknown {
  switch (slug) {
    case 'record_type': return i.record_type_name
    case 'auto_renew': return i.auto_renew
    case 'has_reminder': return !!i.next_reminder
    case 'next_reminder': return i.next_reminder?.date ?? null
    case 'cost': return i.cost == null || i.cost === '' ? null : Number(i.cost)
    default: return (i as unknown as Record<string, unknown>)[slug]
  }
}

const GROUPS: { id: string; label: string; hint: string; test: (d: number) => boolean; dot: string }[] = [
  { id: 'overdue', label: 'Overdue', hint: 'Expired and not renewed yet', test: (d) => d < 0, dot: 'bg-red-500' },
  { id: 'week', label: 'This week', hint: 'Due in the next 7 days', test: (d) => d >= 0 && d <= 7, dot: 'bg-amber-500' },
  { id: 'month', label: 'This month', hint: 'Due in 8 to 30 days', test: (d) => d > 7 && d <= 30, dot: 'bg-sky-500' },
  { id: 'later', label: 'Later', hint: 'More than 30 days away', test: (d) => d > 30, dot: 'bg-gray-400' },
]

const readView = () => { try { return localStorage.getItem('renewals-view') === 'table' ? 'table' : 'timeline' } catch { return 'timeline' } }

export default function UpcomingRenewals({ state: t, data, loading, fetching, error, windowDays, onWindow, recordTypes, canRenew, onRules, onRenewed }: {
  state: TableState
  data?: UpcomingResponse
  loading: boolean
  fetching: boolean
  error: string | null
  windowDays: number
  onWindow: (n: number) => void
  recordTypes: RecordType[]
  canRenew: boolean
  onRules: (typeId: number) => void
  onRenewed: () => void
}) {
  const navigate = useNavigate()
  const [view, setViewState] = useState<'timeline' | 'table'>(readView)
  const [renewing, setRenewing] = useState<UpcomingItem | null>(null)
  const setView = (v: 'timeline' | 'table') => { setViewState(v); try { localStorage.setItem('renewals-view', v) } catch { /* storage unavailable */ } }

  const fields = useMemo(() => [
    filterField('record_type', 'Record type', 'select', recordTypes.filter((rt) => rt.reminder_field_id).map((rt) => rt.name)),
    filterField('auto_renew', 'Auto-renew on', 'boolean'),
    filterField('has_reminder', 'Has a reminder scheduled', 'boolean'),
    filterField('expiry_date', 'Expiry date', 'date'),
    filterField('days_remaining', 'Days left', 'integer'),
    filterField('cost', 'Cost', 'currency'),
  ], [recordTypes])

  const items = useMemo(() => data?.items ?? [], [data])
  const tab = UPCOMING_TABS.find((x) => x.id === t.tab) ?? UPCOMING_TABS[0]
  const counts = useMemo(() => Object.fromEntries(UPCOMING_TABS.map((x) => [x.id, items.filter(x.test).length])), [items])
  const result = useMemo(() => clientRows(items.filter(tab.test), t, fields, get, (i) => `${i.name} ${i.record_type_name} ${i.cycle ?? ''}`),
    [items, tab, t, fields])
  const open = (i: UpcomingItem) => navigate(`/records/${i.record_type_slug}/${i.id}`)
  const filtered = !!t.search || Object.keys(t.filters).length > 0 || tab.id !== 'all'

  const actions = (i: UpcomingItem): ReactNode => (
    <RowMenu items={[
      { label: 'Open record', icon: <ExternalLink />, onSelect: () => open(i) },
      { label: 'Renew…', icon: <RefreshCw />, onSelect: () => setRenewing(i), hidden: !canRenew },
      { label: 'Reminder rules for this type', icon: <Settings2 />, onSelect: () => onRules(i.record_type_id), divider: true },
    ]} />
  )

  const empty = (
    <EmptyRows icon={<CalendarDays className="h-9 w-9" />}
      title={filtered ? 'Nothing matches' : `No renewals in the next ${windowDays} days`}
      hint={filtered ? 'Try another tab or clear the filters.' : 'Widen the window above, or set a renewal/expiry field on a record type so its records show up here.'} />
  )

  return (
    <div className="flex min-h-0 flex-col gap-3">
      <TableTabs tabs={UPCOMING_TABS.map((x) => ({ id: x.id, label: x.label, count: data ? counts[x.id] : null, tone: x.tone }))} value={t.tab} onChange={t.setTab} />
      <TableToolbar state={t} searchPlaceholder="Record, type, cycle…" filterFields={fields} sorts={SORTS} columns={view === 'table' ? COLUMNS : undefined}>
        <div className="w-36">
          <Select aria-label="Window" value={String(windowDays)} onChange={(e) => onWindow(Number(e.target.value))}>
            {WINDOWS.map((w) => <option key={w} value={w}>Next {w} days</option>)}
          </Select>
        </div>
        <div className="flex rounded-md border p-0.5" role="group" aria-label="Layout">
          {([['timeline', LayoutList, 'Timeline'], ['table', Rows3, 'Table']] as const).map(([id, Icon, label]) => (
            <button key={id} type="button" onClick={() => setView(id)} aria-pressed={view === id} title={label}
              className={cn('press flex items-center gap-1 rounded px-2 py-1 text-xs font-medium', view === id ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-800')}>
              <Icon className="h-3.5 w-3.5" /><span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>
      </TableToolbar>
      {data?.truncated && <p className="text-xs text-amber-700">Showing the nearest renewals only. Narrow the window or filter by type to see the rest.</p>}

      {view === 'table' ? (
        <DataTable rows={result.rows} rowKey={(i) => i.id} columns={COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
          loading={loading} fetching={fetching} error={error} onRowClick={open} actions={actions} empty={empty}
          rowClassName={(i) => i.days_remaining < 0 && 'bg-red-50/40'}
          pager={{ page: t.page, pages: result.pages, total: result.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'renewals' }} />
      ) : (
        <Timeline rows={result.all} loading={loading} error={error} empty={empty} onOpen={open} onRenew={canRenew ? setRenewing : undefined} actions={actions} />
      )}

      {renewing && <RenewDialog item={renewing} onClose={() => setRenewing(null)} onDone={onRenewed} />}
    </div>
  )
}

function Timeline({ rows, loading, error, empty, onOpen, onRenew, actions }: {
  rows: UpcomingItem[]; loading: boolean; error: string | null; empty: ReactNode
  onOpen: (i: UpcomingItem) => void; onRenew?: (i: UpcomingItem) => void; actions: (i: UpcomingItem) => ReactNode
}) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  if (loading) return <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="h-16 animate-pulse rounded-xl bg-gray-100" />)}</div>
  if (error) return <div className="rounded-xl border bg-white p-6 text-center text-sm text-red-600">{error}</div>
  if (!rows.length) return <div className="rounded-xl border bg-white">{empty}</div>
  return (
    <div className="space-y-5">
      {GROUPS.map((g) => {
        const list = rows.filter((r) => g.test(r.days_remaining))
        if (!list.length) return null
        const shown = expanded[g.id] ? list : list.slice(0, 8)
        return (
          <section key={g.id} className="animate-page-in">
            <div className="mb-2 flex items-baseline gap-2">
              <span className={cn('h-2 w-2 shrink-0 rounded-full', g.dot)} />
              <h3 className="text-sm font-semibold text-gray-900">{g.label}</h3>
              <span className="text-xs tabular-nums text-gray-400">{list.length}</span>
              <span className="hidden text-xs text-gray-400 sm:inline">{g.hint}</span>
            </div>
            <ol className="relative space-y-2 border-l border-gray-200 pl-4 sm:pl-5">
              {shown.map((i) => (
                <li key={i.id} className="relative">
                  <span className={cn('absolute -left-[21px] top-5 h-2.5 w-2.5 rounded-full border-2 border-white sm:-left-[25px]', g.dot)} aria-hidden />
                  <div role="button" tabIndex={0} onClick={() => onOpen(i)} onKeyDown={(e) => { if (e.key === 'Enter') onOpen(i) }}
                    className="card-hover flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border bg-white px-3 py-2.5 sm:flex-nowrap sm:px-4">
                    <div className="hidden w-14 shrink-0 text-center sm:block">
                      <div className="text-[11px] font-medium uppercase text-gray-400">{new Date(`${i.expiry_date}T00:00:00`).toLocaleDateString(undefined, { month: 'short' })}</div>
                      <div className="text-lg font-semibold leading-tight tabular-nums text-gray-900">{i.expiry_date.slice(8, 10)}</div>
                    </div>
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border bg-gray-50"><TypeIcon icon={i.record_type_icon} className="h-4 w-4 text-gray-500" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-gray-900">{i.name}</p>
                      <p className="truncate text-xs text-gray-500">
                        {i.record_type_name}<span className="sm:hidden"> · {formatDate(i.expiry_date)}</span>
                        {money(i.cost, i.currency) && <> · {money(i.cost, i.currency)}</>}
                      </p>
                    </div>
                    <div className="hidden min-w-0 text-xs text-gray-600 lg:block"><ReminderCell item={i} /></div>
                    <DuePill days={i.days_remaining} />
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {onRenew && !i.will_auto_renew && (
                        <Button size="sm" variant="outline" className="press h-8" onClick={() => onRenew(i)}><RefreshCw className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Renew</span></Button>
                      )}
                      {actions(i)}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {list.length > shown.length && (
              <button className="press ml-4 mt-2 text-xs font-medium text-primary hover:underline sm:ml-5" onClick={() => setExpanded({ ...expanded, [g.id]: true })}>
                Show {list.length - shown.length} more
              </button>
            )}
          </section>
        )
      })}
      <p className="flex items-center gap-1.5 text-xs text-gray-400"><CalendarClock className="h-3.5 w-3.5" />Reminders go out on the date shown, through Telegram.</p>
    </div>
  )
}
