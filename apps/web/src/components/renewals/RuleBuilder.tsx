import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, BellPlus, Pencil, Plus, Send, Trash2 } from 'lucide-react'
import { formatDate } from '@workspace/core'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import RowMenu from '@/components/ui/menu'
import Modal from '@/components/ui/modal'
import { toast } from '@/components/ui/toaster'
import TypeIcon from '@/components/TypeIcon'
import ReminderMessageEditor from '@/components/ReminderMessageEditor'
import { DataTable, EmptyRows, TableToolbar, clientRows, filterField, useTableState, type Column, type SortDef } from '@/components/data-table'
import { apiError } from '@/lib/seats'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'
import type { RecordType, ReminderRule as BaseRule } from '@/types'
import RuleDialog from './RuleDialog'
import { Toggle, intervalLabel } from './shared'

type ReminderRule = BaseRule & { updated_at?: string }
const QUICK = [90, 60, 30, 14, 7, 1, 0]
const SORTS: SortDef[] = [
  { id: 'days_before', label: 'Interval', kind: 'number' }, { id: 'name', label: 'Name' },
  { id: 'active', label: 'Status' }, { id: 'updated_at', label: 'Last changed', kind: 'date' },
]

/** Rules for one record type: a visual track, a quick builder, the rules table, delivery and the shared message. */
export default function RuleBuilder({ recordType, rules }: { recordType: RecordType; rules: ReminderRule[] }) {
  const qc = useQueryClient()
  const { hasPermission, user } = useAuthStore()
  const canCreate = hasPermission('reminder.create')
  const canEdit = hasPermission('reminder.edit')
  const canDelete = hasPermission('reminder.delete')
  const canSeeDelivery = hasPermission('notification.view')
  const [dialog, setDialog] = useState<{ rule: ReminderRule | null } | null>(null)
  const [deleting, setDeleting] = useState<ReminderRule | null>(null)
  const t = useTableState({ key: 'reminder-rules', defaultSort: 'days_before', defaultOrder: 'desc', defaultColumns: ['name', 'message', 'active', 'updated_at'] })

  const reminderField = recordType.reminder_field_id ? recordType.fields?.find((f) => f.id === recordType.reminder_field_id)?.name : null
  const existingDays = rules.map((r) => r.days_before)
  const invalidate = () => { qc.invalidateQueries({ queryKey: ['reminder-rules'] }); qc.invalidateQueries({ queryKey: ['renewals-upcoming'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }

  const create = useMutation({
    mutationFn: async (days: number) => api.post('/reminders/rules', { record_type_id: recordType.id, name: intervalLabel(days), days_before: days, active: true }),
    onSuccess: (_r, days) => { invalidate(); toast.success(`Reminder added: ${intervalLabel(days).toLowerCase()}`) },
    onError: (e) => toast.error(apiError(e, 'Could not add the reminder')),
  })
  const toggle = useMutation({
    mutationFn: async (rule: ReminderRule) => api.put(`/reminders/rules/${rule.id}`, { active: !rule.active }),
    onMutate: async (rule) => {
      // Flip the switch straight away; the refetch confirms it.
      qc.setQueriesData<ReminderRule[]>({ queryKey: ['reminder-rules'] }, (old) => old?.map((r) => (r.id === rule.id ? { ...r, active: !r.active } : r)))
    },
    onSettled: invalidate,
    onError: (e) => toast.error(apiError(e, 'Could not update the reminder')),
  })
  const remove = useMutation({
    mutationFn: async (id: number) => api.delete(`/reminders/rules/${id}`),
    onSuccess: () => { invalidate(); setDeleting(null); toast.success('Reminder deleted') },
    onError: (e) => toast.error(apiError(e, 'Could not delete the reminder')),
  })

  const fields = useMemo(() => [
    filterField('status', 'Status', 'select', ['Active', 'Paused']),
    filterField('custom', 'Has its own message', 'boolean'),
    filterField('days_before', 'Days before', 'integer'),
  ], [])
  const get = (r: ReminderRule, slug: string): unknown =>
    slug === 'status' ? (r.active ? 'Active' : 'Paused') : slug === 'custom' ? !!r.template : (r as unknown as Record<string, unknown>)[slug]
  const result = clientRows(rules, t, fields, get, (r) => `${r.name} ${intervalLabel(r.days_before)}`)

  const columns: Column<ReminderRule>[] = [
    { id: 'interval', label: 'When', sort: 'days_before', locked: true, render: (r) => (
      <div className="flex items-center gap-2">
        <span className={cn('flex h-8 min-w-[2.5rem] items-center justify-center rounded-lg px-1.5 text-sm font-semibold tabular-nums', r.active ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400')}>
          {r.days_before === 0 ? '0d' : `${r.days_before}d`}
        </span>
        <span className={cn('text-sm', r.active ? 'text-gray-900' : 'text-gray-400')}>{intervalLabel(r.days_before)}</span>
      </div>
    ) },
    { id: 'name', label: 'Name', sort: 'name', render: (r) => <span className="text-gray-600">{r.name}</span> },
    { id: 'message', label: 'Message', render: (r) => r.template
      ? <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-700">Custom</span>
      : <span className="text-xs text-gray-500">Shared message</span> },
    { id: 'active', label: 'Active', sort: 'active', render: (r) => (
      <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
        <Toggle checked={r.active} disabled={!canEdit || toggle.isPending} onChange={() => toggle.mutate(r)} label={r.active ? 'Pause reminder' : 'Resume reminder'} />
        <span className={cn('text-xs', r.active ? 'text-gray-700' : 'text-gray-400')}>{r.active ? 'On' : 'Paused'}</span>
      </div>
    ) },
    { id: 'updated_at', label: 'Last changed', sort: 'updated_at', render: (r) => <span className="tabular-nums text-gray-500">{formatDate(r.updated_at ?? null)}</span> },
  ]

  const { data: recipients } = useQuery<{ id: number; active: boolean }[]>({
    queryKey: ['reminder-recipients', user?.id], queryFn: async () => (await api.get('/reminders/recipients')).data, enabled: canSeeDelivery, retry: false,
  })
  const { data: bots } = useQuery<{ id: number; name: string; active: boolean }[]>({
    queryKey: ['reminder-bots', user?.id], queryFn: async () => (await api.get('/reminders/bots')).data, enabled: canSeeDelivery, retry: false,
  })
  const pinnedBot = recordType.telegram_bot_id ? bots?.find((b) => b.id === recordType.telegram_bot_id) : null
  const activeBots = bots?.filter((b) => b.active).length ?? 0

  return (
    <div className="min-w-0 space-y-4 animate-page-in">
      {/* Type header */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><TypeIcon icon={recordType.icon} className="h-5 w-5 text-gray-600" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold text-gray-900">{recordType.name}</h2>
          <p className="truncate text-xs text-gray-500">
            {reminderField ? <>Counts down to <span className="font-medium text-gray-700">{reminderField}</span></> : 'No renewal/expiry field yet'}
            {recordType.renew_before_days ? <> · auto-renews {recordType.renew_before_days} days early</> : null}
          </p>
        </div>
        <Link to={`/records/${recordType.slug}`} className="text-xs font-medium text-primary hover:underline">View records</Link>
        {canCreate && reminderField && <Button size="sm" onClick={() => setDialog({ rule: null })}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">New reminder</span></Button>}
      </div>

      {!reminderField ? (
        <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 animate-pop-in">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Pick a renewal or expiry date field first</p>
            <p className="mt-0.5 text-amber-800">Reminders count down to a date. Open Record types, edit {recordType.name}, and choose its renewal/expiry field. Then come back to add reminders.</p>
            {hasPermission('record_type.view') && <Link to="/record-types" className="mt-2 inline-block font-medium underline">Open Record types</Link>}
          </div>
        </div>
      ) : (
        <>
          {/* Visual track: when each reminder fires before the due date */}
          <RuleTrack rules={rules} onPick={canEdit ? (r) => setDialog({ rule: r }) : undefined} />

          {canCreate && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs font-medium text-gray-500">Quick add</span>
              {QUICK.filter((d) => !existingDays.includes(d)).map((d) => (
                <button key={d} type="button" disabled={create.isPending} onClick={() => create.mutate(d)}
                  className="press inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-gray-600 hover:border-primary hover:bg-primary/5 hover:text-primary disabled:opacity-50">
                  <Plus className="h-3 w-3" />{d === 0 ? 'On the day' : `${d} days`}
                </button>
              ))}
            </div>
          )}

          <TableToolbar state={t} searchPlaceholder="Search reminders…" filterFields={fields} sorts={SORTS} columns={columns} />
          <DataTable rows={result.rows} rowKey={(r) => r.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
            onRowClick={canEdit ? (r) => setDialog({ rule: r }) : undefined} rowClassName={(r) => !r.active && 'opacity-70'}
            actions={(r) => (
              <RowMenu items={[
                { label: 'Edit', icon: <Pencil />, onSelect: () => setDialog({ rule: r }), hidden: !canEdit },
                { label: r.active ? 'Pause' : 'Resume', icon: <Send />, onSelect: () => toggle.mutate(r), hidden: !canEdit },
                { label: 'Delete', icon: <Trash2 />, danger: true, divider: true, onSelect: () => setDeleting(r), hidden: !canDelete },
              ]} />
            )}
            empty={<EmptyRows icon={<BellPlus className="h-9 w-9" />}
              title={rules.length ? 'No reminders match' : 'No reminders yet'}
              hint={rules.length ? 'Clear the search or filters.' : canCreate ? 'Use Quick add above, for example 30 days and 7 days before, so nothing renews by surprise.' : 'Ask an admin to add reminders for this type.'} />}
            pager={{ page: t.page, pages: result.pages, total: result.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'reminders' }} />

          {/* Delivery */}
          <div className="grid gap-3 sm:grid-cols-3">
            <Fact label="Channel" value="Telegram" sub={pinnedBot ? `Through ${pinnedBot.name} only` : canSeeDelivery ? `${activeBots} active bot${activeBots === 1 ? '' : 's'}` : 'Bot settings in Notifications'} />
            <Fact label="Recipients" value={canSeeDelivery ? String(recipients?.filter((r) => r.active).length ?? '-') : 'Set by admins'}
              sub={`Active recipients whose users can see ${recordType.name}`} warn={canSeeDelivery && recipients !== undefined && !recipients.some((r) => r.active)} />
            <Fact label="Auto-renew" value="Skips reminders" sub="Records that will renew themselves get no reminder" />
          </div>
          {canSeeDelivery && <p className="-mt-1 text-xs text-gray-500">Manage recipients and bots in <Link to="/notifications" className="font-medium text-primary hover:underline">Notifications</Link>.</p>}
        </>
      )}

      <ReminderMessageEditor key={recordType.id} recordType={recordType} />

      {dialog && <RuleDialog recordType={recordType} rule={dialog.rule} existingDays={existingDays} onClose={() => setDialog(null)} onSaved={invalidate} />}
      {deleting && (
        <Modal size="sm" title="Delete reminder" onClose={() => setDeleting(null)} footer={<>
          <Button variant="outline" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="destructive" disabled={remove.isPending} onClick={() => remove.mutate(deleting.id)}>{remove.isPending ? 'Deleting…' : 'Delete'}</Button>
        </>}>
          <p className="text-sm text-gray-600">Delete the "{intervalLabel(deleting.days_before).toLowerCase()}" reminder for {recordType.name}? Its send history is removed too. To stop it for a while, pause it instead.</p>
        </Modal>
      )}
    </div>
  )
}

function Fact({ label, value, sub, warn }: { label: string; value: string; sub: string; warn?: boolean }) {
  return (
    <div className={cn('rounded-xl border bg-white px-4 py-3', warn && 'border-amber-200 bg-amber-50')}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <p className={cn('mt-0.5 text-sm font-semibold', warn ? 'text-amber-800' : 'text-gray-900')}>{value}</p>
      <p className={cn('text-xs', warn ? 'text-amber-700' : 'text-gray-500')}>{warn ? 'No active recipients: nothing will be sent' : sub}</p>
    </div>
  )
}

/** Horizontal countdown from the earliest reminder to the due date. */
function RuleTrack({ rules, onPick }: { rules: ReminderRule[]; onPick?: (r: ReminderRule) => void }) {
  const max = Math.max(30, ...rules.map((r) => r.days_before))
  // Square-root scale so 1, 3 and 7 days do not pile up next to the due date.
  const pos = (d: number) => Math.min(94, 100 - (Math.sqrt(d) / Math.sqrt(max)) * 100)
  const sorted = [...rules].sort((a, b) => b.days_before - a.days_before)
  return (
    <div className="rounded-xl border bg-white px-4 pb-3 pt-4 sm:px-6">
      <div className="relative mx-2 h-12">
        <div className="absolute left-0 right-0 top-4 h-1 rounded-full bg-gradient-to-r from-gray-100 via-amber-100 to-red-200" />
        {sorted.map((r) => (
          <button key={r.id} type="button" disabled={!onPick} onClick={() => onPick?.(r)} title={`${intervalLabel(r.days_before)}${r.active ? '' : ' (paused)'}`}
            style={{ left: `${pos(r.days_before)}%` }}
            className="group absolute top-0 -translate-x-1/2 animate-pop-in text-center disabled:cursor-default">
            <span className={cn('mx-auto mt-2.5 block h-4 w-4 rounded-full border-2 transition-transform group-hover:scale-125 group-disabled:group-hover:scale-100',
              r.active ? 'border-primary bg-primary shadow-[0_0_0_3px_hsl(var(--primary)/0.15)]' : 'border-gray-300 bg-white')} />
            <span className={cn('mt-1 block whitespace-nowrap text-[11px] font-medium tabular-nums', r.active ? 'text-gray-700' : 'text-gray-400')}>{r.days_before === 0 ? 'Day' : `${r.days_before}d`}</span>
          </button>
        ))}
        <span className="absolute right-0 top-0 translate-x-1/2 text-center">
          <span className="mx-auto mt-2 block h-5 w-1 rounded bg-red-400" />
          <span className="mt-0.5 block text-[11px] font-semibold text-red-600">Due</span>
        </span>
      </div>
      <p className="mt-1 text-xs text-gray-500">
        {rules.length === 0 ? 'No reminders yet. Add one below to start the countdown.'
          : `${rules.filter((r) => r.active).length} of ${rules.length} reminder${rules.length === 1 ? '' : 's'} active. Each one is sent once per renewal date.`}
      </p>
    </div>
  )
}
