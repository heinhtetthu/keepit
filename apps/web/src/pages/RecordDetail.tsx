import { useState, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { ArrowLeft, ArrowLeftRight, Archive, Pencil, RefreshCw, RotateCcw, Trash2, UserMinus, UserPlus, BellRing } from 'lucide-react'
import api from '@/lib/api'
import SecretReveal from '../components/SecretReveal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Modal from '@/components/ui/modal'
import RowMenu from '@/components/ui/menu'
import Avatar from '@/components/ui/avatar'
import { toast } from '@/components/ui/toaster'
import SearchableSelect from '@/components/SearchableSelect'
import { cn } from '@/lib/utils'
import { apiError, seatFields, todayLocal } from '@/lib/seats'
import { useAuthStore } from '../store/auth'
import { pushRecent } from '../store/recent'
import DynamicForm from '../components/DynamicForm'
import SeatDialog, { type SeatMode } from '../components/SeatDialog'
import { Expiry, Switch } from '../components/DynamicTable'
import type { RecordDetailResponse, RecordType, RecordAssignment } from '../types'
import { Select } from '@/components/ui/select'
import EntityHistory from '@/components/history/EntityHistory'

interface Renewal {
  id: number
  record_id: number
  renewed_by_name: string | null
  renewed_on?: string | null
  old_date: string | null
  new_date: string
  cost: number | null
  currency: string | null
  payment_method: string | null
  payment_reference: string | null
  location: string | null
  notes: string | null
  renewed_at: string
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'MMK', 'THB', 'SGD', 'JPY', 'CNY']
const PAYMENT_METHODS = ['Card', 'Bank Transfer', 'Cash', 'PayPal', 'Online Payment', 'Cheque', 'Other']
const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, 'semi-annual': 6, semiannual: 6, yearly: 12, annual: 12, biennial: 24 }
const LEAD_PRESETS = [1, 3, 7, 14, 30, 60, 90]

function addMonthsIso(iso: string, months: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  const ny = Math.floor(t / 12)
  const nm = (t % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Extend the current expiry in whole billing cycles until it is past today. */
function suggestNewExpiry(expiryIso: string, cycle: string | null): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryIso || '')) return ''
  const months = cycle?.trim() ? CYCLE_MONTHS[cycle.trim().toLowerCase()] : 12
  if (!months) return ''
  let d = expiryIso
  for (let guard = 0; d <= todayLocal() && guard < 600; guard++) d = addMonthsIso(d, months)
  return d === expiryIso ? addMonthsIso(d, months) : d
}

const textareaCls = 'flex min-h-[70px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'

export default function RecordDetail() {
  const { typeSlug, id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const isAdmin = !!user?.is_superuser
  const [showEdit, setShowEdit] = useState(false)
  const [showRenew, setShowRenew] = useState(false)
  const [seatMode, setSeatMode] = useState<SeatMode | null>(null)
  const [historyTab, setHistoryTab] = useState<'ownership' | 'renewals' | 'activity'>('ownership')
  const [editingRenewal, setEditingRenewal] = useState<Renewal | null>(null)
  const [editingAssignment, setEditingAssignment] = useState<RecordAssignment | null>(null)

  const { data: record, isLoading } = useQuery<RecordDetailResponse>({
    queryKey: ['record', id],
    queryFn: async () => (await api.get(`/records/${id}`)).data,
    enabled: !!id,
    retry: 1,
  })
  const { data: recordTypes } = useQuery<RecordType[]>({
    queryKey: ['record-types'],
    queryFn: async () => (await api.get('/record-types')).data,
  })
  const recordType = recordTypes?.find((t) => t.id === record?.record_type_id)
  const tracked = !!recordType?.track_ownership

  const { data: renewals = [] } = useQuery<Renewal[]>({
    queryKey: ['record-renewals', id],
    queryFn: async () => (await api.get(`/records/${id}/renewals`)).data,
    enabled: !!id,
  })
  const { data: ownership = [] } = useQuery<RecordAssignment[]>({
    queryKey: ['record-assignments', id],
    queryFn: async () => (await api.get(`/records/${id}/assignments`)).data,
    enabled: !!id && tracked,
    retry: 1,
  })
  const { data: calendar } = useQuery<{ today: string }>({
    queryKey: ['application-calendar'],
    queryFn: async () => (await api.get('/settings/calendar')).data,
  })

  const refresh = () => {
    for (const key of [['record', id], ['record-renewals', id], ['record-assignments', id], ['records'], ['records-summary'], ['dashboard']]) {
      qc.invalidateQueries({ queryKey: key })
    }
  }
  const fail = (fallback: string) => (err: unknown) => toast.error(apiError(err, fallback))

  const setField = useMutation({
    mutationFn: async ({ fieldId, value }: { fieldId: number; value: unknown }) => api.put(`/records/${id}`, { values: [{ field_id: fieldId, value }] }),
    onSuccess: () => refresh(),
    onError: fail('Could not update'),
  })
  const setRenewBefore = useMutation({
    mutationFn: async (days: number | null) => api.put(`/records/${id}/renewal-options`, { renew_before_days: days }),
    onSuccess: () => refresh(),
    onError: fail('Could not update renewal timing'),
  })
  const lifecycle = useMutation({
    mutationFn: async (kind: 'archive' | 'restore' | 'delete') =>
      kind === 'delete' ? api.delete(`/records/${id}`) : api.post(`/records/${id}/${kind}`),
    onSuccess: (_d, kind) => {
      refresh()
      if (kind === 'restore') { toast.success('Record restored'); return }
      toast.success(kind === 'archive' ? 'Record archived' : 'Moved to Trash')
      navigate(`/records/${typeSlug || record?.record_type_slug}`)
    },
    onError: fail('Action failed'),
  })
  const deleteRenewal = useMutation({
    mutationFn: async (renewalId: number) => api.delete(`/records/${id}/renewals/${renewalId}`),
    onSuccess: () => { refresh(); toast.success('Renewal entry deleted') },
    onError: fail('Could not delete renewal entry'),
  })
  const deleteAssignment = useMutation({
    mutationFn: async (assignmentId: number) => api.delete(`/records/${id}/assignments/${assignmentId}`),
    onSuccess: () => { refresh(); toast.success('History entry deleted') },
    onError: fail('Could not delete history entry'),
  })

  useEffect(() => {
    if (!record) return
    const rt = recordTypes?.find((t) => t.id === record.record_type_id)
    pushRecent({
      url: `/records/${rt?.slug || typeSlug || 'records'}/${record.id}`,
      label: record.name,
      sublabel: rt?.name ? `${rt.name} - record` : 'Record',
      kind: 'record',
      icon: rt?.icon ?? null,
    })
  }, [record?.id, record?.name]) // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <div className="text-gray-500">Loading…</div>
  if (!record) return <div className="text-gray-500">Record not found</div>

  const canInType = useAuthStore.getState().canInType
  const canEdit = canInType('record.edit', record.record_type_id) && !record.archived
  const canDelete = canInType('record.delete', record.record_type_id)
  const sf = seatFields(recordType)
  const values = record.values || []
  const valueOf = (fieldId?: number) => values.find((v) => v.field_id === fieldId)?.value
  const holder = tracked ? (valueOf(sf.assignee?.id) as string | undefined) || null : null
  const email = tracked ? (valueOf(sf.email?.id) as string | undefined) || null : null
  const product = (valueOf(sf.product?.id) as string | undefined) || null
  const expiry = sf.expiry ? (valueOf(sf.expiry.id) as string | undefined) || null : null
  const autoOn = sf.autoRenew ? valueOf(sf.autoRenew.id) === true : null
  const cost = valueOf(sf.cost?.id)
  const currency = valueOf(sf.currency?.id)
  const cycleField = values.find((v) => /billing[-_ ]?cycle|renewal[-_ ]?cycle/i.test(v.field_slug || v.field_name))
  const cycleValue = (cycleField?.value as string | undefined) || undefined
  const since = ownership[0]?.effective_date?.slice(0, 10)
  const shownInHeader = new Set([sf.assignee?.id, sf.email?.id, sf.expiry?.id, sf.autoRenew?.id, sf.currency?.id, sf.cost?.id, cycleField?.field_id].filter(Boolean) as number[])
  if (!tracked) { shownInHeader.delete(sf.assignee?.id as number); shownInHeader.delete(sf.email?.id as number) }
  const backTo = `/records/${typeSlug || record.record_type_slug}`
  const shownHistoryTab = !tracked && historyTab === 'ownership' ? 'renewals' : historyTab

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      {record.archived && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          This record is archived and hidden from normal lists.
          {canDelete && <Button variant="outline" size="sm" onClick={() => lifecycle.mutate('restore')}><RotateCcw className="mr-1.5 h-3.5 w-3.5" />Restore</Button>}
        </div>
      )}

      {/* Header */}
      <div className="space-y-2">
        <Link to={backTo} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
          <ArrowLeft className="h-4 w-4" /> {record.record_type_name}
        </Link>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h1 className="min-w-0 text-xl sm:text-2xl font-semibold tracking-tight text-gray-900 break-words">{tracked && product ? product : record.name}</h1>
          <div className="flex items-center gap-2">
            {canEdit && record.reminder_field_id && (
              <Button onClick={() => setShowRenew(true)}><RefreshCw className="mr-1.5 h-4 w-4" />Renew</Button>
            )}
            {canEdit && <Button variant="outline" onClick={() => setShowEdit(true)}><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>}
            <RowMenu label="More actions" items={[
              { label: 'Archive', icon: <Archive />, hidden: !canDelete || record.archived, onSelect: () => { if (confirm(`Archive "${record.name}"?`)) lifecycle.mutate('archive') } },
              { label: 'Move to Trash', icon: <Trash2 />, danger: true, hidden: !canDelete, onSelect: () => { if (confirm('Move this record to Trash? You can restore it from Activity → Trash.')) lifecycle.mutate('delete') } },
            ]} />
          </div>
        </div>
      </div>

      {/* Seat holder */}
      {tracked && (
        <section className="flex flex-col gap-4 rounded-xl border bg-white p-4 sm:flex-row sm:items-center sm:p-5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar name={holder} size="lg" />
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Assigned to</p>
              <p className={cn('truncate text-lg font-semibold', !holder && 'italic text-gray-400')}>{holder || 'Unassigned'}</p>
              <p className="truncate text-sm text-gray-500">
                {[email, valueOf(sf.businessUnit?.id) as string, since && `since ${since}`].filter(Boolean).join(' · ') || 'Give this seat to someone'}
              </p>
            </div>
          </div>
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              <Button variant={holder ? 'outline' : 'default'} onClick={() => setSeatMode('reassign')}><UserPlus className="mr-1.5 h-4 w-4" />{holder ? 'Reassign' : 'Assign'}</Button>
              <Button variant="outline" onClick={() => setSeatMode('swap')}><ArrowLeftRight className="mr-1.5 h-4 w-4" />Swap</Button>
              {holder && <Button variant="outline" className="text-red-600 hover:bg-red-50" onClick={() => setSeatMode('unassign')}><UserMinus className="mr-1.5 h-4 w-4" />Unassign</Button>}
            </div>
          )}
        </section>
      )}

      {/* Renewal strip */}
      {(sf.expiry || sf.autoRenew || sf.cost) && (
        <section className="grid grid-cols-1 divide-y rounded-xl border bg-white sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {sf.expiry && (
            <div className="p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Expires</p>
              <Expiry date={expiry} today={calendar?.today} />
              {canEdit && (
                <Select
                  className="mt-2 h-8 w-full rounded-md border border-input bg-background px-2 text-xs text-gray-600"
                  value={record.renew_before_days ?? ''}
                  disabled={setRenewBefore.isPending}
                  onChange={(e) => setRenewBefore.mutate(e.target.value === '' ? null : Number(e.target.value))}
                  aria-label="When to renew"
                  title="When auto-renew runs, or when the alert is sent if auto-renew is off"
                >
                  <option value="">{recordType?.renew_before_days ? `Type default: ${recordType.renew_before_days} days early` : "Renew on the expiry date"}</option>
                  {record.renew_before_days != null && !LEAD_PRESETS.includes(record.renew_before_days) && (
                    <option value={record.renew_before_days}>Renew {record.renew_before_days} days early</option>
                  )}
                  {LEAD_PRESETS.map((n) => <option key={n} value={n}>Renew {n === 7 ? '1 week' : n === 14 ? '2 weeks' : `${n} day${n === 1 ? '' : 's'}`} early</option>)}
                </Select>
              )}
            </div>
          )}
          {sf.autoRenew && (
            <div className="p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Auto-renew</p>
              <div className="flex items-center gap-2.5">
                <Switch
                  checked={!!autoOn}
                  disabled={!canEdit || setField.isPending}
                  onChange={(v) => setField.mutate({ fieldId: sf.autoRenew!.id, value: v }, { onSuccess: () => toast.success(`Auto-renew ${v ? 'on' : 'off'}`) })}
                  label="Auto-renew"
                />
                <span className="text-sm font-medium">{autoOn ? 'On' : 'Off'}</span>
              </div>
              <p className={cn('mt-1.5 flex items-start gap-1 text-xs', autoOn ? 'text-gray-500' : 'text-amber-700')}>
                {!autoOn && <BellRing className="mt-px h-3.5 w-3.5 shrink-0" />}
                {autoOn ? 'Renews itself on the expiry date. No alert needed.' : 'You will get an alert before it expires. Renew it manually.'}
              </p>
            </div>
          )}
          {sf.cost && (
            <div className="p-4">
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-gray-400">Cost</p>
              <p className="text-lg font-semibold tabular-nums">{cost != null && cost !== '' ? `${Number(cost).toLocaleString()} ${currency || ''}` : '-'}</p>
              {cycleValue && <p className="text-xs text-gray-500">{cycleValue}</p>}
            </div>
          )}
        </section>
      )}

      {/* All other fields */}
      <section className="rounded-xl border bg-white">
        <h2 className="border-b px-4 py-3 text-sm font-semibold">Details</h2>
        <dl className="grid grid-cols-1 gap-x-6 sm:grid-cols-2">
          {values.filter((v) => !shownInHeader.has(v.field_id)).map((v) => (
            <div key={v.field_id} className="flex justify-between gap-4 border-b border-gray-100 px-4 py-2.5 text-sm last:border-0">
              <dt className="text-gray-500">{v.field_name}</dt>
              <dd className="min-w-0 break-words text-right font-medium">
                {v.field_type === 'secret' ? <SecretReveal recordId={record.id} fieldId={v.field_id} />
                  : v.field_type === 'boolean' ? (v.value ? 'Yes' : 'No')
                    : v.field_type === 'url' && v.value ? <a href={String(v.value)} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">{String(v.value)}</a>
                      : (v.display_value || String(v.value ?? '-'))}
              </dd>
            </div>
          ))}
          {tracked && <div className="flex justify-between gap-4 px-4 py-2.5 text-sm"><dt className="text-gray-500">Record name</dt><dd className="text-right font-medium">{record.name}</dd></div>}
          <div className="flex justify-between gap-4 px-4 py-2.5 text-sm text-gray-400"><dt>Last updated</dt><dd>{new Date(record.updated_at).toLocaleString()}</dd></div>
        </dl>
      </section>

      {/* History */}
      <section className="rounded-xl border bg-white">
        <div className="flex gap-1 border-b px-2">
          {(tracked ? (['ownership', 'renewals', 'activity'] as const) : (['renewals', 'activity'] as const)).map((t) => (
            <button key={t} onClick={() => setHistoryTab(t)} className={cn(
              '-mb-px border-b-2 px-3 py-3 text-sm font-medium',
              shownHistoryTab === t ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800',
            )}>
              {t === 'ownership' ? `Who had it (${ownership.length})` : t === 'renewals' ? `Renewals (${renewals.length})` : 'Activity'}
            </button>
          ))}
        </div>
        {shownHistoryTab === 'activity' ? (
          <EntityHistory entity="record" id={record.id} className="rounded-none border-0" />
        ) : shownHistoryTab === 'ownership' ? (
          <ol className="px-4 py-3">
            {ownership.map((a, i) => (
              <li key={a.id} className="group relative flex gap-3 pb-4 last:pb-0">
                {i < ownership.length - 1 && <span className="absolute left-[15px] top-8 bottom-0 w-px bg-gray-200" />}
                <Avatar name={a.employee_name === 'Unassigned' ? null : a.employee_name} size="sm" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className={cn('font-medium', a.employee_name === 'Unassigned' && 'italic text-gray-500')}>{a.employee_name}</span>
                    {a.business_unit && <span className="text-gray-500"> · {a.business_unit}</span>}
                  </p>
                  <p className="text-xs text-gray-500">
                    {a.effective_date.slice(0, 10)} → {i === 0 ? 'now' : ownership[i - 1].effective_date.slice(0, 10)}
                    {a.reason && ` · ${a.reason}`}
                    {a.cost != null && ` · ${a.cost.toLocaleString()} ${a.currency || ''}`}
                  </p>
                  {a.notes && <p className="mt-0.5 text-xs text-gray-400">{a.notes}</p>}
                </div>
                {isAdmin && (
                  <div className="opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                    <RowMenu label="Correct entry" items={[
                      { label: 'Correct entry', icon: <Pencil />, onSelect: () => setEditingAssignment(a) },
                      { label: 'Delete entry', icon: <Trash2 />, danger: true, onSelect: () => { if (confirm(`Delete the entry for ${a.employee_name} from ${a.effective_date.slice(0, 10)}?`)) deleteAssignment.mutate(a.id) } },
                    ]} />
                  </div>
                )}
              </li>
            ))}
          </ol>
        ) : renewals.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-gray-400">{record.reminder_field_id ? 'No renewals yet.' : 'This record type has no expiry field.'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-gray-500">
                <tr className="border-b">
                  <th className="px-4 py-2 font-medium">Renewed</th>
                  <th className="px-4 py-2 font-medium">New expiry</th>
                  <th className="px-4 py-2 font-medium">Cost</th>
                  <th className="px-4 py-2 font-medium">Paid by</th>
                  <th className="px-4 py-2 font-medium">By</th>
                  {isAdmin && <th className="w-10" />}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {renewals.map((r) => (
                  <tr key={r.id} className="group">
                    <td className="px-4 py-2.5 whitespace-nowrap">{(r.renewed_on || r.renewed_at).slice(0, 10)}</td>
                    <td className="px-4 py-2.5 whitespace-nowrap">
                      <span className="font-medium">{r.new_date.slice(0, 10)}</span>
                      {r.old_date && <span className="text-xs text-gray-400"> from {r.old_date.slice(0, 10)}</span>}
                    </td>
                    <td className="px-4 py-2.5 whitespace-nowrap tabular-nums">{r.cost != null ? `${r.cost.toLocaleString()} ${r.currency || ''}` : '-'}</td>
                    <td className="px-4 py-2.5 text-gray-600">{[r.payment_method, r.payment_reference].filter(Boolean).join(' · ') || '-'}</td>
                    <td className="px-4 py-2.5">
                      {r.renewed_by_name || <span className="rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700">Auto</span>}
                      {r.notes && <span className="block max-w-[220px] truncate text-xs text-gray-400" title={r.notes}>{r.notes}</span>}
                    </td>
                    {isAdmin && (
                      <td className="px-2 text-right">
                        <RowMenu label="Correct renewal" items={[
                          { label: 'Correct entry', icon: <Pencil />, onSelect: () => setEditingRenewal(r) },
                          { label: 'Delete entry', icon: <Trash2 />, danger: true, onSelect: () => { if (confirm(`Delete this renewal? If it is the newest, the expiry rolls back to ${r.old_date?.slice(0, 10) || 'the previous date'}.`)) deleteRenewal.mutate(r.id) } },
                        ]} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {showEdit && recordType && (
        <DynamicForm
          recordType={recordType}
          record={{ updated_at: record.updated_at, id: record.id, name: record.name, status: record.status, values: Object.fromEntries(values.map((v) => [v.field_slug, v.value])) }}
          onClose={() => setShowEdit(false)}
          onSaved={refresh}
        />
      )}
      {seatMode && recordType && (
        <SeatDialog mode={seatMode} recordType={recordType} seat={{ id: record.id, name: record.name, holder, product }} onClose={() => setSeatMode(null)} />
      )}
      {showRenew && (
        <RenewDialog
          record={record}
          recordType={recordType}
          expiry={expiry}
          cycle={cycleValue ?? null}
          lastRenewal={renewals[0]}
          cost={cost}
          currency={currency as string | undefined}
          onClose={() => setShowRenew(false)}
          onDone={refresh}
        />
      )}
      {editingRenewal && <RenewalCorrection recordId={record.id} renewal={editingRenewal} onClose={() => setEditingRenewal(null)} onDone={refresh} />}
      {editingAssignment && <AssignmentCorrection recordId={record.id} entry={editingAssignment} onClose={() => setEditingAssignment(null)} onDone={refresh} />}
    </div>
  )
}

function RenewDialog({ record, recordType, expiry, cycle, lastRenewal, cost, currency, onClose, onDone }: {
  record: RecordDetailResponse
  recordType: RecordType | undefined
  expiry: string | null
  cycle: string | null
  lastRenewal?: Renewal
  cost: unknown
  currency?: string
  onClose: () => void
  onDone: () => void
}) {
  const optionsOf = (slug: string, fallback: string[]) => {
    const f = recordType?.fields?.find((x) => x.slug === slug)
    return f?.options?.length ? f.options.map((o) => ({ value: o.value, label: o.label })) : fallback.map((v) => ({ value: v, label: v }))
  }
  const [form, setForm] = useState({
    new_date: suggestNewExpiry(expiry?.slice(0, 10) || '', cycle),
    renewed_on: todayLocal(),
    cost: String(lastRenewal?.cost ?? (cost ?? '')),
    currency: lastRenewal?.currency || currency || '',
    payment_method: '',
    payment_reference: '',
    notes: '',
  })
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: async () => api.post(`/records/${record.id}/renew`, {
      new_date: form.new_date,
      renewed_on: form.renewed_on || undefined,
      cost: form.cost === '' ? null : Number(form.cost),
      currency: form.currency || null,
      payment_method: form.payment_method || null,
      payment_reference: form.payment_reference.trim() || null,
      notes: form.notes.trim() || null,
    }),
    onSuccess: () => { onDone(); toast.success(`Renewed until ${form.new_date}`); onClose() },
    onError: (err) => setError(apiError(err, 'Failed to renew')),
  })
  return (
    <Modal
      title="Record a renewal"
      subtitle={record.name}
      onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!form.new_date || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Renew'}</Button></>}
    >
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">New expiry date</span>
            <Input type="date" required value={form.new_date} onChange={(e) => setForm({ ...form, new_date: e.target.value })} />
            <span className="block text-xs text-gray-400">Currently {expiry?.slice(0, 10) || 'not set'}{cycle ? ` · ${cycle}` : ''}</span>
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Renewed on</span>
            <Input type="date" value={form.renewed_on} onChange={(e) => setForm({ ...form, renewed_on: e.target.value })} />
          </label>
          <label className="space-y-1">
            <span className="text-sm font-medium">Cost</span>
            <Input type="number" step="any" min={0} value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} />
          </label>
          <div className="space-y-1">
            <span className="text-sm font-medium">Currency</span>
            <SearchableSelect options={optionsOf('currency', CURRENCIES)} value={form.currency} onChange={(v) => setForm({ ...form, currency: v as string })} placeholder="Currency" />
          </div>
          <div className="space-y-1">
            <span className="text-sm font-medium">Payment method</span>
            <SearchableSelect options={optionsOf('payment_method', PAYMENT_METHODS)} value={form.payment_method} onChange={(v) => setForm({ ...form, payment_method: v as string })} placeholder="Optional" />
          </div>
          <label className="space-y-1">
            <span className="text-sm font-medium">Card / reference</span>
            <Input value={form.payment_reference} onChange={(e) => setForm({ ...form, payment_reference: e.target.value })} placeholder="e.g. KBZ Visa 4242" />
          </label>
        </div>
        <label className="block space-y-1">
          <span className="text-sm font-medium">Notes</span>
          <textarea className={textareaCls} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
        </label>
      </div>
    </Modal>
  )
}

function RenewalCorrection({ recordId, renewal, onClose, onDone }: { recordId: number; renewal: Renewal; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: async (payload: unknown) => api.put(`/records/${recordId}/renewals/${renewal.id}`, payload),
    onSuccess: () => { onDone(); toast.success('Renewal entry updated'); onClose() },
    onError: (err) => setError(apiError(err, 'Could not update renewal entry')),
  })
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const s = (k: string) => String(fd.get(k) ?? '').trim() || null
    save.mutate({
      new_date: s('new_date'), renewed_on: s('renewed_on'), cost: s('cost') === null ? null : Number(s('cost')),
      currency: s('currency'), payment_method: s('payment_method'), payment_reference: s('payment_reference'),
      location: renewal.location, notes: s('notes'),
    })
  }
  return (
    <Modal title="Correct renewal entry" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="renewal-fix" disabled={save.isPending}>Save</Button></>}>
      <form id="renewal-fix" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {error && <div className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <label className="space-y-1"><span className="text-sm font-medium">New expiry</span><Input type="date" name="new_date" defaultValue={renewal.new_date} required /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Renewed on</span><Input type="date" name="renewed_on" defaultValue={renewal.renewed_on || ''} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Cost</span><Input type="number" step="any" min={0} name="cost" defaultValue={renewal.cost ?? ''} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Currency</span><Input name="currency" defaultValue={renewal.currency || ''} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Payment method</span><Input name="payment_method" defaultValue={renewal.payment_method || ''} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Reference</span><Input name="payment_reference" defaultValue={renewal.payment_reference || ''} /></label>
        <label className="sm:col-span-2 space-y-1"><span className="text-sm font-medium">Notes</span><textarea name="notes" className={textareaCls} defaultValue={renewal.notes || ''} /></label>
        <p className="sm:col-span-2 text-xs text-gray-400">If this is the newest entry, the record's expiry date follows it.</p>
      </form>
    </Modal>
  )
}

function AssignmentCorrection({ recordId, entry, onClose, onDone }: { recordId: number; entry: RecordAssignment; onClose: () => void; onDone: () => void }) {
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: async (payload: unknown) => api.put(`/records/${recordId}/assignments/${entry.id}`, payload),
    onSuccess: () => { onDone(); toast.success('History entry updated'); onClose() },
    onError: (err) => setError(apiError(err, 'Could not update history entry')),
  })
  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const fd = new FormData(e.currentTarget)
    const s = (k: string) => String(fd.get(k) ?? '').trim() || null
    save.mutate({
      employee_name: s('employee_name') || 'Unassigned', business_unit: s('business_unit'), effective_date: s('effective_date'),
      cost: s('cost') === null ? null : Number(s('cost')), currency: s('currency'), reason: s('reason'), notes: s('notes'),
    })
  }
  return (
    <Modal title="Correct history entry" onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button type="submit" form="assignment-fix" disabled={save.isPending}>Save</Button></>}>
      <form id="assignment-fix" onSubmit={submit} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {error && <div className="sm:col-span-2 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <label className="space-y-1"><span className="text-sm font-medium">Holder</span><Input name="employee_name" defaultValue={entry.employee_name} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">From</span><Input type="date" name="effective_date" defaultValue={entry.effective_date.slice(0, 10)} required /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Business unit</span><Input name="business_unit" defaultValue={entry.business_unit || ''} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Reason</span><Input name="reason" defaultValue={entry.reason || ''} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Seat cost</span><Input type="number" step="any" min={0} name="cost" defaultValue={entry.cost ?? ''} /></label>
        <label className="space-y-1"><span className="text-sm font-medium">Currency</span><Input name="currency" defaultValue={entry.currency || ''} /></label>
        <label className="sm:col-span-2 space-y-1"><span className="text-sm font-medium">Notes</span><textarea name="notes" className={textareaCls} defaultValue={entry.notes || ''} /></label>
      </form>
    </Modal>
  )
}
