import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeftRight, ArrowRight, UserMinus } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Modal from '@/components/ui/modal'
import Avatar from '@/components/ui/avatar'
import Combobox, { type ComboOption } from '@/components/ui/combobox'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import { apiError, seatFields, todayLocal } from '@/lib/seats'
import type { Employee, RecordItem, RecordType } from '../types'

export type SeatMode = 'reassign' | 'swap' | 'unassign'

export interface SeatRef {
  id: number
  name: string
  holder: string | null
  product: string | null
}

/** The seat view of a record (holder, product) from its list values. */
export function seatOf(rt: RecordType, values: Record<string, any>, id: number, name: string): SeatRef {
  const f = seatFields(rt)
  const holder = f.assignee ? values[f.assignee.slug] : null
  return {
    id, name,
    holder: holder && holder !== 'Unassigned' ? String(holder) : null,
    product: f.product && values[f.product.slug] ? String(values[f.product.slug]) : null,
  }
}

const UNASSIGN_REASONS = ['Resignation', 'No longer needed', 'Moved to another seat', 'Other']
const UNASSIGNED = '__unassigned__'

const SEAT_KEYS = [['records'], ['record'], ['record-assignments'], ['records-summary'], ['employee-holdings'], ['seat-options'], ['dashboard']]

function useEmployeeOptions(enabled: boolean) {
  const { data: employees = [] } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/employees')).data,
    enabled,
  })
  const options: ComboOption[] = useMemo(() => employees.map((e) => ({
    value: String(e.id),
    label: e.name,
    sublabel: [e.email, e.business_units.join(', ')].filter(Boolean).join(' · ') || undefined,
    keywords: `${e.email || ''} ${e.business_units.join(' ')}`,
    leading: <Avatar name={e.name} size="sm" />,
  })), [employees])
  return { employees, options }
}

function useSeatOptions(recordType: RecordType, enabled: boolean, exclude: number[] = []) {
  const { data } = useQuery<{ items: RecordItem[] }>({
    queryKey: ['seat-options', recordType.id],
    queryFn: async () => (await api.get(`/records/by-type/${recordType.id}`, { params: { page_size: 100, sort: 'name' } })).data,
    enabled,
  })
  const seats = (data?.items || []).map((r) => seatOf(recordType, r.values || {}, r.id, r.name))
  const options: ComboOption[] = seats.filter((s) => !exclude.includes(s.id)).map((s) => ({
    value: String(s.id),
    label: s.holder || 'Unassigned',
    sublabel: s.product || s.name,
    keywords: s.name,
    leading: <Avatar name={s.holder} size="sm" />,
  }))
  return { seats, options }
}

function DateAndNote({ date, setDate, notes, setNotes }: { date: string; setDate: (v: string) => void; notes: string; setNotes: (v: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      <label className="space-y-1">
        <span className="text-sm font-medium">Effective from</span>
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </label>
      <label className="space-y-1">
        <span className="text-sm font-medium">Note <span className="font-normal text-gray-400">(optional)</span></span>
        <Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ticket #, handover…" />
      </label>
    </div>
  )
}

export default function SeatDialog({ mode, seat, recordType, onClose }: {
  mode: SeatMode
  seat: SeatRef
  recordType: RecordType
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [date, setDate] = useState(todayLocal())
  const [notes, setNotes] = useState('')
  const [personId, setPersonId] = useState<string | null>(null)
  const [customName, setCustomName] = useState<string | null>(null)
  const [bu, setBu] = useState<string | null>(null)
  const [targetId, setTargetId] = useState<string | null>(null)
  const [reason, setReason] = useState(UNASSIGN_REASONS[0])
  const [error, setError] = useState('')
  const { employees, options: people } = useEmployeeOptions(mode === 'reassign')
  const { seats, options: seatOptions } = useSeatOptions(recordType, mode === 'swap', [seat.id])
  const employee = employees.find((e) => String(e.id) === personId) || null
  const target = seats.find((s) => String(s.id) === targetId) || null

  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'swap') return api.post(`/records/${seat.id}/swap`, { other_record_id: target!.id, effective_date: date, notes: notes.trim() || null })
      if (mode === 'unassign') return api.post(`/records/${seat.id}/assignments`, { unassign: true, effective_date: date, reason, notes: notes.trim() || null })
      return api.post(`/records/${seat.id}/assignments`, {
        employee_id: employee?.id ?? null, employee_name: employee ? employee.name : customName,
        business_unit: bu, effective_date: date, reason: seat.holder ? 'Reassigned' : 'Assigned', notes: notes.trim() || null,
      })
    },
    onSuccess: () => {
      SEAT_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: key }))
      toast.success(mode === 'swap' ? `Swapped ${seat.holder || 'Unassigned'} and ${target?.holder || 'Unassigned'}`
        : mode === 'unassign' ? 'Seat unassigned' : `Assigned to ${employee?.name || customName}`)
      onClose()
    },
    onError: (err) => setError(apiError(err, 'Could not save the change')),
  })

  const ready = mode === 'swap' ? !!target : mode === 'unassign' ? true : !!(employee || customName)
  const title = mode === 'swap' ? 'Swap seat' : mode === 'unassign' ? 'Unassign seat' : seat.holder ? 'Reassign seat' : 'Assign seat'

  return (
    <Modal
      title={title}
      subtitle={[seat.product, seat.holder || 'Unassigned'].filter(Boolean).join(' · ')}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant={mode === 'unassign' ? 'destructive' : 'default'} disabled={!ready || submit.isPending} onClick={() => { setError(''); submit.mutate() }}>
            {submit.isPending ? 'Saving…' : mode === 'swap' ? 'Swap holders' : mode === 'unassign' ? 'Unassign' : 'Assign'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}

        {mode === 'reassign' && (
          <div className="space-y-1.5">
            <span className="text-sm font-medium">New holder</span>
            <Combobox
              autoOpen
              options={people.filter((p) => p.label !== seat.holder)}
              value={personId ?? customName}
              allowCustom
              placeholder="Choose a person"
              searchPlaceholder="Search name, email or unit"
              onChange={(v, isCustom) => {
                if (isCustom) { setCustomName(v); setPersonId(null); setBu(null); return }
                setPersonId(v); setCustomName(null)
                const e = employees.find((x) => String(x.id) === v)
                setBu(e && e.business_units.length === 1 ? e.business_units[0] : null)
              }}
            />
            {employee && employee.business_units.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-1">
                <span className="text-xs text-gray-500">Charge to:</span>
                {employee.business_units.map((b) => (
                  <button key={b} onClick={() => setBu(b)} className={cn('rounded-full border px-2.5 py-0.5 text-xs', bu === b ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>{b}</button>
                ))}
              </div>
            )}
          </div>
        )}

        {mode === 'swap' && (
          <>
            <div className="space-y-1.5">
              <span className="text-sm font-medium">Swap with</span>
              <Combobox autoOpen options={seatOptions} value={targetId} onChange={(v) => setTargetId(v)} placeholder="Choose a seat" searchPlaceholder="Search person or product" emptyText="No other seats match" />
            </div>
            {target && (
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 rounded-lg bg-gray-50 p-3 text-sm">
                <div className="min-w-0 text-right"><p className="truncate font-medium">{target.holder || 'Unassigned'}</p><p className="truncate text-xs text-gray-500">gets {seat.product || seat.name}</p></div>
                <ArrowLeftRight className="h-4 w-4 text-gray-400" />
                <div className="min-w-0"><p className="truncate font-medium">{seat.holder || 'Unassigned'}</p><p className="truncate text-xs text-gray-500">gets {target.product || target.name}</p></div>
              </div>
            )}
          </>
        )}

        {mode === 'unassign' && (
          <>
            <p className="text-sm text-gray-600">
              <b className="text-gray-900">{seat.holder || 'Nobody'}</b> loses this seat. It stays active and unassigned, ready for someone else. History is kept.
            </p>
            <div className="flex flex-wrap gap-1.5">
              {UNASSIGN_REASONS.map((r) => (
                <button key={r} onClick={() => setReason(r)} className={cn('rounded-full border px-3 py-1 text-sm', reason === r ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}>{r}</button>
              ))}
            </div>
          </>
        )}

        <DateAndNote date={date} setDate={setDate} notes={notes} setNotes={setNotes} />
      </div>
    </Modal>
  )
}

/** Change several seats at once: pick a new holder per row, swap two, or unassign all. */
export function BulkSeatDialog({ records, recordType, onClose }: { records: RecordItem[]; recordType: RecordType; onClose: () => void }) {
  const qc = useQueryClient()
  const seats = records.map((r) => seatOf(recordType, r.values || {}, r.id, r.name))
  const [date, setDate] = useState(todayLocal())
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  // per seat: employee id, "custom:<name>", UNASSIGNED, or null = keep
  const [targets, setTargets] = useState<Record<number, string | null>>({})
  const { employees, options: people } = useEmployeeOptions(true)
  const choices: ComboOption[] = useMemo(() => [
    { value: UNASSIGNED, label: 'Unassigned', sublabel: 'Free the seat', leading: <Avatar name={null} size="sm" /> },
    ...people,
  ], [people])

  const holderToValue = (holder: string | null) => {
    if (!holder) return UNASSIGNED
    const e = employees.find((x) => x.name.toLowerCase() === holder.toLowerCase())
    return e ? String(e.id) : `custom:${holder}`
  }
  const swapTwo = () => setTargets({ [seats[0].id]: holderToValue(seats[1].holder), [seats[1].id]: holderToValue(seats[0].holder) })
  const unassignAll = () => setTargets(Object.fromEntries(seats.map((s) => [s.id, UNASSIGNED])))

  type BulkItem = { record_id: number; unassign?: boolean; employee_id?: number; employee_name?: string }
  const items = seats.flatMap((s): BulkItem[] => {
    const t = targets[s.id]
    if (!t) return []
    if (t === UNASSIGNED) return [{ record_id: s.id, unassign: true }]
    if (t.startsWith('custom:')) return [{ record_id: s.id, employee_name: t.slice(7) }]
    return [{ record_id: s.id, employee_id: Number(t) }]
  })

  const save = useMutation({
    mutationFn: async () => (await api.post('/records/bulk/assignments', { items, effective_date: date, notes: notes.trim() || null })).data as { changed: number },
    onSuccess: (res) => {
      SEAT_KEYS.forEach((key) => qc.invalidateQueries({ queryKey: key }))
      toast.success(`${res.changed} seat${res.changed === 1 ? '' : 's'} updated`)
      onClose()
    },
    onError: (err) => setError(apiError(err, 'Could not save the changes')),
  })

  return (
    <Modal
      size="lg"
      title={`Change ${seats.length} seats`}
      subtitle="Pick a new holder for each seat you want to change. Leave the rest as they are."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={!items.length || save.isPending} onClick={() => { setError(''); save.mutate() }}>
            {save.isPending ? 'Saving…' : `Apply ${items.length || ''} change${items.length === 1 ? '' : 's'}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="flex flex-wrap gap-2">
          {seats.length === 2 && <Button variant="outline" size="sm" onClick={swapTwo}><ArrowLeftRight className="mr-1.5 h-3.5 w-3.5" />Swap these two</Button>}
          <Button variant="outline" size="sm" onClick={unassignAll}><UserMinus className="mr-1.5 h-3.5 w-3.5" />Unassign all</Button>
          {items.length > 0 && <Button variant="ghost" size="sm" onClick={() => setTargets({})}>Reset</Button>}
        </div>
        <ul className="divide-y rounded-lg border">
          {seats.map((s) => {
            const t = targets[s.id] ?? null
            return (
              <li key={s.id} className="grid grid-cols-1 items-center gap-2 p-3 sm:grid-cols-[1fr_auto_1.2fr]">
                <div className="flex min-w-0 items-center gap-2.5">
                  <Avatar name={s.holder} size="sm" />
                  <div className="min-w-0">
                    <p className={cn('truncate text-sm font-medium', !s.holder && 'italic text-gray-400')}>{s.holder || 'Unassigned'}</p>
                    <p className="truncate text-xs text-gray-500">{s.product || s.name}</p>
                  </div>
                </div>
                <ArrowRight className="hidden h-4 w-4 text-gray-300 sm:block" />
                <Combobox
                  options={choices}
                  value={t?.startsWith('custom:') ? t.slice(7) : t}
                  allowCustom
                  placeholder="Keep as is"
                  searchPlaceholder="Search people"
                  className={cn('h-9', t && 'border-primary/50 bg-primary/5')}
                  onChange={(v, isCustom) => setTargets((cur) => ({ ...cur, [s.id]: isCustom ? `custom:${v}` : v }))}
                />
              </li>
            )
          })}
        </ul>
        <DateAndNote date={date} setDate={setDate} notes={notes} setNotes={setNotes} />
      </div>
    </Modal>
  )
}
