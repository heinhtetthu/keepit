import { useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Download, Laptop, Plus, Search, Upload } from 'lucide-react'
import {
  ASSIGNMENT_STATUSES, CONDITION_STATUSES, csvToObjects, errorMessage, formatDate, daysUntil,
  useAssetMutation, useAssets, useReference, type AssetCreate,
} from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Modal from '@/components/ui/modal'
import RowMenu from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import { MiniPager, RowsPerPageSelect, TableCard, TableFooterInfo, TableScrollArea, TH_STICKY, usePageSize } from '@/components/table_shell'
import AssetFormDialog from '@/components/assets/AssetFormDialog'
import { AssignDialog } from '@/components/assets/ActionDialogs'
import { AssignmentBadge, ConditionBadge, EmptyState, Field, useCan, useConfirm } from '@/components/assets/shared'

export default function Assets() {
  const can = useCan()
  const navigate = useNavigate()
  const [sp, setSp] = useSearchParams()
  const [pageSize, setPageSize] = usePageSize('assets-page-size', 25)
  const [q, setQ] = useState(sp.get('q') ?? '')
  const filters = {
    q: sp.get('q') || undefined, asset_type: sp.get('type') || undefined,
    assignment_status: sp.get('assignment') || undefined, condition_status: sp.get('condition') || undefined,
    location: sp.get('location') || undefined, deleted: sp.get('view') === 'trash' || undefined,
    page: Number(sp.get('page') || 1), page_size: pageSize, sort: sp.get('sort') || 'created_at', order: sp.get('order') || 'desc',
  }
  const { data, isLoading, isFetching } = useAssets(filters)
  const { data: ref } = useReference()
  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<null | 'add' | 'import' | 'bulk'>(null)
  const [assignId, setAssignId] = useState<number | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()
  const setParam = (k: string, v?: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); if (k !== 'page') n.delete('page'); setSp(n, { replace: true }); setSelected([]) }
  const remove = useAssetMutation((a, id: number) => a.assets.remove(id))
  const restore = useAssetMutation((a, id: number) => a.assets.restore(id))
  const retire = useAssetMutation((a, ids: number[]) => a.assets.bulkRetire(ids))
  const items = data?.items ?? []
  const trash = filters.deleted
  const allChecked = items.length > 0 && items.every((i) => selected.includes(i.id))
  const assignAsset = items.find((i) => i.id === assignId)

  const sortBy = (col: string) => {
    const n = new URLSearchParams(sp)
    n.set('sort', col); n.set('order', filters.sort === col && filters.order === 'asc' ? 'desc' : 'asc'); setSp(n, { replace: true })
  }
  const Th = ({ col, children }: { col?: string; children?: React.ReactNode }) => (
    <th className={`${TH_STICKY} px-3 py-2 text-left text-xs font-medium text-gray-500`}>
      {col ? <button className="hover:text-gray-900" onClick={() => sortBy(col)}>{children}{filters.sort === col ? (filters.order === 'asc' ? ' ↑' : ' ↓') : ''}</button> : children}
    </th>
  )

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Assets</h1>
          <p className="text-sm text-gray-500">Every device, who holds it, and its repair and borrow history.</p>
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setParam('view', trash ? undefined : 'trash')}>{trash ? 'Back to assets' : 'Trash'}</Button>
          {can('asset.create') && !trash && <Button variant="outline" size="sm" onClick={() => setDialog('import')}><Upload className="mr-1.5 h-4 w-4" />Import CSV</Button>}
          {can('asset.create') && !trash && <Button size="sm" onClick={() => setDialog('add')}><Plus className="mr-1.5 h-4 w-4" />Add asset</Button>}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); setParam('q', q.trim() || undefined) }}>
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" placeholder="Brand, model, serial, holder…" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => setParam('q', q.trim() || undefined)} />
        </form>
        <Select className="w-auto" value={filters.asset_type ?? ''} onChange={(e) => setParam('type', e.target.value)} aria-label="Asset type">
          <option value="">All types</option>{(ref?.asset_type ?? []).map((t) => <option key={t.id}>{t.name}</option>)}
        </Select>
        <Select className="w-auto" value={filters.assignment_status ?? ''} onChange={(e) => setParam('assignment', e.target.value)} aria-label="Assignment">
          <option value="">Any assignment</option>{ASSIGNMENT_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        <Select className="w-auto" value={filters.condition_status ?? ''} onChange={(e) => setParam('condition', e.target.value)} aria-label="Condition">
          <option value="">Any condition</option>{CONDITION_STATUSES.map((s) => <option key={s}>{s}</option>)}
        </Select>
        {(ref?.location?.length ?? 0) > 0 && (
          <Select className="w-auto" value={filters.location ?? ''} onChange={(e) => setParam('location', e.target.value)} aria-label="Location">
            <option value="">Any location</option>{ref!.location.map((l) => <option key={l.id}>{l.name}</option>)}
          </Select>
        )}
      </div>

      {selected.length > 0 && can('asset.edit') && !trash && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-primary/5 px-3 py-2 text-sm">
          <span className="font-medium">{selected.length} selected</span>
          <Button size="sm" variant="outline" onClick={() => setDialog('bulk')}>Bulk edit</Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/quick-actions?tab=assign&assets=${selected.join(',')}`)}>Assign…</Button>
          <Button size="sm" variant="outline" onClick={() => confirm('Retire assets', `Mark ${selected.length} asset(s) Written-Off and unassign them?`,
            () => retire.mutateAsync(selected).then(() => { toast.success('Assets retired'); setSelected([]) }), 'Retire')}>Retire</Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      <TableCard footer={<div className="flex flex-wrap items-center gap-3">
        <TableFooterInfo shown={items.length} total={data?.total ?? 0} noun="assets" />
        <div className="ml-auto flex items-center gap-3">
          <RowsPerPageSelect value={pageSize} onChange={(n) => { setPageSize(n); setParam('page') }} />
          <MiniPager page={filters.page} pages={data?.total_pages ?? 1} onPage={(p) => setParam('page', String(p))} />
        </div>
      </div>}>
        <TableScrollArea>
          {isLoading ? <p className="p-8 text-center text-sm text-gray-400">Loading assets…</p> : items.length === 0 ? (
            <EmptyState icon={<Laptop className="h-10 w-10" />} title={trash ? 'Trash is empty' : 'No assets match'}>
              {!trash && can('asset.create') && 'Add your first asset or import a CSV.'}
            </EmptyState>
          ) : (
            <table className={`w-full text-sm ${isFetching ? 'opacity-70' : ''}`}>
              <thead><tr>
                {!trash && <th className={`${TH_STICKY} w-8 px-3`}><input type="checkbox" aria-label="Select all" checked={allChecked} onChange={() => setSelected(allChecked ? [] : items.map((i) => i.id))} /></th>}
                <Th col="brand">Asset</Th><Th col="asset_type">Type</Th><Th>Holder</Th><Th>Status</Th><Th>Location</Th><Th col="warranty_end_date">Warranty</Th><Th />
              </tr></thead>
              <tbody className="divide-y">
                {items.map((a) => {
                  const left = daysUntil(a.warranty_end_date)
                  return (
                    <tr key={a.id} className="hover:bg-gray-50">
                      {!trash && <td className="px-3"><input type="checkbox" aria-label={`Select ${a.display_name}`} checked={selected.includes(a.id)} onChange={() => setSelected((s) => s.includes(a.id) ? s.filter((x) => x !== a.id) : [...s, a.id])} /></td>}
                      <td className="px-3 py-2"><Link to={`/assets/${a.id}`} className="font-medium text-gray-900 hover:underline">{[a.brand, a.model].filter(Boolean).join(' ') || a.asset_type}</Link>
                        {a.serial_number && <div className="text-xs text-gray-500">{a.serial_number}</div>}</td>
                      <td className="px-3 py-2 text-gray-600">{a.other_type_name || a.asset_type}</td>
                      <td className="px-3 py-2">{a.employee ? <Link className="hover:underline" to={`/employees/${a.employee.id}`}>{a.employee.name}</Link> : <span className="text-gray-400">—</span>}</td>
                      <td className="px-3 py-2"><div className="flex flex-wrap gap-1"><AssignmentBadge status={a.assignment_status} />{a.condition_status !== 'Operational' && <ConditionBadge status={a.condition_status} />}</div></td>
                      <td className="px-3 py-2 text-gray-600">{a.location || '—'}</td>
                      <td className={`px-3 py-2 ${left !== null && left < 0 ? 'text-gray-400' : left !== null && left <= 30 ? 'text-amber-700 font-medium' : 'text-gray-600'}`}>{formatDate(a.warranty_end_date)}</td>
                      <td className="px-3 py-2 text-right">
                        <RowMenu items={trash ? [
                          { label: 'Restore', onSelect: () => restore.mutate(a.id, { onSuccess: () => toast.success('Asset restored'), onError: (e) => toast.error(errorMessage(e)) }), hidden: !can('asset.delete') },
                        ] : [
                          { label: 'Open', onSelect: () => navigate(`/assets/${a.id}`) },
                          { label: a.employee ? 'Reassign / unassign' : 'Assign', onSelect: () => setAssignId(a.id), hidden: !can('asset.edit') || a.assignment_status === 'Borrowed' || a.condition_status === 'Written-Off' },
                          { label: 'Move to trash', danger: true, divider: true, hidden: !can('asset.delete'), onSelect: () => confirm('Delete asset', `Move ${a.display_name} to trash? You can restore it later.`, () => remove.mutateAsync(a.id).then(() => toast.success('Moved to trash')), 'Delete') },
                        ]} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </TableScrollArea>
      </TableCard>

      {dialog === 'add' && <AssetFormDialog onClose={() => setDialog(null)} onSaved={(a) => navigate(`/assets/${a.id}`)} />}
      {dialog === 'import' && <ImportDialog onClose={() => setDialog(null)} />}
      {dialog === 'bulk' && <BulkEditDialog ids={selected} onClose={() => { setDialog(null); setSelected([]) }} />}
      {assignAsset && <AssignDialog asset={assignAsset} onClose={() => setAssignId(null)} />}
      {confirmDialog}
    </div>
  )
}

const TEMPLATE = 'asset_type,brand,model,serial_number,location,purchase_date,purchase_cost,currency,supplier,warranty_end_date,cpu,ram,storage\nLaptop,Dell,Latitude 5440,ABC123,Head Office,2025-01-10,1200,USD,Dell Store,2028-01-10,i7,16GB,512GB\n'
const CORE_COLS = ['asset_type', 'type', 'other_type_name', 'brand', 'model', 'serial_number', 'serial', 'location', 'purchase_date', 'purchase_cost', 'cost', 'currency', 'supplier', 'vendor', 'warranty_end_date', 'warranty', 'notes']

function ImportDialog({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<AssetCreate[]>([])
  const [error, setError] = useState('')
  const m = useAssetMutation((a, items: AssetCreate[]) => a.assets.import(items))
  const parse = async (file: File) => {
    setError('')
    const objs = csvToObjects(await file.text())
    const items = objs.map((o) => ({
      asset_type: o.asset_type || o.type, other_type_name: o.other_type_name || null, brand: o.brand || null, model: o.model || null,
      serial_number: o.serial_number || o.serial || null, location: o.location || null, purchase_date: o.purchase_date || null,
      purchase_cost: o.purchase_cost || o.cost || null, currency: o.currency || null, supplier: o.supplier || o.vendor || null,
      warranty_end_date: o.warranty_end_date || o.warranty || null, notes: o.notes || null,
      specs: Object.fromEntries(Object.entries(o).filter(([k, v]) => !CORE_COLS.includes(k) && v)),
    })).filter((r) => r.asset_type)
    if (!items.length) setError('No rows with an asset_type column were found.')
    setRows(items as AssetCreate[])
  }
  const sample = useMemo(() => URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' })), [])
  return (
    <Modal size="lg" title="Import assets from CSV" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!rows.length || m.isPending} onClick={() => m.mutate(rows, {
        onSuccess: (r) => { toast.success(`Imported ${r.created} asset(s)${r.skipped ? `, skipped ${r.skipped} duplicate serial(s)` : ''}`); onClose() },
        onError: (e) => toast.error(errorMessage(e)),
      })}>{m.isPending ? 'Importing…' : `Import ${rows.length || ''}`}</Button>
    </>}>
      <div className="space-y-3 text-sm">
        <p className="text-gray-600">One asset per row. Required column: <code>asset_type</code>. Other columns become specifications (cpu, ram…). Rows whose serial already exists are skipped.</p>
        <a href={sample} download="assets-template.csv" className="inline-flex items-center gap-1 text-primary hover:underline"><Download className="h-4 w-4" />Download template</a>
        <Field label="CSV file"><input type="file" accept=".csv,text/csv" onChange={(e) => e.target.files?.[0] && parse(e.target.files[0])} /></Field>
        {error && <p className="text-red-600">{error}</p>}
        {rows.length > 0 && (
          <div className="max-h-56 overflow-auto rounded border">
            <table className="w-full text-xs"><thead className="bg-gray-50"><tr>{['Type', 'Brand', 'Model', 'Serial', 'Specs'].map((h) => <th key={h} className="px-2 py-1 text-left">{h}</th>)}</tr></thead>
              <tbody>{rows.slice(0, 50).map((r, i) => <tr key={i} className="border-t"><td className="px-2 py-1">{r.asset_type}</td><td className="px-2 py-1">{r.brand}</td><td className="px-2 py-1">{r.model}</td><td className="px-2 py-1">{r.serial_number}</td><td className="px-2 py-1 text-gray-500">{Object.keys(r.specs ?? {}).join(', ')}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  )
}

function BulkEditDialog({ ids, onClose }: { ids: number[]; onClose: () => void }) {
  const { data: ref } = useReference()
  const [f, setF] = useState({ location: '', condition_status: '', supplier: '' })
  const m = useAssetMutation((a, _: void) => a.assets.bulkUpdate({ ids, ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) }))
  return (
    <Modal title={`Edit ${ids.length} asset(s)`} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!Object.values(f).some(Boolean) || m.isPending} onClick={() => m.mutate(undefined, { onSuccess: () => { toast.success('Assets updated'); onClose() }, onError: (e) => toast.error(errorMessage(e)) })}>Apply</Button>
    </>}>
      <div className="space-y-3">
        <p className="text-sm text-gray-500">Only the fields you fill in are changed.</p>
        <Field label="Location"><Select value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })}><option value="">Keep</option>{(ref?.location ?? []).map((l) => <option key={l.id}>{l.name}</option>)}</Select></Field>
        <Field label="Condition"><Select value={f.condition_status} onChange={(e) => setF({ ...f, condition_status: e.target.value })}><option value="">Keep</option>{CONDITION_STATUSES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Supplier"><Select value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })}><option value="">Keep</option>{(ref?.vendor ?? []).map((l) => <option key={l.id}>{l.name}</option>)}</Select></Field>
      </div>
    </Modal>
  )
}
