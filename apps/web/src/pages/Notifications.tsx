import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { AlertTriangle, Bot, CheckCircle2, Clock, Pencil, Plus, RefreshCw, Send, Trash2, XCircle, BellRing } from 'lucide-react'
import api from '@/lib/api'
import { toast } from '@/components/ui/toaster'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Modal from '@/components/ui/modal'
import RowMenu from '@/components/ui/menu'
import Avatar from '@/components/ui/avatar'
import Combobox from '@/components/ui/combobox'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, TitleCell, clientRows, csv, filterField, range, useTableState,
  type Column, type SortDef, type TableState,
} from '@/components/data-table'
import { cn } from '@/lib/utils'
import { apiError } from '@/lib/seats'
import { useAuthStore } from '../store/auth'
import type { NotificationRecipient, RecordType, TelegramBot } from '../types'

interface ReminderLog {
  id: number
  record_id: number
  record_name: string | null
  record_type_slug: string | null
  record_type_name: string | null
  rule_name: string | null
  days_before: number | null
  recipient_name: string | null
  scheduled_date: string
  sent_at: string | null
  status: string
  error_message: string | null
  retry_count: number
}

interface Health {
  workers: Record<string, { healthy: boolean; last_success: string | null }>
  counts: Record<string, number>
  attention: string[]
}

type Section = 'activity' | 'recipients' | 'bots'

const STATUS_META: Record<string, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  sent: { icon: CheckCircle2, tone: 'text-emerald-700 bg-emerald-50', label: 'Delivered' },
  failed: { icon: XCircle, tone: 'text-red-700 bg-red-50', label: 'Failed' },
  pending: { icon: Clock, tone: 'text-amber-700 bg-amber-50', label: 'Queued' },
  processing: { icon: Clock, tone: 'text-amber-700 bg-amber-50', label: 'Sending' },
  retry: { icon: Clock, tone: 'text-amber-700 bg-amber-50', label: 'Retrying' },
}
/** Delivery tabs: the status cards at the top pick one. */
const STATUS_TABS: Record<string, string | undefined> = { all: undefined, sent: 'sent', pending: 'pending,processing,retry', failed: 'failed' }
const STATUS_CHOICES = [{ value: 'sent', label: 'Delivered' }, { value: 'failed', label: 'Failed' }, { value: 'pending', label: 'Queued' }, { value: 'processing', label: 'Sending' }, { value: 'retry', label: 'Retrying' }]

const dash = <span className="text-gray-400">-</span>
const when = (l: ReminderLog) => l.sent_at || l.scheduled_date
const fmtWhen = (iso: string) => new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.pending
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', m.tone)}><m.icon className="h-3 w-3" />{m.label}</span>
}
const ActivePill = ({ active, off = 'Paused' }: { active: boolean; off?: string }) => (
  <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-500')}>{active ? 'Active' : off}</span>
)

export default function Notifications() {
  const qc = useQueryClient()
  const { hasPermission, user } = useAuthStore()
  const [section, setSection] = useState<Section>('activity')
  const [recipientForm, setRecipientForm] = useState<NotificationRecipient | 'new' | null>(null)
  const [botForm, setBotForm] = useState<TelegramBot | 'new' | null>(null)
  const canManageBots = hasPermission('reminder.create')
  const canEditBots = hasPermission('reminder.edit')
  const canDeleteBots = hasPermission('reminder.delete')
  const canManageRecipients = !!user?.is_superuser
  const deliveries = useTableState({ key: 'deliveries', defaultSort: 'scheduled_date', defaultOrder: 'desc', defaultColumns: ['status', 'timing', 'recipient', 'when'] })

  const { data: health, isFetching } = useQuery<Health>({
    queryKey: ['notification-health', user?.id],
    queryFn: async () => (await api.get('/operations/notifications')).data,
    refetchInterval: 30_000,
  })
  const { data: bots = [] } = useQuery<TelegramBot[]>({ queryKey: ['telegram-bots'], queryFn: async () => (await api.get('/reminders/bots')).data })
  const { data: recipients = [] } = useQuery<NotificationRecipient[]>({
    queryKey: ['recipients'],
    queryFn: async () => (await api.get('/reminders/recipients?active_only=false')).data,
  })

  const workersOk = health ? Object.values(health.workers).every((w) => w.healthy) : true
  const counts = health?.counts || {}
  const stats: { id: string; label: string; value: number; icon: typeof CheckCircle2; tone: string }[] = [
    { id: 'sent', label: 'Delivered', value: counts.sent || 0, icon: CheckCircle2, tone: 'text-emerald-600' },
    { id: 'pending', label: 'Queued', value: (counts.pending || 0) + (counts.processing || 0) + (counts.retry || 0), icon: Clock, tone: 'text-amber-600' },
    { id: 'failed', label: 'Failed', value: counts.failed || 0, icon: XCircle, tone: 'text-red-600' },
  ]

  const refresh = () => ['reminder-logs', 'notification-health', 'recipients', 'telegram-bots'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><BellRing className="h-5 w-5 text-gray-600" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">Notifications</h1>
            <p className="truncate text-sm text-gray-500">Telegram alerts for renewals that need a human. Auto-renewing records don't send alerts.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className={cn('h-3.5 w-3.5 sm:mr-1.5', isFetching && 'animate-spin')} /><span className="hidden sm:inline">Refresh</span></Button>
          {section === 'recipients' && canManageRecipients && <Button size="sm" onClick={() => setRecipientForm('new')}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add recipient</span></Button>}
          {section === 'bots' && canManageBots && <Button size="sm" onClick={() => setBotForm('new')}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add bot</span></Button>}
        </div>
      </div>

      {/* Health + delivery presets */}
      <div className="grid shrink-0 grid-cols-2 gap-3 md:grid-cols-4">
        <div className={cn('col-span-2 flex items-center gap-3 rounded-xl border p-4 md:col-span-1', workersOk ? 'bg-white' : 'border-amber-200 bg-amber-50')}>
          <span className="relative flex h-3 w-3">
            <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60', workersOk ? 'animate-ping bg-emerald-400' : 'bg-amber-400')} />
            <span className={cn('relative inline-flex h-3 w-3 rounded-full', workersOk ? 'bg-emerald-500' : 'bg-amber-500')} />
          </span>
          <div>
            <p className="text-sm font-semibold">{workersOk ? 'Sending normally' : 'Needs attention'}</p>
            <p className="text-xs text-gray-500">{recipients.filter((r) => r.active).length} recipients · {bots.filter((b) => b.active).length} bots</p>
          </div>
        </div>
        {stats.map((s) => (
          <button key={s.id} onClick={() => { setSection('activity'); deliveries.setTab(deliveries.tab === s.id ? 'all' : s.id) }}
            className={cn('press rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-sm', section === 'activity' && deliveries.tab === s.id && 'ring-2 ring-primary/30')}>
            <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><s.icon className={cn('h-3.5 w-3.5', s.tone)} />{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
          </button>
        ))}
      </div>
      {(health?.attention || []).map((m) => (
        <p key={m} className="flex shrink-0 items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{m}</p>
      ))}

      <TableTabs value={section} onChange={(id) => setSection(id as Section)} tabs={[
        { id: 'activity', label: 'Deliveries' }, { id: 'recipients', label: 'Recipients', count: recipients.length }, { id: 'bots', label: 'Bots', count: bots.length },
      ]} />

      {section === 'activity' && <Deliveries t={deliveries} recipients={recipients} />}
      {section === 'recipients' && <Recipients recipients={recipients} bots={bots} canManage={canManageRecipients} onEdit={(r) => setRecipientForm(r)} />}
      {section === 'bots' && <Bots bots={bots} recipients={recipients} canEdit={canEditBots} canDelete={canDeleteBots} onEdit={(b) => setBotForm(b)} />}

      {recipientForm && <RecipientDialog recipient={recipientForm === 'new' ? null : recipientForm} bots={bots} onClose={() => setRecipientForm(null)} />}
      {botForm && <BotDialog bot={botForm === 'new' ? null : botForm} onClose={() => setBotForm(null)} />}
    </div>
  )
}

const DELIVERY_SORTS: SortDef[] = [
  { id: 'scheduled_date', label: 'Date', kind: 'date' }, { id: 'record', label: 'Record' }, { id: 'recipient', label: 'Recipient' },
  { id: 'status', label: 'Status' }, { id: 'retry_count', label: 'Retries', kind: 'number' },
]

function Deliveries({ t, recipients }: { t: TableState; recipients: NotificationRecipient[] }) {
  const { data: types = [] } = useQuery<RecordType[]>({ queryKey: ['record-types'], queryFn: async () => (await api.get('/record-types')).data })
  const f = t.filters
  const day = range(f.when)
  const tabStatus = STATUS_TABS[t.tab]
  const params = {
    page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order, q: t.search || undefined,
    status: tabStatus ?? csv(f.status), record_type_ids: csv(f.record_type), recipient_ids: csv(f.recipient), date_from: day.from, date_to: day.to,
  }
  const { data, isLoading, isFetching, error } = useQuery<{ items: ReminderLog[]; total: number; total_pages: number }>({
    queryKey: ['reminder-logs', params],
    queryFn: async () => (await api.get('/reminders/logs', { params })).data,
    placeholderData: (prev) => prev,
  })
  const fields = useMemo(() => [
    filterField('status', 'Status', 'select', STATUS_CHOICES),
    filterField('record_type', 'Record type', 'select', types.map((x) => ({ value: String(x.id), label: x.name }))),
    filterField('recipient', 'Recipient', 'select', recipients.map((r) => ({ value: String(r.id), label: r.display_name }))),
    filterField('when', 'Date', 'date'),
  ], [types, recipients])
  const columns: Column<ReminderLog>[] = [
    { id: 'record', label: 'Record', sort: 'record', locked: true, render: (l) => (
      <TitleCell title={l.record_type_slug
        ? <Link to={`/records/${l.record_type_slug}/${l.record_id}`} className="hover:text-primary hover:underline" onClick={(e) => e.stopPropagation()}>{l.record_name || 'Deleted record'}</Link>
        : (l.record_name || 'Deleted record')} sub={l.record_type_name ?? undefined} />) },
    { id: 'status', label: 'Status', sort: 'status', render: (l) => <StatusPill status={l.status} /> },
    { id: 'timing', label: 'Alert', render: (l) => l.days_before === 0 ? 'Expires today' : l.days_before != null ? `${l.days_before} day${l.days_before === 1 ? '' : 's'} before` : (l.rule_name || dash) },
    { id: 'recipient', label: 'Recipient', sort: 'recipient', render: (l) => l.recipient_name || <span className="text-gray-400">Removed recipient</span> },
    { id: 'when', label: 'Date', sort: 'scheduled_date', render: (l) => <span className="tabular-nums" title={new Date(when(l)).toLocaleString()}>{fmtWhen(when(l))}</span> },
    { id: 'record_type', label: 'Record type', render: (l) => l.record_type_name || dash },
    { id: 'retries', label: 'Retries', sort: 'retry_count', align: 'right', render: (l) => l.retry_count || dash },
    { id: 'error', label: 'Error', nowrap: false, className: 'max-w-[24rem]', render: (l) => l.error_message ? <span className="line-clamp-2 text-xs text-red-700" title={l.error_message}>{l.error_message}</span> : dash },
  ]
  const filtered = !!t.search || Object.keys(t.filters).length > 0 || t.tab !== 'all'
  return (
    <>
      <TableToolbar state={t} searchPlaceholder="Record, recipient, error…" filterFields={fields} sorts={DELIVERY_SORTS} columns={columns}>
        {t.tab !== 'all' && <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => t.setTab('all')}>Showing {t.tab === 'sent' ? 'delivered' : t.tab === 'pending' ? 'queued' : 'failed'} only. Show all</Button>}
      </TableToolbar>
      <DataTable rows={data?.items ?? []} rowKey={(l) => l.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? apiError(error, 'Could not load deliveries') : null}
        empty={<EmptyRows icon={<BellRing className="h-9 w-9" />} title={filtered ? 'No alerts match' : 'No alerts yet'}
          hint={filtered ? 'Try another status or clear the filters.' : 'Alerts appear here when a record with auto-renew off gets close to its expiry date.'} />}
        pager={{ page: t.page, pages: data?.total_pages || 1, total: data?.total || 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'alerts' }} />
    </>
  )
}

const RECIPIENT_SORTS: SortDef[] = [{ id: 'display_name', label: 'Name' }, { id: 'user_name', label: 'User' }, { id: 'status', label: 'Status' }]
const ACTIVE_CHOICES = [{ value: 'active', label: 'Active' }, { value: 'paused', label: 'Paused' }]

function Recipients({ recipients, bots, canManage, onEdit }: { recipients: NotificationRecipient[]; bots: TelegramBot[]; canManage: boolean; onEdit: (r: NotificationRecipient) => void }) {
  const qc = useQueryClient()
  const t = useTableState({ key: 'recipients', defaultSort: 'display_name', defaultColumns: ['telegram', 'user', 'bots', 'status'] })
  const test = useMutation({
    mutationFn: async (id: number) => (await api.post(`/reminders/recipients/${id}/test`)).data,
    onSuccess: (data: any) => (data.success ? toast.success('Test message delivered') : toast.error(data.error || 'Test failed')),
    onError: (err) => toast.error(apiError(err, 'Test failed')),
  })
  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/reminders/recipients/${id}`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['recipients'] }); toast.success('Recipient removed') },
    onError: (err) => toast.error(apiError(err, 'Could not remove recipient')),
  })
  const toggle = useMutation({
    mutationFn: async (r: NotificationRecipient) => api.put(`/reminders/recipients/${r.id}`, { active: !r.active }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipients'] }),
    onError: (err) => toast.error(apiError(err, 'Could not update recipient')),
  })
  const fields = useMemo(() => [
    filterField('status', 'Status', 'select', ACTIVE_CHOICES),
    filterField('bot', 'Bot', 'select', bots.map((b) => ({ value: String(b.id), label: b.name }))),
    filterField('linked_user', 'Linked to a user', 'boolean'),
  ], [bots])
  const get = (r: NotificationRecipient, slug: string): unknown => ({
    display_name: r.display_name, user_name: r.user_name, status: r.active ? 'active' : 'paused', bot: r.telegram_bot_ids.map(String), linked_user: !!r.user_id,
  } as Record<string, unknown>)[slug]
  const view = clientRows(recipients, t, fields, get, (r) => [r.display_name, r.telegram_username, r.telegram_chat_id, r.user_name, ...(r.telegram_bot_names || [])].join(' '))
  const columns: Column<NotificationRecipient>[] = [
    { id: 'name', label: 'Name', sort: 'display_name', locked: true, render: (r) => (
      <div className="flex items-center gap-2.5"><Avatar name={r.display_name} size="sm" /><TitleCell title={r.display_name} /></div>) },
    { id: 'telegram', label: 'Telegram', render: (r) => <span className="text-gray-600">{r.telegram_username ? `@${r.telegram_username}` : `Chat ${r.telegram_chat_id}`}</span> },
    { id: 'chat_id', label: 'Chat ID', render: (r) => <span className="font-mono text-xs">{r.telegram_chat_id}</span> },
    { id: 'user', label: 'User', sort: 'user_name', render: (r) => r.user_name || dash },
    { id: 'bots', label: 'Bots', render: (r) => (r.telegram_bot_names || []).length
      ? <div className="flex gap-1">{r.telegram_bot_names.map((n) => <span key={n} className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"><Bot className="h-3 w-3" />{n}</span>)}</div> : dash },
    { id: 'status', label: 'Status', sort: 'status', render: (r) => <ActivePill active={r.active} /> },
  ]
  return (
    <>
      <TableToolbar state={t} searchPlaceholder="Name, username, user, bot…" filterFields={fields} sorts={RECIPIENT_SORTS} columns={columns} />
      <DataTable rows={view.rows} rowKey={(r) => r.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        onRowClick={canManage ? onEdit : undefined} rowClassName={(r) => !r.active && 'opacity-60'}
        actions={canManage ? (r) => (
          <div className="flex items-center justify-end gap-1">
            <Button variant="outline" size="sm" className="h-7" disabled={test.isPending && test.variables === r.id} onClick={() => test.mutate(r.id)}>
              <Send className="h-3 w-3 sm:mr-1" /><span className="hidden sm:inline">{test.isPending && test.variables === r.id ? 'Sending…' : 'Send test'}</span>
            </Button>
            <RowMenu items={[
              { label: 'Edit', icon: <Pencil />, onSelect: () => onEdit(r) },
              { label: r.active ? 'Pause alerts' : 'Resume alerts', icon: <BellRing />, onSelect: () => toggle.mutate(r) },
              { label: 'Remove', icon: <Trash2 />, danger: true, divider: true, onSelect: () => { if (confirm(`Remove ${r.display_name}?`)) remove.mutate(r.id) } },
            ]} />
          </div>
        ) : undefined}
        empty={recipients.length ? <EmptyRows icon={<Send className="h-9 w-9" />} title="No recipients match" /> : (
          <EmptyRows icon={<Send className="h-9 w-9" />} title="Nobody receives alerts yet"
            hint={<>Message your bot in Telegram, get your chat ID from <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-primary hover:underline">@userinfobot</a>, then add yourself.</>} />
        )}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'recipients' }} />
    </>
  )
}

const BOT_SORTS: SortDef[] = [{ id: 'name', label: 'Name' }, { id: 'status', label: 'Status' }, { id: 'recipients', label: 'Recipients', kind: 'number' }, { id: 'created_at', label: 'Added', kind: 'date' }]

function Bots({ bots, recipients, canEdit, canDelete, onEdit }: { bots: TelegramBot[]; recipients: NotificationRecipient[]; canEdit: boolean; canDelete: boolean; onEdit: (b: TelegramBot) => void }) {
  const qc = useQueryClient()
  const t = useTableState({ key: 'bots', defaultSort: 'name', defaultColumns: ['token', 'recipients', 'status'] })
  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/reminders/bots/${id}`),
    onSuccess: () => { ['telegram-bots', 'recipients', 'record-types'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Bot removed') },
    onError: (err) => toast.error(apiError(err, 'Could not remove bot')),
  })
  const users = (b: TelegramBot) => recipients.filter((r) => r.telegram_bot_ids.includes(b.id)).length
  const fields = useMemo(() => [filterField('status', 'Status', 'select', [{ value: 'active', label: 'Active' }, { value: 'off', label: 'Off' }])], [])
  const get = (b: TelegramBot, slug: string): unknown => ({ name: b.name, status: b.active ? 'active' : 'off', recipients: users(b), created_at: b.created_at } as Record<string, unknown>)[slug]
  const view = clientRows(bots, t, fields, get, (b) => b.name)
  const columns: Column<TelegramBot>[] = [
    { id: 'name', label: 'Name', sort: 'name', locked: true, render: (b) => (
      <div className="flex items-center gap-2.5"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-sky-50 text-sky-600"><Bot className="h-4 w-4" /></span><TitleCell title={b.name} /></div>) },
    { id: 'token', label: 'Token', render: (b) => <span className="font-mono text-xs text-gray-500">{b.bot_token ? `••••${b.bot_token.slice(-4)}` : 'No token'}</span> },
    { id: 'recipients', label: 'Recipients', sort: 'recipients', align: 'right', render: (b) => users(b) },
    { id: 'status', label: 'Status', sort: 'status', render: (b) => <ActivePill active={b.active} off="Off" /> },
    { id: 'created_at', label: 'Added', sort: 'created_at', render: (b) => <span className="tabular-nums">{new Date(b.created_at).toLocaleDateString()}</span> },
  ]
  return (
    <>
      <TableToolbar state={t} searchPlaceholder="Bot name…" filterFields={fields} sorts={BOT_SORTS} columns={columns} />
      <DataTable rows={view.rows} rowKey={(b) => b.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        onRowClick={canEdit ? onEdit : undefined} rowClassName={(b) => !b.active && 'opacity-60'}
        actions={canEdit || canDelete ? (b) => (
          <RowMenu items={[
            { label: 'Edit', icon: <Pencil />, hidden: !canEdit, onSelect: () => onEdit(b) },
            { label: 'Remove', icon: <Trash2 />, danger: true, hidden: !canDelete, onSelect: () => { if (confirm(`Remove bot "${b.name}"? Recipients and record types using it will need another bot.`)) remove.mutate(b.id) } },
          ]} />
        ) : undefined}
        empty={bots.length ? <EmptyRows icon={<Bot className="h-9 w-9" />} title="No bots match" /> : (
          <EmptyRows icon={<Bot className="h-9 w-9" />} title="No bots yet"
            hint={<>Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-primary hover:underline">@BotFather</a>, then add its token here.</>} />
        )}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'bots' }} />
    </>
  )
}

function RecipientDialog({ recipient, bots, onClose }: { recipient: NotificationRecipient | null; bots: TelegramBot[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    display_name: recipient?.display_name || '',
    telegram_chat_id: recipient?.telegram_chat_id || '',
    telegram_username: recipient?.telegram_username || '',
    bot_ids: recipient?.telegram_bot_ids || (bots.length === 1 ? [bots[0].id] : []),
    user_id: recipient?.user_id ? String(recipient.user_id) : null as string | null,
    active: recipient?.active ?? true,
  })
  const [error, setError] = useState('')
  const { data: users } = useQuery({ queryKey: ['users-for-recipients'], queryFn: async () => (await api.get('/users')).data })
  const userOptions = ((users?.items || []) as { id: number; name: string; email: string }[]).map((u) => ({
    value: String(u.id), label: u.name, sublabel: u.email, keywords: u.email, leading: <Avatar name={u.name} size="sm" />,
  }))
  const save = useMutation({
    mutationFn: async () => {
      const payload = { ...form, telegram_username: form.telegram_username || null, telegram_bot_ids: form.bot_ids, user_id: form.user_id ? Number(form.user_id) : null }
      return recipient ? api.put(`/reminders/recipients/${recipient.id}`, payload) : api.post('/reminders/recipients', payload)
    },
    onSuccess: () => { ['recipients', 'record-types'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success(recipient ? 'Recipient saved' : 'Recipient added'); onClose() },
    onError: (err) => setError(apiError(err, 'Could not save recipient')),
  })
  const submit = () => {
    if (!form.display_name.trim() || !form.telegram_chat_id.trim()) return setError('Name and chat ID are required.')
    if (!form.bot_ids.length) return setError('Pick at least one bot.')
    if (!form.user_id) return setError('Choose which user this Telegram account belongs to.')
    setError('')
    save.mutate()
  }
  return (
    <Modal title={recipient ? 'Edit recipient' : 'Add recipient'} onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={save.isPending} onClick={submit}>{save.isPending ? 'Saving…' : 'Save'}</Button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="space-y-1.5">
          <span className="text-sm font-medium">User</span>
          <Combobox options={userOptions} value={form.user_id} onChange={(v) => {
            const u = (users?.items || []).find((x: { id: number }) => String(x.id) === v)
            setForm((f) => ({ ...f, user_id: v, display_name: f.display_name || u?.name || '' }))
          }} placeholder="Who owns this Telegram account?" searchPlaceholder="Search users" />
          <p className="text-xs text-gray-400">They get alerts only for record types they can see.</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1"><span className="text-sm font-medium">Display name</span><Input value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} /></label>
          <label className="space-y-1"><span className="text-sm font-medium">Telegram chat ID</span><Input value={form.telegram_chat_id} onChange={(e) => setForm({ ...form, telegram_chat_id: e.target.value })} placeholder="123456789" /></label>
          <label className="space-y-1 sm:col-span-2"><span className="text-sm font-medium">Username <span className="font-normal text-gray-400">(optional)</span></span><Input value={form.telegram_username} onChange={(e) => setForm({ ...form, telegram_username: e.target.value.replace(/^@/, '') })} placeholder="without @" /></label>
        </div>
        <div className="space-y-1.5">
          <span className="text-sm font-medium">Send through</span>
          <div className="flex flex-wrap gap-1.5">
            {bots.map((b) => {
              const on = form.bot_ids.includes(b.id)
              return (
                <button key={b.id} type="button" onClick={() => setForm((f) => ({ ...f, bot_ids: on ? f.bot_ids.filter((x) => x !== b.id) : [...f.bot_ids, b.id] }))}
                  className={cn('inline-flex items-center gap-1 rounded-full border px-3 py-1 text-sm', on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>
                  <Bot className="h-3.5 w-3.5" />{b.name}
                </button>
              )
            })}
            {!bots.length && <p className="text-xs text-amber-700">Add a bot first (Bots tab).</p>}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Receive alerts</label>
      </div>
    </Modal>
  )
}

function BotDialog({ bot, onClose }: { bot: TelegramBot | null; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({ name: bot?.name || '', bot_token: bot?.bot_token || '', active: bot?.active ?? true })
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: form.name.trim(), bot_token: form.bot_token.trim(), active: form.active }
      return bot ? api.put(`/reminders/bots/${bot.id}`, payload) : api.post('/reminders/bots', payload)
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['telegram-bots'] }); toast.success(bot ? 'Bot saved' : 'Bot added'); onClose() },
    onError: (err) => setError(apiError(err, 'Could not save bot')),
  })
  return (
    <Modal title={bot ? 'Edit bot' : 'Add Telegram bot'} subtitle="Create one with @BotFather and paste its token." onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!form.name.trim() || !form.bot_token.trim() || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Save'}</Button></>}>
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <label className="block space-y-1"><span className="text-sm font-medium">Name</span><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Renewals bot" /></label>
        <label className="block space-y-1"><span className="text-sm font-medium">Token</span><Input value={form.bot_token} onChange={(e) => setForm({ ...form, bot_token: e.target.value })} placeholder="123456789:AA…" autoComplete="off" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-primary" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />Active</label>
      </div>
    </Modal>
  )
}
