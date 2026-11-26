import { useState } from 'react'
import {
  BODY_CONDITIONS, OS_OPTIONS, REPAIR_STATUSES, TASK_STATUSES, BODY_CONDITIONS as STATUSES, errorMessage, maintenanceChecklist,
  todayISO, useAssetMutation, useCurrency, useReference, type Asset, type Maintenance, type Repair,
} from '@workspace/core'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Combobox from '@/components/ui/combobox'
import { toast } from '@/components/ui/toaster'
import { EmployeePicker, Field, inputCls } from './shared'

const done = (msg: string, close: () => void) => ({ onSuccess: () => { toast.success(msg); close() }, onError: (e: unknown) => toast.error(errorMessage(e)) })

export function AssignDialog({ asset, onClose }: { asset: Asset; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [date, setDate] = useState(todayISO())
  const [remark, setRemark] = useState('')
  const m = useAssetMutation((a, unassign: boolean) => a.assets.assign(asset.id, { employee_id: unassign ? null : employeeId, effective_date: date, remark: remark || undefined }))
  return (
    <Modal title={asset.employee ? 'Reassign or unassign' : 'Assign asset'} subtitle={asset.display_name} onClose={onClose} footer={<>
      {asset.employee && <Button variant="outline" className="mr-auto" disabled={m.isPending} onClick={() => m.mutate(true, done('Asset unassigned', onClose))}>Unassign</Button>}
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!employeeId || m.isPending} onClick={() => m.mutate(false, done('Asset assigned', onClose))}>Assign</Button>
    </>}>
      <div className="space-y-3">
        {asset.employee && <p className="text-sm text-gray-600">Currently held by <b>{asset.employee.name}</b>.</p>}
        <Field label="New holder"><EmployeePicker value={employeeId} onChange={setEmployeeId} autoOpen /></Field>
        <Field label="Effective date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Remark"><Input value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="Optional" /></Field>
      </div>
    </Modal>
  )
}

export function RepairDialog({ asset, repair, onClose }: { asset: Pick<Asset, 'id' | 'display_name'>; repair?: Repair; onClose: () => void }) {
  const { data: ref } = useReference()
  const { data: cur } = useCurrency()
  const [f, setF] = useState({
    repair_date: repair?.repair_date ?? todayISO(), issue: repair?.issue ?? '', status: repair?.status ?? 'In Progress',
    cost: repair?.cost ?? '', currency: repair?.currency ?? '', vendor: repair?.vendor ?? '', warranty: repair?.warranty ?? '', notes: repair?.notes ?? '',
  })
  const m = useAssetMutation((a, _: void) => {
    const body = { ...f, cost: f.cost || null, currency: f.currency || (f.cost ? cur?.default_currency : null), vendor: f.vendor || null,
      warranty: f.warranty || null, notes: f.notes || null, status: f.status as Repair['status'] }
    return repair ? a.assets.updateRepair(asset.id, repair.id, body) : a.assets.addRepair(asset.id, body)
  })
  return (
    <Modal title={repair ? 'Edit repair' : 'Log repair'} subtitle={asset.display_name} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!f.issue.trim() || m.isPending} onClick={() => m.mutate(undefined, done(repair ? 'Repair updated' : 'Repair logged', onClose))}>Save</Button>
    </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Date" required><Input type="date" value={f.repair_date} onChange={(e) => setF({ ...f, repair_date: e.target.value })} /></Field>
        <Field label="Status"><Select value={f.status} onChange={(e) => setF({ ...f, status: e.target.value as Repair['status'] })}>{REPAIR_STATUSES.map((s) => <option key={s}>{s}</option>)}</Select></Field>
        <Field label="Issue / work done" required className="sm:col-span-2"><textarea className={`${inputCls} h-20`} value={f.issue} onChange={(e) => setF({ ...f, issue: e.target.value })} /></Field>
        <Field label="Vendor"><Combobox value={f.vendor || null} onChange={(v) => setF({ ...f, vendor: v ?? '' })} options={(ref?.vendor ?? []).map((v) => ({ value: v.name, label: v.name }))} allowCustom placeholder="Repair shop" /></Field>
        <Field label="Cost"><div className="flex gap-2"><Input type="number" min="0" step="0.01" value={f.cost ?? ''} onChange={(e) => setF({ ...f, cost: e.target.value })} /><Input className="w-24" placeholder={cur?.default_currency} value={f.currency ?? ''} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div></Field>
        <Field label="Repair warranty"><Input value={f.warranty ?? ''} onChange={(e) => setF({ ...f, warranty: e.target.value })} placeholder="e.g. 30 days" /></Field>
        <Field label="Notes"><Input value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
      <p className="mt-3 text-xs text-gray-500">An in-progress repair marks the asset <b>In Repair</b>; completing every repair returns it to Operational.</p>
    </Modal>
  )
}

export function MaintenanceDialog({ asset, entry, onClose }: { asset: Pick<Asset, 'id' | 'display_name' | 'asset_type'>; entry?: Maintenance; onClose: () => void }) {
  const list = maintenanceChecklist(asset.asset_type)
  const initial = entry?.components ?? [...list.hardware.map((c) => ({ component: c, status: 'Good' })), ...list.software.map((c) => ({ component: c, status: 'Done' }))]
  const [f, setF] = useState({
    maintenance_date: entry?.maintenance_date ?? todayISO(), operating_system: entry?.operating_system ?? '',
    body_condition: entry?.body_condition ?? 'Good', asset_status: entry?.asset_status ?? 'Operational', notes: entry?.notes ?? '',
  })
  const [components, setComponents] = useState(initial)
  const m = useAssetMutation((a, _: void) => {
    const body = { ...f, operating_system: f.operating_system || null, notes: f.notes || null, components, body_condition: f.body_condition as Maintenance['body_condition'] }
    return entry ? a.assets.updateMaintenance(asset.id, entry.id, body) : a.assets.addMaintenance(asset.id, body)
  })
  const isTask = (c: string) => list.software.includes(c)
  return (
    <Modal size="lg" title={entry ? 'Edit maintenance' : 'Log maintenance'} subtitle={asset.display_name} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={m.isPending} onClick={() => m.mutate(undefined, done('Maintenance saved', onClose))}>Save</Button>
    </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Field label="Date" required><Input type="date" value={f.maintenance_date} onChange={(e) => setF({ ...f, maintenance_date: e.target.value })} /></Field>
        <Field label="Operating system"><Select value={f.operating_system ?? ''} onChange={(e) => setF({ ...f, operating_system: e.target.value })}><option value="">—</option>{OS_OPTIONS.map((o) => <option key={o}>{o}</option>)}</Select></Field>
        <Field label="Body condition"><Select value={f.body_condition} onChange={(e) => setF({ ...f, body_condition: e.target.value as typeof f.body_condition })}>{BODY_CONDITIONS.map((o) => <option key={o}>{o}</option>)}</Select></Field>
      </div>
      {components.length > 0 && (
        <div className="mt-4 divide-y rounded-lg border">
          {components.map((c, i) => (
            <div key={c.component} className="flex items-center gap-3 px-3 py-1.5">
              <span className="flex-1 text-sm text-gray-700">{c.component}</span>
              <Select className="h-8 w-40" value={c.status} onChange={(e) => setComponents(components.map((x, j) => j === i ? { ...x, status: e.target.value } : x))}>
                {(isTask(c.component) ? TASK_STATUSES : STATUSES).map((s) => <option key={s}>{s}</option>)}
              </Select>
            </div>
          ))}
        </div>
      )}
      <Field label="Notes" className="mt-3"><textarea className={`${inputCls} h-16`} value={f.notes ?? ''} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
    </Modal>
  )
}

export function BorrowDialog({ asset, onClose }: { asset?: Pick<Asset, 'id' | 'display_name'>; onClose: () => void }) {
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [f, setF] = useState({ item_name: '', borrower_name: '', borrowed_date: todayISO(), expected_return_date: '', notes: '' })
  const m = useAssetMutation((a, _: void) => a.borrows.create({
    asset_id: asset?.id ?? null, item_name: f.item_name || null, employee_id: employeeId, borrower_name: f.borrower_name || null,
    borrowed_date: f.borrowed_date, expected_return_date: f.expected_return_date || null, notes: f.notes || null,
  }))
  return (
    <Modal title="Lend item" subtitle={asset?.display_name ?? 'Untracked item (cable, adapter…)'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={m.isPending || (!asset && !f.item_name.trim()) || (!employeeId && !f.borrower_name.trim())}
        onClick={() => m.mutate(undefined, done('Borrow logged', onClose))}>Save</Button>
    </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!asset && <Field label="Item" required className="sm:col-span-2"><Input value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} /></Field>}
        <Field label="Employee" className="sm:col-span-2"><EmployeePicker value={employeeId} onChange={setEmployeeId} /></Field>
        {!employeeId && <Field label="…or borrower name" className="sm:col-span-2"><Input value={f.borrower_name} onChange={(e) => setF({ ...f, borrower_name: e.target.value })} placeholder="Guest, contractor…" /></Field>}
        <Field label="Borrowed on"><Input type="date" value={f.borrowed_date} onChange={(e) => setF({ ...f, borrowed_date: e.target.value })} /></Field>
        <Field label="Expected return"><Input type="date" min={f.borrowed_date} value={f.expected_return_date} onChange={(e) => setF({ ...f, expected_return_date: e.target.value })} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </div>
    </Modal>
  )
}
