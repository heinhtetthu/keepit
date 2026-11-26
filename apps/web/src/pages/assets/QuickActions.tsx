import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Check } from 'lucide-react'
import { errorMessage, todayISO, useAssetMutation, useAssets, useEmployeeOverview, type OffboardRequest } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { EmployeePicker, Field, Tabs, useCan } from '@/components/assets/shared'

type Tab = 'assign' | 'reassign' | 'offboard'

/** Quick Assign (new hire), Reassignment (move between people), Offboarding (exit checklist). */
export default function QuickActions() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'assign'
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div><h1 className="text-2xl font-semibold tracking-tight text-gray-900">Quick actions</h1><p className="text-sm text-gray-500">Common people workflows in one place.</p></div>
      <Tabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={[{ key: 'assign', label: 'Quick assign' }, { key: 'reassign', label: 'Reassign' }, { key: 'offboard', label: 'Offboarding' }]} />
      {tab === 'assign' && <QuickAssign preselected={(sp.get('assets') ?? '').split(',').filter(Boolean).map(Number)} />}
      {tab === 'reassign' && <Reassign />}
      {tab === 'offboard' && <Offboard />}
    </div>
  )
}

function QuickAssign({ preselected }: { preselected: number[] }) {
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>(preselected)
  const [q, setQ] = useState('')
  const { data } = useAssets({ assignment_status: 'Unassigned', condition_status: 'Operational', q: q || undefined, page_size: 100 })
  const m = useAssetMutation((a, _: void) => a.assets.bulkAssign({ items: picked.map((id) => ({ asset_id: id, employee_id: employeeId })), effective_date: todayISO() }))
  return (
    <Card><CardContent className="space-y-4 p-4">
      <Field label="Employee"><EmployeePicker value={employeeId} onChange={setEmployeeId} /></Field>
      <Field label="Available assets"><Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} /></Field>
      <ul className="max-h-80 divide-y overflow-auto rounded border">
        {(data?.items ?? []).map((a) => (
          <li key={a.id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
            <input type="checkbox" checked={picked.includes(a.id)} onChange={() => setPicked((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id])} />
            <span className="flex-1">{a.display_name}</span><span className="text-xs text-gray-500">{a.asset_type}</span>
          </label></li>
        ))}
        {!data?.items.length && <li className="p-4 text-center text-sm text-gray-400">No unassigned operational assets.</li>}
      </ul>
      <div className="flex justify-end"><Button disabled={!employeeId || !picked.length || m.isPending} onClick={() => m.mutate(undefined, {
        onSuccess: (r) => { toast.success(`Assigned ${r.updated} asset(s)`); setPicked([]) }, onError: (e) => toast.error(errorMessage(e)),
      })}>Assign {picked.length || ''} asset(s)</Button></div>
    </CardContent></Card>
  )
}

function Reassign() {
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const { data } = useEmployeeOverview(from ?? 0)
  const m = useAssetMutation((a, _: void) => a.assets.bulkAssign({ items: picked.map((id) => ({ asset_id: id, employee_id: to })), effective_date: todayISO(), remark: 'Reassigned' }))
  const assets = data?.assets ?? []
  return (
    <Card><CardContent className="space-y-4 p-4">
      <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr]">
        <Field label="From"><EmployeePicker includeInactive value={from} onChange={(v) => { setFrom(v); setPicked([]) }} /></Field>
        <ArrowRight className="mx-auto mb-3 hidden h-4 w-4 text-gray-400 sm:block" />
        <Field label="To (empty = unassign)"><EmployeePicker value={to} onChange={setTo} /></Field>
      </div>
      {from && (assets.length ? (
        <ul className="divide-y rounded border">{assets.map((a) => (
          <li key={a.id}><label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-gray-50">
            <input type="checkbox" checked={picked.includes(a.id)} onChange={() => setPicked((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id])} />
            <span className="flex-1">{a.display_name}</span>
          </label></li>
        ))}</ul>
      ) : <p className="text-sm text-gray-500">This employee holds no assets.</p>)}
      <div className="flex justify-end"><Button disabled={!picked.length || from === to || m.isPending} onClick={() => m.mutate(undefined, {
        onSuccess: (r) => { toast.success(`Moved ${r.updated} asset(s)`); setPicked([]) }, onError: (e) => toast.error(errorMessage(e)),
      })}>{to ? 'Transfer' : 'Unassign'} {picked.length || ''} asset(s)</Button></div>
    </CardContent></Card>
  )
}

function Offboard() {
  const can = useCan()
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const { data } = useEmployeeOverview(employeeId ?? 0)
  const [opts, setOpts] = useState<OffboardRequest>({ effective_date: todayISO(), reason: 'Resignation', return_assets: true, close_borrows: true, release_seats: true, deactivate: true })
  const m = useAssetMutation((a, _: void) => a.employees.offboard(employeeId!, opts))
  const openBorrows = useMemo(() => (data?.borrows ?? []).filter((b) => !b.returned_date), [data])
  const check = (key: keyof OffboardRequest, label: string, count: number | null, allowed: boolean) => (
    <label className={`flex items-center gap-3 rounded border px-3 py-2 text-sm ${allowed ? '' : 'opacity-50'}`}>
      <input type="checkbox" disabled={!allowed} checked={!!opts[key] && allowed} onChange={(e) => setOpts({ ...opts, [key]: e.target.checked })} />
      <span className="flex-1">{label}</span>{count !== null && <span className="text-xs text-gray-500">{count}</span>}
    </label>
  )
  return (
    <Card><CardContent className="space-y-4 p-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Employee" className="sm:col-span-2"><EmployeePicker value={employeeId} onChange={setEmployeeId} /></Field>
        <Field label="Last day"><Input type="date" value={opts.effective_date} onChange={(e) => setOpts({ ...opts, effective_date: e.target.value })} /></Field>
      </div>
      {data && <div className="space-y-2">
        {check('return_assets', 'Return all held assets', data.assets.length, can('asset.edit'))}
        {check('close_borrows', 'Close open borrows', openBorrows.length, can('asset.edit'))}
        {check('release_seats', 'Release license seats', data.seats.length, can('record.edit'))}
        {check('deactivate', 'Deactivate employee and set resignation date', null, can('employee.manage'))}
        {data.assets.length > 0 && <p className="text-xs text-gray-500">Assets: {data.assets.map((a) => a.display_name).join(', ')}</p>}
      </div>}
      <div className="flex justify-end"><Button variant="destructive" disabled={!employeeId || m.isPending} onClick={() => m.mutate(undefined, {
        onSuccess: (r) => { toast.success(`Offboarded: ${r.assets_returned} asset(s) returned, ${r.borrows_closed} borrow(s) closed, ${r.seats_released} seat(s) released`); setEmployeeId(null) },
        onError: (e) => toast.error(errorMessage(e)),
      })}><Check className="mr-1.5 h-4 w-4" />Complete offboarding</Button></div>
    </CardContent></Card>
  )
}
