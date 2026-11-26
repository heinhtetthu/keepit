import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Pencil, QrCode } from 'lucide-react'
import { errorMessage, formatDate, formatMoney, specLabel, daysUntil, useAsset, useAssetMutation, type Maintenance, type Repair } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import RowMenu from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import { pushRecent } from '@/store/recent'
import AssetFormDialog from '@/components/assets/AssetFormDialog'
import QrDialog from '@/components/assets/QrDialog'
import { AssignDialog, BorrowDialog, MaintenanceDialog, RepairDialog } from '@/components/assets/ActionDialogs'
import { AssignmentBadge, ConditionBadge, EmptyState, Tabs, useCan, useConfirm } from '@/components/assets/shared'
import { LinkedDocuments } from '@/components/documents/DocumentDialogs'

type Tab = 'history' | 'repairs' | 'maintenance' | 'borrows' | 'documents'

export default function AssetDetail() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const can = useCan()
  const { data: a, isLoading, error } = useAsset(id)
  const [tab, setTab] = useState<Tab>('history')
  const [dialog, setDialog] = useState<null | 'edit' | 'assign' | 'repair' | 'maintenance' | 'borrow' | 'qr'>(null)
  const [repair, setRepair] = useState<Repair | null>(null)
  const [maint, setMaint] = useState<Maintenance | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const retire = useAssetMutation((api, _: void) => api.assets.retire(id))
  const remove = useAssetMutation((api, _: void) => api.assets.remove(id))
  const restore = useAssetMutation((api, _: void) => api.assets.restore(id))
  const delRepair = useAssetMutation((api, rid: number) => api.assets.deleteRepair(id, rid))
  const delMaint = useAssetMutation((api, mid: number) => api.assets.deleteMaintenance(id, mid))
  const returnBorrow = useAssetMutation((api, bid: number) => api.borrows.return(bid))
  const delAssignment = useAssetMutation((api, aid: number) => api.assets.deleteAssignment(id, aid))

  useEffect(() => {
    if (a) pushRecent({ url: `/assets/${a.id}`, label: a.display_name, sublabel: a.asset_type, kind: 'page', icon: null })
  }, [a])

  if (isLoading) return <p className="p-8 text-center text-sm text-gray-400">Loading…</p>
  if (error || !a) return <EmptyState title="Asset not found"><Link className="text-primary hover:underline" to="/assets">Back to assets</Link></EmptyState>

  const deleted = !!a.deleted_at
  const writtenOff = a.condition_status === 'Written-Off'
  const warrantyLeft = daysUntil(a.warranty_end_date)
  const specs = Object.entries(a.specs ?? {}).filter(([, v]) => v)
  const openBorrow = a.borrows.find((b) => !b.returned_date)

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft className="h-4 w-4" />Back</button>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{[a.brand, a.model].filter(Boolean).join(' ') || a.asset_type}</h1>
          <p className="text-sm text-gray-500">{a.other_type_name || a.asset_type}{a.serial_number && ` · ${a.serial_number}`}</p>
          <div className="mt-2 flex flex-wrap gap-1.5"><AssignmentBadge status={a.assignment_status} /><ConditionBadge status={a.condition_status} />{deleted && <span className="text-xs text-red-600">In trash</span>}</div>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setDialog('qr')}><QrCode className="mr-1.5 h-4 w-4" />QR</Button>
          {deleted ? can('asset.delete') && <Button size="sm" onClick={() => restore.mutate(undefined, { onSuccess: () => toast.success('Restored'), onError: (e) => toast.error(errorMessage(e)) })}>Restore</Button> : <>
            {can('asset.edit') && <Button variant="outline" size="sm" onClick={() => setDialog('edit')}><Pencil className="mr-1.5 h-4 w-4" />Edit</Button>}
            {can('asset.edit') && !writtenOff && a.assignment_status !== 'Borrowed' && <Button size="sm" onClick={() => setDialog('assign')}>{a.employee ? 'Reassign' : 'Assign'}</Button>}
            <RowMenu items={[
              { label: 'Log repair', onSelect: () => { setRepair(null); setDialog('repair') }, hidden: !can('itlog.manage') },
              { label: 'Log maintenance', onSelect: () => { setMaint(null); setDialog('maintenance') }, hidden: !can('itlog.manage') },
              { label: 'Lend (borrow)', onSelect: () => setDialog('borrow'), hidden: !can('itlog.manage') || a.assignment_status !== 'Unassigned' || writtenOff },
              { label: 'Return borrowed item', onSelect: () => openBorrow && returnBorrow.mutate(openBorrow.id, { onSuccess: () => toast.success('Returned') }), hidden: !can('itlog.manage') || !openBorrow },
              { label: 'Retire (write off)', divider: true, hidden: !can('asset.edit') || writtenOff, onSelect: () => confirm('Retire asset', 'Mark this asset Written-Off and unassign it?', () => retire.mutateAsync(undefined), 'Retire') },
              { label: 'Move to trash', danger: true, hidden: !can('asset.delete'), onSelect: () => confirm('Delete asset', 'Move this asset to trash? You can restore it later.', () => remove.mutateAsync(undefined).then(() => navigate('/assets')), 'Delete') },
            ]} />
          </>}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="md:col-span-2"><CardContent className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm sm:grid-cols-3">
          <Info label="Holder">{a.employee ? <Link className="text-primary hover:underline" to={`/employees/${a.employee.id}`}>{a.employee.name}</Link> : '—'}</Info>
          <Info label="Location">{a.location || '—'}</Info>
          <Info label="Supplier">{a.supplier || '—'}</Info>
          <Info label="Purchased">{formatDate(a.purchase_date)}</Info>
          <Info label="Cost">{formatMoney(a.purchase_cost, a.currency)}</Info>
          <Info label="Warranty"><span className={warrantyLeft !== null && warrantyLeft >= 0 && warrantyLeft <= 30 ? 'font-medium text-amber-700' : ''}>{formatDate(a.warranty_end_date)}{warrantyLeft !== null && warrantyLeft >= 0 && ` (${warrantyLeft}d)`}{warrantyLeft !== null && warrantyLeft < 0 && ' (expired)'}</span></Info>
          {a.notes && <div className="col-span-full"><Info label="Notes"><span className="whitespace-pre-wrap">{a.notes}</span></Info></div>}
        </CardContent></Card>
        <Card><CardContent className="p-4 text-sm">
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-400">Specifications</p>
          {specs.length ? <dl className="space-y-1.5">{specs.map(([k, v]) => <div key={k} className="flex justify-between gap-3"><dt className="text-gray-500">{specLabel(k)}</dt><dd className="text-right text-gray-900">{v}</dd></div>)}</dl> : <p className="text-gray-400">None recorded</p>}
        </CardContent></Card>
      </div>

      <Tabs value={tab} onChange={setTab} tabs={[
        { key: 'history', label: 'Assignments', count: a.assignments.length }, { key: 'repairs', label: 'Repairs', count: a.repairs.length },
        { key: 'maintenance', label: 'Maintenance', count: a.maintenance.length }, { key: 'borrows', label: 'Borrows', count: a.borrows.length },
        ...(can('document.view') ? [{ key: 'documents' as const, label: 'Documents' }] : []),
      ]} />

      {tab === 'history' && (a.assignments.length === 0 ? <EmptyState title="Never assigned" /> : (
        <List rows={a.assignments.map((h) => ({
          key: h.id, main: h.employee_id ? <Link className="hover:underline" to={`/employees/${h.employee_id}`}>{h.employee_name}</Link> : h.employee_name,
          sub: `${formatDate(h.assigned_from)} → ${h.assigned_to ? formatDate(h.assigned_to) : 'now'}${h.remark ? ` · ${h.remark}` : ''}`,
          menu: h.assigned_to && can('asset.edit') ? [{ label: 'Delete history entry', danger: true, onSelect: () => confirm('Delete history entry', 'Remove this past assignment from the history?', () => delAssignment.mutateAsync(h.id), 'Delete') }] : undefined,
        }))} />
      ))}
      {tab === 'repairs' && (a.repairs.length === 0 ? <EmptyState title="No repairs" /> : (
        <List rows={a.repairs.map((r) => ({
          key: r.id, main: r.issue, sub: `${formatDate(r.repair_date)} · ${r.status}${r.vendor ? ` · ${r.vendor}` : ''}${r.cost ? ` · ${formatMoney(r.cost, r.currency)}` : ''}`,
          menu: can('itlog.manage') ? [{ label: 'Edit', onSelect: () => { setRepair(r); setDialog('repair') } }, { label: 'Delete', danger: true, onSelect: () => confirm('Delete repair', 'Delete this repair entry?', () => delRepair.mutateAsync(r.id), 'Delete') }] : undefined,
        }))} />
      ))}
      {tab === 'maintenance' && (a.maintenance.length === 0 ? <EmptyState title="No maintenance logged" /> : (
        <List rows={a.maintenance.map((m) => ({
          key: m.id, main: `${formatDate(m.maintenance_date)} · body ${m.body_condition}`,
          sub: [m.operating_system, (m.components ?? []).filter((c) => !['Good', 'Done', 'Not Applicable'].includes(c.status)).map((c) => `${c.component}: ${c.status}`).join(', '), m.notes].filter(Boolean).join(' · ') || 'All checks passed',
          menu: can('itlog.manage') ? [{ label: 'Edit', onSelect: () => { setMaint(m); setDialog('maintenance') } }, { label: 'Delete', danger: true, onSelect: () => confirm('Delete maintenance', 'Delete this maintenance entry?', () => delMaint.mutateAsync(m.id), 'Delete') }] : undefined,
        }))} />
      ))}
      {tab === 'borrows' && (a.borrows.length === 0 ? <EmptyState title="Never borrowed" /> : (
        <List rows={a.borrows.map((b) => ({
          key: b.id, main: b.borrower_name, sub: `${formatDate(b.borrowed_date)} → ${b.returned_date ? formatDate(b.returned_date) : `due ${formatDate(b.expected_return_date)}`}`,
          badge: b.overdue ? <span className="text-xs font-medium text-red-600">Overdue</span> : !b.returned_date ? <span className="text-xs text-violet-700">Out</span> : undefined,
        }))} />
      ))}
      {tab === 'documents' && <LinkedDocuments link={{ entity_type: 'asset', entity_id: a.id }} />}

      {dialog === 'edit' && <AssetFormDialog asset={a} onClose={() => setDialog(null)} />}
      {dialog === 'assign' && <AssignDialog asset={a} onClose={() => setDialog(null)} />}
      {dialog === 'repair' && <RepairDialog asset={a} repair={repair ?? undefined} onClose={() => setDialog(null)} />}
      {dialog === 'maintenance' && <MaintenanceDialog asset={a} entry={maint ?? undefined} onClose={() => setDialog(null)} />}
      {dialog === 'borrow' && <BorrowDialog asset={a} onClose={() => setDialog(null)} />}
      {dialog === 'qr' && <QrDialog id={a.id} label={a.display_name} onClose={() => setDialog(null)} />}
      {confirmDialog}
    </div>
  )
}

function Info({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><p className="text-xs text-gray-500">{label}</p><div className="text-gray-900">{children}</div></div>
}

function List({ rows }: { rows: { key: number; main: React.ReactNode; sub: string; badge?: React.ReactNode; menu?: { label: string; onSelect: () => void; danger?: boolean }[] }[] }) {
  return (
    <ul className="divide-y rounded-lg border bg-white">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 px-4 py-2.5">
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-gray-900">{r.main}</p><p className="truncate text-xs text-gray-500">{r.sub}</p></div>
          {r.badge}
          {r.menu && <RowMenu items={r.menu} />}
        </li>
      ))}
    </ul>
  )
}
