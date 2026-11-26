import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, GENDERS } from '@workspace/core'
import api from '@/lib/api'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import SearchableSelect from '@/components/SearchableSelect'
import { toast } from '@/components/ui/toaster'
import { Field } from '@/components/assets/shared'

/** Quick "new employee" form used by the global Create menu. */
export default function EmployeeFormDialog({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient()
  const { data: units = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['business-units'], queryFn: async () => (await api.get('/business-units')).data })
  const [f, setF] = useState({ name: '', email: '', title: '', business_units: [] as string[], join_date: '', gender: '' })
  const [busy, setBusy] = useState(false)
  const save = async () => {
    setBusy(true)
    try {
      await api.post('/employees', { ...f, email: f.email || null, title: f.title || null, join_date: f.join_date || null, gender: f.gender || null })
      toast.success(`${f.name} added`)
      qc.invalidateQueries({ queryKey: ['employees'] })
      onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  return (
    <Modal title="New employee" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!f.name.trim() || busy} onClick={save}>{busy ? 'Saving…' : 'Add employee'}</Button>
    </>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Full name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
        <Field label="Job title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Business units" className="sm:col-span-2">
          <SearchableSelect multiple options={units.map((u) => ({ value: u.name, label: u.name }))} value={f.business_units} onChange={(v) => setF({ ...f, business_units: v as string[] })} placeholder="Choose units…" />
        </Field>
        <Field label="Join date"><Input type="date" value={f.join_date} onChange={(e) => setF({ ...f, join_date: e.target.value })} /></Field>
        <Field label="Gender"><Select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">Not set</option>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
      </div>
    </Modal>
  )
}
