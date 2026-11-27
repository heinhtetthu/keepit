import { useMemo, useState } from 'react'
import {
  BODY_CONDITIONS, OS_OPTIONS, REPAIR_STATUSES, TASK_STATUSES, BODY_CONDITIONS as STATUSES, errorMessage, maintenanceChecklist,
  formatDate, todayISO, useAssetMutation, useCurrency, useReference, type Asset, type Borrow, type Maintenance, type Repair,
} from '@workspace/core'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Combobox from '@/components/ui/combobox'
import { toast } from '@/components/ui/toaster'
import { EmployeePicker, Field, inputCls } from './shared'
import ITLogItemPicker, { type LendItem } from './ITLogItemPicker'

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
        <Field label="Operating system"><Select value={f.operating_system ?? ''} onChange={(e) => setF({ ...f, operating_system: e.target.value })}><option value="">-</option>{OS_OPTIONS.map((o) => <option key={o}>{o}</option>)}</Select></Field>
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

/** Lend an item (create) or fix any detail of an existing borrow entry (edit). */
export function BorrowDialog({ asset, borrow, onClose }: { asset?: Pick<Asset, 'id' | 'display_name'>; borrow?: Borrow; onClose: () => void }) {
  const editing = !!borrow
  const [item, setItem] = useState<LendItem>(borrow ? (borrow.asset_id ? { kind: 'asset', id: borrow.asset_id } : { kind: 'other' }) : asset ? { kind: 'asset', id: asset.id } : null)
  const [employeeId, setEmployeeId] = useState<number | null>(borrow?.employee_id ?? null)
  const [f, setF] = useState({
    item_name: borrow && !borrow.asset_id ? borrow.item_name : '',
    borrower_name: borrow && !borrow.employee_id ? borrow.borrower_name : '',
    borrowed_date: borrow?.borrowed_date ?? todayISO(), expected_return_date: borrow?.expected_return_date ?? '',
    returned_date: borrow?.returned_date ?? '', notes: borrow?.notes ?? '',
  })
  const today = todayISO()
  const current = useMemo(() => (borrow?.asset_id ? {
    id: borrow.asset_id, asset_type: borrow.asset_type ?? 'Asset', other_type_name: null, brand: null, model: null,
    serial_number: borrow.serial_number ?? null, display_name: borrow.item_name,
  } : null), [borrow])
  const other = item?.kind === 'other'
  const assetId = item?.kind === 'asset' ? item.id : null
  const dateError = f.expected_return_date && f.expected_return_date < f.borrowed_date ? 'Expected return cannot be before the borrow date'
    : f.returned_date && f.returned_date < f.borrowed_date ? 'Return date cannot be before the borrow date'
      : f.returned_date && f.returned_date > today ? 'Return date cannot be in the future' : ''
  const m = useAssetMutation((a, _: void) => {
    const who = { employee_id: employeeId, borrower_name: employeeId ? null : f.borrower_name.trim() || null }
    const dates = { borrowed_date: f.borrowed_date, expected_return_date: f.expected_return_date || null }
    if (borrow) {
      return a.borrows.update(borrow.id, {
        asset_id: assetId, ...(other ? { item_name: f.item_name.trim() } : {}), ...who,
        ...(employeeId ? {} : { borrower_email: null }), ...dates, returned_date: f.returned_date || null, notes: f.notes.trim() || null,
      })
    }
    return a.borrows.create({ asset_id: assetId, item_name: other ? f.item_name.trim() : null, ...who, ...dates, notes: f.notes.trim() || null })
  })
  const fixedAsset = !!asset && !borrow
  const missingItem = !fixedAsset && (!item || (other && !f.item_name.trim()))
  return (
    <Modal title={editing ? 'Edit borrow entry' : 'Lend item'} subtitle={fixedAsset ? asset.display_name : editing ? borrow.item_name : 'An asset we have, or anything else (cable, adapter…)'} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={m.isPending || missingItem || (!employeeId && !f.borrower_name.trim()) || !f.borrowed_date || !!dateError}
        onClick={() => m.mutate(undefined, done(editing ? 'Borrow entry updated' : 'Borrow logged', onClose))}>Save</Button>
    </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {!fixedAsset && <Field label="Item" required className="sm:col-span-2"
          hint={editing && borrow.returned_date === null && item?.kind === 'asset' && item.id !== borrow.asset_id ? 'The old asset becomes available again and the new one is marked Borrowed.' : undefined}>
          <ITLogItemPicker value={item} onChange={setItem} current={current} autoOpen={!editing} />
        </Field>}
        {!fixedAsset && other && <Field label="Item name" required className="sm:col-span-2">
          <Input autoFocus value={f.item_name} onChange={(e) => setF({ ...f, item_name: e.target.value })} placeholder="e.g. HDMI cable, USB-C adapter" />
        </Field>}
        <Field label="Employee" className="sm:col-span-2"><EmployeePicker value={employeeId} onChange={setEmployeeId} includeInactive={editing} /></Field>
        {!employeeId && <Field label="…or borrower name" className="sm:col-span-2"><Input value={f.borrower_name} onChange={(e) => setF({ ...f, borrower_name: e.target.value })} placeholder="Guest, contractor…" /></Field>}
        <Field label="Borrowed on" required><Input type="date" value={f.borrowed_date} onChange={(e) => setF({ ...f, borrowed_date: e.target.value })} /></Field>
        <Field label="Expected return"><Input type="date" min={f.borrowed_date} value={f.expected_return_date} onChange={(e) => setF({ ...f, expected_return_date: e.target.value })} /></Field>
        {editing && <Field label="Returned on" hint={borrow.returned_date ? 'Clear it to mark the item as still out.' : 'Leave empty while the item is still out.'}>
          <Input type="date" min={f.borrowed_date} max={today} value={f.returned_date} onChange={(e) => setF({ ...f, returned_date: e.target.value })} />
        </Field>}
        <Field label="Notes" className="sm:col-span-2"><textarea className={`${inputCls} h-16`} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
        {dateError && <p className="text-sm text-red-600 sm:col-span-2">{dateError}</p>}
      </div>
    </Modal>
  )
}

const RETURN_CONDITIONS = ['Good', 'Fair', 'Damaged', 'Missing parts']

/** Mark a borrowed item returned on a chosen date (not before it was borrowed, not in the future). */
export function ReturnDialog({ borrow, onClose }: { borrow: Pick<Borrow, 'id' | 'item_name' | 'borrower_name' | 'borrowed_date'>; onClose: () => void }) {
  const today = todayISO()
  const [date, setDate] = useState(today < borrow.borrowed_date ? borrow.borrowed_date : today)
  const [condition, setCondition] = useState('')
  const [notes, setNotes] = useState('')
  const m = useAssetMutation((a, _: void) => a.borrows.return(borrow.id, date, { condition: condition || null, notes: notes.trim() || null }))
  const error = !date ? 'Pick the return date' : date < borrow.borrowed_date ? `Cannot be before the borrow date (${formatDate(borrow.borrowed_date)})` : date > today ? 'Cannot be in the future' : ''
  return (
    <Modal title="Return item" subtitle={`${borrow.item_name} · ${borrow.borrower_name}`} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!!error || m.isPending} onClick={() => m.mutate(undefined, done('Marked returned', onClose))}>Mark returned</Button>
    </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Returned on" required hint={`Borrowed ${formatDate(borrow.borrowed_date)}`}>
          <Input type="date" min={borrow.borrowed_date} max={today} value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field label="Condition"><Select value={condition} onChange={(e) => setCondition(e.target.value)}><option value="">Not recorded</option>{RETURN_CONDITIONS.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Notes" className="sm:col-span-2"><textarea className={`${inputCls} h-16`} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional, e.g. charger missing" /></Field>
        {error && <p className="text-sm text-red-600 sm:col-span-2">{error}</p>}
      </div>
      <p className="mt-3 text-xs text-gray-500">The condition and notes are added to the entry&apos;s notes. A returned asset becomes available again.</p>
    </Modal>
  )
}
