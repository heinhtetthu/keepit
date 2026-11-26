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
import { TablePager } from '../components/table_shell'
import { cn } from '@/lib/utils'
import { apiError } from '@/lib/seats'
import { useAuthStore } from '../store/auth'
import type { NotificationRecipient, TelegramBot } from '../types'

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

type Tab = 'activity' | 'recipients' | 'bots'
type Status = '' | 'sent' | 'failed' | 'pending'

const STATUS_META: Record<string, { icon: typeof CheckCircle2; tone: string; label: string }> = {
  sent: { icon: CheckCircle2, tone: 'text-emerald-600 bg-emerald-50', label: 'Delivered' },
  failed: { icon: XCircle, tone: 'text-red-600 bg-red-50', label: 'Failed' },
  pending: { icon: Clock, tone: 'text-amber-600 bg-amber-50', label: 'Queued' },
}

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const diff = Math.round((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' })
}

export default function Notifications() {
  const qc = useQueryClient()
  const { hasPermission, user } = useAuthStore()
  const [tab, setTab] = useState<Tab>('activity')
  const [status, setStatus] = useState<Status>('')
  const [page, setPage] = useState(1)
  const [recipientForm, setRecipientForm] = useState<NotificationRecipient | 'new' | null>(null)
  const [botForm, setBotForm] = useState<TelegramBot | 'new' | null>(null)
  const canManageBots = hasPermission('reminder.create')
  const canEditBots = hasPermission('reminder.edit')
  const canDeleteBots = hasPermission('reminder.delete')
  const canManageRecipients = !!user?.is_superuser

  const { data: health } = useQuery<Health>({
    queryKey: ['notification-health', user?.id],
    queryFn: async () => (await api.get('/operations/notifications')).data,
    refetchInterval: 30_000,
  })
  const { data: logs, isLoading, isFetching } = useQuery<{ items: ReminderLog[]; total: number; total_pages: number }>({
    queryKey: ['reminder-logs', page, status],
    queryFn: async () => (await api.get('/reminders/logs', { params: { page, page_size: 30, status: status || undefined } })).data,
    placeholderData: (prev) => prev,
  })
  const { data: bots = [] } = useQuery<TelegramBot[]>({ queryKey: ['telegram-bots'], queryFn: async () => (await api.get('/reminders/bots')).data })
  const { data: recipients = [] } = useQuery<NotificationRecipient[]>({
    queryKey: ['recipients'],
    queryFn: async () => (await api.get('/reminders/recipients?active_only=false')).data,
  })

  const groups = useMemo(() => {
    const out: { day: string; items: ReminderLog[] }[] = []
    for (const log of logs?.items || []) {
      const day = dayLabel(log.sent_at || log.scheduled_date)
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] })
      out[out.length - 1].items.push(log)
    }
    return out
  }, [logs])

  const workersOk = health ? Object.values(health.workers).every((w) => w.healthy) : true
  const counts = health?.counts || {}
  const stats: { id: Status; label: string; value: number; icon: typeof CheckCircle2; tone: string }[] = [
    { id: 'sent', label: 'Delivered', value: counts.sent || 0, icon: CheckCircle2, tone: 'text-emerald-600' },
    { id: 'pending', label: 'Queued', value: (counts.pending || 0) + (counts.processing || 0) + (counts.retry || 0), icon: Clock, tone: 'text-amber-600' },
    { id: 'failed', label: 'Failed', value: counts.failed || 0, icon: XCircle, tone: 'text-red-600' },
  ]

  const refresh = () => ['reminder-logs', 'notification-health', 'recipients', 'telegram-bots'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }))

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-500">Telegram alerts for renewals that need a human. Auto-renewing records don't send alerts.</p>
        </div>
        <Button variant="outline" size="sm" onClick={refresh}><RefreshCw className={cn('h-3.5 w-3.5 sm:mr-1.5', isFetching && 'animate-spin')} /><span className="hidden sm:inline">Refresh</span></Button>
      </div>

      {/* Health + stats */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <div className={cn('col-span-2 flex items-center gap-3 rounded-xl border p-4 md:col-span-1', workersOk ? 'bg-white' : 'border-amber-200 bg-amber-50')}>
          <span className={cn('relative flex h-3 w-3')}>
            <span className={cn('absolute inline-flex h-full w-full rounded-full opacity-60', workersOk ? 'animate-ping bg-emerald-400' : 'bg-amber-400')} />
            <span className={cn('relative inline-flex h-3 w-3 rounded-full', workersOk ? 'bg-emerald-500' : 'bg-amber-500')} />
          </span>
          <div>
            <p className="text-sm font-semibold">{workersOk ? 'Sending normally' : 'Needs attention'}</p>
            <p className="text-xs text-gray-500">{recipients.filter((r) => r.active).length} recipients · {bots.filter((b) => b.active).length} bots</p>
          </div>
        </div>
        {stats.map((s) => (
          <button
            key={s.id}
            onClick={() => { setTab('activity'); setStatus(status === s.id ? '' : s.id); setPage(1) }}
            className={cn('rounded-xl border bg-white p-4 text-left transition-shadow hover:shadow-sm', status === s.id && 'ring-2 ring-primary/30')}
          >
            <p className="flex items-center gap-1.5 text-xs font-medium text-gray-500"><s.icon className={cn('h-3.5 w-3.5', s.tone)} />{s.label}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{s.value}</p>
          </button>
        ))}
      </div>
      {(health?.attention || []).map((m) => (
        <p key={m} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />{m}</p>
      ))}

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b">
        {([['activity', 'Activity'], ['recipients', `Recipients (${recipients.length})`], ['bots', `Bots (${bots.length})`]] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === id ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>{label}</button>
        ))}
        <div className="ml-auto pb-1.5">
          {tab === 'recipients' && canManageRecipients && <Button size="sm" onClick={() => setRecipientForm('new')}><Plus className="mr-1 h-3.5 w-3.5" />Add recipient</Button>}
          {tab === 'bots' && canManageBots && <Button size="sm" onClick={() => setBotForm('new')}><Plus className="mr-1 h-3.5 w-3.5" />Add bot</Button>}
        </div>
      </div>

      {tab === 'activity' && (
        <section className="rounded-xl border bg-white">
          <div className="flex flex-wrap gap-1.5 border-b px-4 py-3">
            {([['', 'All'], ['sent', 'Delivered'], ['failed', 'Failed'], ['pending', 'Queued']] as const).map(([id, label]) => (
              <button key={id} onClick={() => { setStatus(id); setPage(1) }} className={cn('rounded-full border px-3 py-1 text-sm', status === id ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>{label}</button>
            ))}
          </div>
          {isLoading ? (
            <div className="space-y-3 p-4">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-gray-100" />)}</div>
          ) : !groups.length ? (
            <div className="px-4 py-16 text-center">
              <BellRing className="mx-auto mb-3 h-8 w-8 text-gray-300" />
              <p className="font-medium text-gray-700">No alerts {status ? 'with this status' : 'yet'}</p>
              <p className="mt-1 text-sm text-gray-400">Alerts appear here when a record with auto-renew off gets close to its expiry date.</p>
            </div>
          ) : (
            <div>
              {groups.map((g) => (
                <div key={g.day}>
                  <p className="sticky top-0 bg-gray-50/90 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 backdrop-blur">{g.day}</p>
                  <ul className="divide-y divide-gray-100">
                    {g.items.map((log) => {
                      const meta = STATUS_META[log.status] || STATUS_META.pending
                      return (
                        <li key={log.id} className="flex items-start gap-3 px-4 py-3">
                          <span className={cn('mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', meta.tone)}><meta.icon className="h-4 w-4" /></span>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm">
                              {log.record_type_slug
                                ? <Link to={`/records/${log.record_type_slug}/${log.record_id}`} className="font-medium hover:underline">{log.record_name || 'Deleted record'}</Link>
                                : <span className="font-medium">{log.record_name || 'Deleted record'}</span>}
                              <span className="text-gray-500"> · {log.days_before === 0 ? 'expires today' : log.days_before != null ? `${log.days_before} day${log.days_before === 1 ? '' : 's'} before expiry` : log.rule_name}</span>
                            </p>
                            <p className="text-xs text-gray-500">
                              {meta.label} to {log.recipient_name || 'removed recipient'}
                              {log.record_type_name && ` · ${log.record_type_name}`}
                              {log.retry_count > 0 && ` · ${log.retry_count} retr${log.retry_count === 1 ? 'y' : 'ies'}`}
                            </p>
                            {log.error_message && <p className="mt-1 rounded bg-red-50 px-2 py-1 text-xs text-red-700">{log.error_message}</p>}
                          </div>
                          <time className="shrink-0 text-xs text-gray-400" title={new Date(log.sent_at || log.scheduled_date).toLocaleString()}>
                            {new Date(log.sent_at || log.scheduled_date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </time>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
              <div className="border-t px-4 py-2">
                <TablePager shown={logs?.items?.length || 0} total={logs?.total || 0} noun="alerts" page={page} pages={logs?.total_pages || 1} onPage={setPage} />
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'recipients' && (
        <Recipients recipients={recipients} canManage={canManageRecipients} onEdit={(r) => setRecipientForm(r)} />
      )}

      {tab === 'bots' && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {bots.map((b) => (
            <BotCard key={b.id} bot={b} canEdit={canEditBots} canDelete={canDeleteBots} onEdit={() => setBotForm(b)} />
          ))}
          {!bots.length && (
            <div className="col-span-full rounded-xl border border-dashed bg-white px-4 py-12 text-center">
              <Bot className="mx-auto mb-3 h-8 w-8 text-gray-300" />
              <p className="font-medium text-gray-700">No bots yet</p>
              <p className="mt-1 text-sm text-gray-400">Create a bot with <a href="https://t.me/BotFather" target="_blank" rel="noreferrer" className="text-primary hover:underline">@BotFather</a>, then add its token here.</p>
            </div>
          )}
        </div>
      )}

      {recipientForm && <RecipientDialog recipient={recipientForm === 'new' ? null : recipientForm} bots={bots} onClose={() => setRecipientForm(null)} />}
      {botForm && <BotDialog bot={botForm === 'new' ? null : botForm} onClose={() => setBotForm(null)} />}
    </div>
  )
}

function Recipients({ recipients, canManage, onEdit }: { recipients: NotificationRecipient[]; canManage: boolean; onEdit: (r: NotificationRecipient) => void }) {
  const qc = useQueryClient()
  const [result, setResult] = useState<Record<number, { ok: boolean; msg: string }>>({})
  const test = useMutation({
    mutationFn: async (id: number) => (await api.post(`/reminders/recipients/${id}/test`)).data,
    onSuccess: (data: any, id) => setResult((r) => ({ ...r, [id]: { ok: !!data.success, msg: data.success ? 'Test message delivered' : data.error || 'Test failed' } })),
    onError: (err, id) => setResult((r) => ({ ...r, [id]: { ok: false, msg: apiError(err, 'Test failed') } })),
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

  if (!recipients.length) {
    return (
      <div className="rounded-xl border border-dashed bg-white px-4 py-12 text-center">
        <Send className="mx-auto mb-3 h-8 w-8 text-gray-300" />
        <p className="font-medium text-gray-700">Nobody receives alerts yet</p>
        <p className="mt-1 text-sm text-gray-400">Message your bot in Telegram, get your chat ID from <a href="https://t.me/userinfobot" target="_blank" rel="noreferrer" className="text-primary hover:underline">@userinfobot</a>, then add yourself.</p>
      </div>
    )
  }
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {recipients.map((r) => (
        <div key={r.id} className={cn('rounded-xl border bg-white p-4', !r.active && 'opacity-60')}>
          <div className="flex items-start gap-3">
            <Avatar name={r.display_name} />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.display_name}</p>
              <p className="truncate text-xs text-gray-500">{r.telegram_username ? `@${r.telegram_username}` : `Chat ${r.telegram_chat_id}`}{r.user_name ? ` · ${r.user_name}` : ''}</p>
            </div>
            {canManage && (
              <RowMenu items={[
                { label: 'Edit', icon: <Pencil />, onSelect: () => onEdit(r) },
                { label: r.active ? 'Pause alerts' : 'Resume alerts', icon: <BellRing />, onSelect: () => toggle.mutate(r) },
                { label: 'Remove', icon: <Trash2 />, danger: true, divider: true, onSelect: () => { if (confirm(`Remove ${r.display_name}?`)) remove.mutate(r.id) } },
              ]} />
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {(r.telegram_bot_names || []).map((n) => <span key={n} className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600"><Bot className="h-3 w-3" />{n}</span>)}
            {!r.active && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">Paused</span>}
            {canManage && (
              <Button variant="outline" size="sm" className="ml-auto h-7" disabled={test.isPending && test.variables === r.id} onClick={() => test.mutate(r.id)}>
                <Send className="mr-1 h-3 w-3" />{test.isPending && test.variables === r.id ? 'Sending…' : 'Send test'}
              </Button>
            )}
          </div>
          {result[r.id] && <p className={cn('mt-2 rounded px-2 py-1 text-xs', result[r.id].ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700')}>{result[r.id].msg}</p>}
        </div>
      ))}
    </div>
  )
}

function BotCard({ bot, canEdit, canDelete, onEdit }: { bot: TelegramBot; canEdit: boolean; canDelete: boolean; onEdit: () => void }) {
  const qc = useQueryClient()
  const remove = useMutation({
    mutationFn: async () => api.delete(`/reminders/bots/${bot.id}`),
    onSuccess: () => { ['telegram-bots', 'recipients', 'record-types'].forEach((k) => qc.invalidateQueries({ queryKey: [k] })); toast.success('Bot removed') },
    onError: (err) => toast.error(apiError(err, 'Could not remove bot')),
  })
  return (
    <div className={cn('flex items-center gap-3 rounded-xl border bg-white p-4', !bot.active && 'opacity-60')}>
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-sky-50 text-sky-600"><Bot className="h-5 w-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate font-medium">{bot.name}</p>
        <p className="font-mono text-xs text-gray-500">{bot.bot_token ? `••••${bot.bot_token.slice(-4)}` : 'No token'} · {bot.active ? 'Active' : 'Off'}</p>
      </div>
      <RowMenu items={[
        { label: 'Edit', icon: <Pencil />, hidden: !canEdit, onSelect: onEdit },
        { label: 'Remove', icon: <Trash2 />, danger: true, hidden: !canDelete, onSelect: () => { if (confirm(`Remove bot "${bot.name}"? Recipients and record types using it will need another bot.`)) remove.mutate() } },
      ]} />
    </div>
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
