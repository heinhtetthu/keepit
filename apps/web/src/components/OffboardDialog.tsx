import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Modal from '@/components/ui/modal'
import Avatar from '@/components/ui/avatar'
import { toast } from '@/components/ui/toaster'
import { apiError, todayLocal } from '@/lib/seats'
import { useAuthStore } from '../store/auth'
import type { Employee } from '../types'

interface Holding {
  record_id: number
  name: string
  record_type_name: string
  record_type_slug: string
  product: string | null
  since: string | null
}

/** Resignation flow: list what the person holds, release it all in one click. */
export default function OffboardDialog({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const qc = useQueryClient()
  const isAdmin = useAuthStore((s) => s.hasPermission('employee.manage'))
  const [date, setDate] = useState(todayLocal())
  const [deactivate, setDeactivate] = useState(isAdmin && employee.active)
  const [error, setError] = useState('')

  const { data: holdings, isLoading } = useQuery<Holding[]>({
    queryKey: ['employee-holdings', employee.id],
    queryFn: async () => (await api.get(`/employees/${employee.id}/holdings`)).data,
  })

  const release = useMutation({
    mutationFn: async () => (await api.post(`/employees/${employee.id}/release`, { effective_date: date, reason: 'Resignation', deactivate })).data,
    onSuccess: (res: { released: number }) => {
      for (const key of [['employees'], ['employee-holdings'], ['records'], ['records-summary'], ['record'], ['record-assignments']]) qc.invalidateQueries({ queryKey: key })
      toast.success(`${employee.name}: ${res.released} seat${res.released === 1 ? '' : 's'} unassigned${deactivate ? ', employee deactivated' : ''}`)
      onClose()
    },
    onError: (err) => setError(apiError(err, 'Offboarding failed')),
  })

  const count = holdings?.length ?? 0
  return (
    <Modal
      title={`Offboard ${employee.name}`}
      subtitle={employee.email || undefined}
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="destructive" disabled={isLoading || release.isPending || (!count && !deactivate)} onClick={() => release.mutate()}>
            {release.isPending ? 'Working…' : count ? `Unassign ${count} seat${count === 1 ? '' : 's'}` : 'Deactivate'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <div className="rounded-lg border">
          {isLoading ? (
            <p className="px-3 py-6 text-center text-sm text-gray-400">Looking up their seats…</p>
          ) : count === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-gray-500">{employee.name} doesn't hold any seats.</p>
          ) : (
            <ul className="divide-y max-h-60 overflow-y-auto">
              {holdings!.map((h) => (
                <li key={h.record_id} className="flex items-center gap-3 px-3 py-2">
                  <Avatar name={employee.name} size="sm" />
                  <div className="min-w-0 flex-1">
                    <Link to={`/records/${h.record_type_slug}/${h.record_id}`} onClick={onClose} className="block truncate text-sm font-medium hover:underline">{h.product || h.name}</Link>
                    <p className="truncate text-xs text-gray-500">{h.record_type_name}{h.since ? ` · since ${h.since}` : ''}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="text-sm text-gray-600">The seats stay active and become <b>unassigned</b>, ready to hand to someone else. Ownership history is kept.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="space-y-1">
            <span className="text-sm font-medium">Last day</span>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {isAdmin && employee.active && (
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-primary" checked={deactivate} onChange={(e) => setDeactivate(e.target.checked)} />
              Also deactivate the employee
            </label>
          )}
        </div>
      </div>
    </Modal>
  )
}
