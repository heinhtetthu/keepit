import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { formatDate } from '@workspace/core'
import api from '@/lib/api'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { apiError, todayLocal } from '@/lib/seats'
import type { UpcomingItem } from './shared'

const CYCLE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, 'semi-annual': 6, semiannual: 6, yearly: 12, annual: 12, biennial: 24 }

function addMonths(iso: string, months: number) {
  const [y, m, d] = iso.split('-').map(Number)
  const t = y * 12 + (m - 1) + months
  const ny = Math.floor(t / 12), nm = (t % 12) + 1
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
  return `${ny}-${String(nm).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}

/** Next expiry: extend by whole billing cycles until it is past today. */
function suggest(expiry: string, cycle: string | null) {
  const months = cycle?.trim() ? CYCLE_MONTHS[cycle.trim().toLowerCase()] : 12
  if (!months || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return ''
  let d = addMonths(expiry, months)
  for (let guard = 0; d <= todayLocal() && guard < 600; guard++) d = addMonths(d, months)
  return d
}

/** Quick renewal from the Reminders page. The full form with payment details lives on the record. */
export default function RenewDialog({ item, onClose, onDone }: { item: UpcomingItem; onClose: () => void; onDone: () => void }) {
  const [newDate, setNewDate] = useState(() => suggest(item.expiry_date, item.cycle))
  const [cost, setCost] = useState(item.cost == null ? '' : String(item.cost))
  const [notes, setNotes] = useState('')
  const [error, setError] = useState('')
  const save = useMutation({
    mutationFn: async () => api.post(`/records/${item.id}/renew`, {
      new_date: newDate, cost: cost === '' ? null : Number(cost), currency: item.currency || null, notes: notes.trim() || null,
    }),
    onSuccess: () => { toast.success(`${item.name} renewed until ${formatDate(newDate)}`); onDone(); onClose() },
    onError: (err) => setError(apiError(err, 'Could not renew this record')),
  })
  const quick = [1, 3, 6, 12, 24].map((m) => ({ months: m, date: addMonths(item.expiry_date, m) })).filter((q) => q.date > item.expiry_date)

  return (
    <Modal title="Renew" subtitle={item.name} size="sm" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!newDate || newDate <= item.expiry_date || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : 'Renew'}</Button>
    </>}>
      <div className="space-y-4">
        {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="rounded-lg border bg-gray-50 px-3 py-2 text-sm">
          <span className="text-gray-500">Current expiry </span>
          <span className="font-medium text-gray-900">{formatDate(item.expiry_date)}</span>
          {item.cycle && <span className="text-gray-500">, billed {String(item.cycle).toLowerCase()}</span>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="renew-date" className="text-sm font-medium">New expiry date</label>
          <Input id="renew-date" type="date" value={newDate} min={item.expiry_date} onChange={(e) => setNewDate(e.target.value)} />
          <div className="flex flex-wrap gap-1.5 pt-1">
            {quick.map((q) => (
              <button key={q.months} type="button" onClick={() => setNewDate(q.date)}
                className={`press rounded-full border px-2.5 py-1 text-xs ${newDate === q.date ? 'border-primary bg-primary/10 text-primary' : 'text-gray-600 hover:bg-gray-50'}`}>
                +{q.months < 12 ? `${q.months} mo` : `${q.months / 12} yr`}
              </button>
            ))}
          </div>
          {newDate && newDate <= item.expiry_date && <p className="text-xs text-red-600">Pick a date after the current expiry.</p>}
        </div>
        <div className="space-y-1.5">
          <label htmlFor="renew-cost" className="text-sm font-medium">Cost{item.currency ? ` (${item.currency})` : ''}</label>
          <Input id="renew-cost" type="number" step="any" min={0} value={cost} onChange={(e) => setCost(e.target.value)} placeholder="Optional" />
        </div>
        <div className="space-y-1.5">
          <label htmlFor="renew-notes" className="text-sm font-medium">Notes</label>
          <Input id="renew-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
        </div>
        <p className="text-xs text-gray-500">Payment method and reference can be added from the record's renewal history.</p>
      </div>
    </Modal>
  )
}
