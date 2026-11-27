import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { errorMessage, GENDERS, todayISO } from '@workspace/core'
import api from '@/lib/api'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import SearchableSelect from '@/components/SearchableSelect'
import { toast } from '@/components/ui/toaster'
import { Field } from '@/components/assets/shared'
import { cn } from '@/lib/utils'
import { countryOptions } from '@/lib/countries'

export interface EmployeeFormValue {
  id?: number
  name: string
  email?: string | null
  phone?: string | null
  title?: string | null
  business_units?: string[]
  department?: string | null
  country?: string | null
  join_date?: string | null
  resignation_date?: string | null
  gender?: string | null
  active?: boolean
}

/** Add or edit an employee: contact, job, department, country, business units (multi-select) and employment dates. */
export default function EmployeeFormDialog({ employee, onClose, onSaved }: { employee?: EmployeeFormValue; onClose: () => void; onSaved?: () => void }) {
  const qc = useQueryClient()
  const { data: units = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['business-units'], queryFn: async () => (await api.get('/business-units')).data })
  const { data: departments = [] } = useQuery<{ id: number; name: string }[]>({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data })
  const [f, setF] = useState({
    name: employee?.name ?? '', email: employee?.email ?? '', phone: employee?.phone ?? '', title: employee?.title ?? '',
    business_units: employee?.business_units ?? [], department: employee?.department ?? '', country: employee?.country ?? '', join_date: employee?.join_date ?? '', gender: employee?.gender ?? '',
    resigned: employee ? employee.active === false : false, resignation_date: employee?.resignation_date ?? '',
  })
  const [busy, setBusy] = useState(false)
  const invalidDates = !!(f.resigned && f.resignation_date && f.join_date && f.resignation_date < f.join_date)

  const save = async () => {
    setBusy(true)
    const body = {
      name: f.name.trim(), email: f.email.trim() || null, phone: f.phone.trim() || null, title: f.title.trim() || null,
      business_units: f.business_units, department: f.department || null, country: f.country || null, join_date: f.join_date || null, gender: f.gender || null,
      active: !f.resigned, resignation_date: f.resigned ? (f.resignation_date || todayISO()) : null,
    }
    try {
      if (employee?.id) await api.put(`/employees/${employee.id}`, body)
      else await api.post('/employees', body)
      toast.success(employee?.id ? `${body.name} updated` : `${body.name} added`)
      qc.invalidateQueries({ queryKey: ['employees'] }); qc.invalidateQueries({ queryKey: ['employee-overview'] }); qc.invalidateQueries({ queryKey: ['departments'] })
      onSaved?.(); onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal size="lg" title={employee?.id ? `Edit ${employee.name}` : 'New employee'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!f.name.trim() || busy || invalidDates} onClick={save}>{busy ? 'Saving…' : employee?.id ? 'Save changes' : 'Add employee'}</Button>
    </>}>
      <div className="space-y-5">
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Full name" required className="sm:col-span-2"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="off" /></Field>
          <Field label="Email"><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="name@company.com" /></Field>
          <Field label="Phone" hint="Optional"><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+95 9 …" /></Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Job title"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="e.g. Accountant" /></Field>
          <Field label="Gender"><Select value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}><option value="">Not set</option>{GENDERS.map((g) => <option key={g}>{g}</option>)}</Select></Field>
          <Field label="Department">
            <SearchableSelect options={[...(f.department && !departments.some((d) => d.name === f.department) ? [f.department] : []), ...departments.map((d) => d.name)].map((n) => ({ value: n, label: n }))}
              value={f.department} onChange={(v) => setF({ ...f, department: v as string })} placeholder="Choose a department…" />
          </Field>
          <Field label="Country">
            <SearchableSelect options={countryOptions(f.country)} value={f.country} onChange={(v) => setF({ ...f, country: v as string })} placeholder="Choose a country…" />
          </Field>
          <Field label="Business units" className="sm:col-span-2" hint="Pick one or more">
            <SearchableSelect multiple options={units.map((u) => ({ value: u.name, label: u.name }))} value={f.business_units}
              onChange={(v) => setF({ ...f, business_units: v as string[] })} placeholder="Choose business units…" />
          </Field>
        </section>

        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Joined on"><Input type="date" value={f.join_date} max={todayISO()} onChange={(e) => setF({ ...f, join_date: e.target.value })} /></Field>
          <Field label="Status">
            <div role="radiogroup" className="grid h-10 grid-cols-2 gap-1 rounded-lg bg-gray-100 p-1">
              {[false, true].map((resigned) => (
                <button key={String(resigned)} type="button" role="radio" aria-checked={f.resigned === resigned}
                  onClick={() => setF({ ...f, resigned, resignation_date: resigned ? (f.resignation_date || todayISO()) : '' })}
                  className={cn('press rounded-md text-sm font-medium', f.resigned === resigned ? 'bg-white text-gray-900 shadow-soft' : 'text-gray-500')}>
                  {resigned ? 'Resigned' : 'Active'}
                </button>
              ))}
            </div>
          </Field>
          {f.resigned && (
            <Field label="Resigned on" className="animate-pop-in">
              <Input type="date" value={f.resignation_date} min={f.join_date || undefined} onChange={(e) => setF({ ...f, resignation_date: e.target.value })} />
            </Field>
          )}
          {f.resigned && <p className="self-end pb-2 text-xs text-gray-500">To also return assets and release seats, use <b>Offboard</b> instead.</p>}
          {invalidDates && <p className="text-xs text-red-600 sm:col-span-2">The resignation date can’t be before the join date.</p>}
        </section>
      </div>
    </Modal>
  )
}
