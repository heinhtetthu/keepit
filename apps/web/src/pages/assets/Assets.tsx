import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, Download, Laptop, Pencil, Plus, Trash2, Upload, UserPlus } from 'lucide-react'
import {
  ASSIGNMENT_STATUSES, CONDITION_STATUSES, csvToObjects, errorMessage, formatDate, daysUntil,
  useAssetMutation, useAssets, useAssetTabCounts, useEmployees, useReference, type Asset, type AssetCreate,
} from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import Modal from '@/components/ui/modal'
import RowMenu from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import AssetFormDialog from '@/components/assets/AssetFormDialog'
import { AssignDialog } from '@/components/assets/ActionDialogs'
import { AssignmentBadge, ConditionBadge, Field, useCan, useConfirm } from '@/components/assets/shared'
import {
  DataTable, EmptyRows, MoreMenu, TableTabs, TableToolbar, TitleCell, csv, filterField, range, useTableState, yesNo,
  type Column, type SortDef, type TableSnapshot,
} from '@/components/data-table'
import { cn } from '@/lib/utils'
import type { FilterState } from '@/components/FilterBar'

/* Reference list page for the shared data-table kit: preset tabs, filter
   side panel, sort, columns, saved views and the ⋮ switches. */

type Tab = 'all' | 'assigned' | 'available' | 'borrowed' | 'in_repair' | 'warranty' | 'written_off'
type Counts = NonNullable<ReturnType<typeof useAssetTabCounts>['data']>
const TABS: { id: Tab; label: string; count: keyof Counts; tone?: string; params: Record<string, string> }[] = [
  { id: 'all', label: 'All', count: 'total', params: {} },
  { id: 'assigned', label: 'In use', count: 'assigned', params: { assignment_status: 'Assigned' } },
  { id: 'available', label: 'Available', count: 'available', params: { assignment_status: 'Unassigned', condition_status: 'Operational' } },
  { id: 'borrowed', label: 'Borrowed', count: 'borrowed', params: { assignment_status: 'Borrowed' } },
  { id: 'in_repair', label: 'In repair', count: 'in_repair', tone: 'text-amber-700', params: { condition_status: 'In Repair' } },
  { id: 'warranty', label: 'Warranty ending', count: 'warranty_expiring', tone: 'text-amber-700', params: { warranty: 'expiring' } },
  { id: 'written_off', label: 'Written-off', count: 'written_off', params: { condition_status: 'Written-Off' } },
]
const WARRANTY = [{ value: 'active', label: 'Active' }, { value: 'expiring', label: 'Ending in 90 days' }, { value: 'expired', label: 'Expired' }, { value: 'none', label: 'No warranty' }]

/** Panel filters → asset API parameters. */
function toParams(f: FilterState): Record<string, string | undefined> {
  const bought = range(f.purchase_date), warranty = range(f.warranty_end_date)
  return {
    asset_type: csv(f.asset_type), brand: csv(f.brand), supplier: csv(f.supplier), location: csv(f.location),
    assignment_status: csv(f.assignment_status), condition_status: csv(f.condition_status), business_unit: csv(f.business_unit),
    employee_ids: csv(f.holder), warranty: csv(f.warranty), model: typeof f.model === 'string' ? f.model || undefined : undefined,
    purchase_from: bought.from, purchase_to: bought.to, warranty_from: warranty.from, warranty_to: warranty.to,
    cost_min: f.purchase_cost?.gte, cost_max: f.purchase_cost?.lte, open_repair: yesNo(f.open_repair),
  }
}

const dash = <span className="text-gray-400">-</span>
const COLUMNS: Column<Asset>[] = [
  { id: 'asset', label: 'Asset', sort: 'brand', locked: true, render: (a) => <TitleCell title={[a.brand, a.model].filter(Boolean).join(' ') || a.asset_type} sub={a.serial_number ?? undefined} /> },
  { id: 'asset_type', label: 'Type', sort: 'asset_type', render: (a) => a.other_type_name || a.asset_type },
  { id: 'holder', label: 'Holder', sort: 'holder', render: (a) => a.employee
    ? <Link className="hover:text-primary hover:underline" to={`/employees/${a.employee.id}`} onClick={(e) => e.stopPropagation()}>{a.employee.name}</Link> : dash },
  { id: 'status', label: 'Status', sort: 'assignment_status', render: (a) => (
    <div className="flex gap-1"><AssignmentBadge status={a.assignment_status} />{a.condition_status !== 'Operational' && <ConditionBadge status={a.condition_status} />}</div>) },
  { id: 'location', label: 'Location', sort: 'location', render: (a) => a.location || dash },
  { id: 'warranty', label: 'Warranty', sort: 'warranty_end_date', render: (a) => {
    if (!a.warranty_end_date) return dash
    const left = daysUntil(a.warranty_end_date)
    return <span className={cn('tabular-nums', left !== null && left < 0 ? 'text-gray-400 line-through decoration-gray-300' : left !== null && left <= 90 ? 'font-medium text-amber-700' : 'text-gray-700')}>{formatDate(a.warranty_end_date)}</span>
  } },
  { id: 'brand', label: 'Brand', sort: 'brand', render: (a) => a.brand || dash },
  { id: 'model', label: 'Model', sort: 'model', render: (a) => a.model || dash },
  { id: 'serial', label: 'Serial / product no.', sort: 'serial_number', render: (a) => <span className="font-mono text-xs">{a.serial_number || '-'}</span> },
  { id: 'condition', label: 'Condition', sort: 'condition_status', render: (a) => <ConditionBadge status={a.condition_status} /> },
  { id: 'business_unit', label: 'Business unit', render: (a) => (a.employee?.business_units ?? []).join(', ') || dash },
  { id: 'supplier', label: 'Supplier', sort: 'supplier', render: (a) => a.supplier || dash },
  { id: 'purchase_date', label: 'Purchased', sort: 'purchase_date', render: (a) => <span className="tabular-nums">{formatDate(a.purchase_date)}</span> },
  { id: 'purchase_cost', label: 'Cost', sort: 'purchase_cost', align: 'right', render: (a) => a.purchase_cost != null
    ? <>{Number(a.purchase_cost).toLocaleString(undefined, { maximumFractionDigits: 2 })}{a.currency && <span className="text-gray-400"> {a.currency}</span>}</> : dash },
  { id: 'created_at', label: 'Added', sort: 'created_at', render: (a) => <span className="tabular-nums">{formatDate(a.created_at)}</span> },
]
const SORTS: SortDef[] = [
  { id: 'created_at', label: 'Recently added', kind: 'date' }, { id: 'brand', label: 'Asset (brand)' }, { id: 'asset_type', label: 'Type' },
  { id: 'holder', label: 'Holder' }, { id: 'assignment_status', label: 'Assignment' }, { id: 'condition_status', label: 'Condition' },
  { id: 'location', label: 'Location' }, { id: 'supplier', label: 'Supplier' }, { id: 'warranty_end_date', label: 'Warranty end', kind: 'date' },
  { id: 'purchase_date', label: 'Purchase date', kind: 'date' }, { id: 'purchase_cost', label: 'Cost', kind: 'number' }, { id: 'updated_at', label: 'Last updated', kind: 'date' },
]

export default function Assets() {
  const can = useCan()
  const navigate = useNavigate()
  const [sp] = useSearchParams()

  // Links from the dashboard (?type=, ?condition=, ?assignment=, ?sort=) open a matching view.
  const initial = useMemo((): TableSnapshot | undefined => {
    const type = sp.get('type') || sp.get('asset_type'), assignment = sp.get('assignment'), condition = sp.get('condition'), sort = sp.get('sort')
    if (!type && !assignment && !condition && !sort) return undefined
    const filters: FilterState = {}
    if (type) filters.asset_type = { in: type.split(',') }
    if (assignment) filters.assignment_status = { in: [assignment] }
    if (condition && condition !== 'In Repair') filters.condition_status = { in: [condition] }
    return { tab: condition === 'In Repair' ? 'in_repair' : 'all', filters, sort: sort ?? 'created_at', order: (sp.get('order') as 'asc' | 'desc') ?? 'desc' }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const t = useTableState({ key: 'assets', defaultSort: 'created_at', defaultOrder: 'desc', defaultColumns: ['asset_type', 'holder', 'status', 'location', 'warranty'], initial })
  const trash = !!t.extras.trash || sp.get('view') === 'trash'

  const [selected, setSelected] = useState<number[]>([])
  const [dialog, setDialog] = useState<null | 'add' | 'import' | 'bulk'>(null)
  const [assignId, setAssignId] = useState<number | null>(null)
  const { confirm, dialog: confirmDialog } = useConfirm()

  const { data: ref } = useReference()
  const { data: employees = [] } = useEmployees(true)
  const { data: counts } = useAssetTabCounts()
  const fields = useMemo(() => {
    const names = (k: 'asset_type' | 'brand' | 'vendor' | 'location') => (ref?.[k] ?? []).map((r) => r.name)
    return [
      filterField('asset_type', 'Type', 'select', names('asset_type')),
      filterField('brand', 'Brand', 'select', names('brand')),
      filterField('model', 'Model', 'text'),
      filterField('assignment_status', 'Assignment', 'select', [...ASSIGNMENT_STATUSES]),
      filterField('condition_status', 'Condition', 'select', [...CONDITION_STATUSES]),
      filterField('holder', 'Holder', 'select', employees.map((e) => ({ value: String(e.id), label: e.active ? e.name : `${e.name} (inactive)` }))),
      filterField('business_unit', 'Business unit', 'business_unit'),
      filterField('location', 'Location', 'select', names('location')),
      filterField('supplier', 'Supplier', 'select', names('vendor')),
      filterField('warranty', 'Warranty', 'select', WARRANTY),
      filterField('warranty_end_date', 'Warranty ends', 'date'),
      filterField('purchase_date', 'Purchased', 'date'),
      filterField('purchase_cost', 'Purchase cost', 'currency'),
      filterField('open_repair', 'Has an open repair', 'boolean'),
    ]
  }, [ref, employees])

  const tab = TABS.find((x) => x.id === t.tab) ?? TABS[0]
  const panel = toParams(t.filters)
  const withWrittenOff = !!t.extras.writtenOff || tab.id === 'written_off' || (panel.condition_status ?? '').includes('Written-Off')
  const { data, isLoading, isFetching, error } = useAssets({
    ...panel, ...tab.params, q: t.search || undefined, deleted: trash || undefined, hide_written_off: !trash && !withWrittenOff ? true : undefined,
    page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order,
  })
  const items = data?.items ?? []
  const assignAsset = items.find((i) => i.id === assignId)
  const remove = useAssetMutation((a, id: number) => a.assets.remove(id))
  const restore = useAssetMutation((a, id: number) => a.assets.restore(id))
  const retire = useAssetMutation((a, ids: number[]) => a.assets.bulkRetire(ids))
  const filtered = !!t.search || Object.keys(t.filters).length > 0 || tab.id !== 'all'

  const rowMenu = (a: Asset): ReactNode => (
    <RowMenu items={trash ? [
      { label: 'Restore', onSelect: () => restore.mutate(a.id, { onSuccess: () => toast.success('Asset restored'), onError: (e) => toast.error(errorMessage(e)) }), hidden: !can('asset.delete') },
    ] : [
      { label: 'Open', onSelect: () => navigate(`/assets/${a.id}`) },
      { label: a.employee ? 'Reassign / unassign' : 'Assign', icon: <UserPlus />, onSelect: () => setAssignId(a.id), hidden: !can('asset.edit') || a.assignment_status === 'Borrowed' || a.condition_status === 'Written-Off' },
      { label: 'Move to trash', icon: <Trash2 />, danger: true, divider: true, hidden: !can('asset.delete'), onSelect: () => confirm('Delete asset', `Move ${a.display_name} to trash? You can restore it later.`, () => remove.mutateAsync(a.id).then(() => toast.success('Moved to trash')), 'Delete') },
    ]} />
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><Laptop className="h-5 w-5 text-gray-600" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{trash ? 'Assets in trash' : 'Assets'}</h1>
            <p className="truncate text-sm text-gray-500">{trash ? 'Restore anything deleted by mistake.' : 'Every device, who holds it, and its repair and borrow history.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trash && <Button variant="outline" size="sm" onClick={() => t.setExtra('trash', false)}>Back to assets</Button>}
          {can('asset.create') && !trash && <Button variant="outline" size="sm" onClick={() => setDialog('import')}><Upload className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Import</span></Button>}
          {can('asset.create') && !trash && <Button size="sm" onClick={() => setDialog('add')}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add asset</span></Button>}
        </div>
      </div>

      {!trash && <TableTabs tabs={TABS.map((x) => ({ id: x.id, label: x.label, count: counts?.[x.count], tone: x.tone }))} value={t.tab}
        onChange={(id) => { t.setTab(id); setSelected([]); if (id === 'warranty') t.setSort('warranty_end_date', 'asc') }} />}

      <TableToolbar state={t} searchPlaceholder="Brand, model, serial, holder…" filterFields={fields} sorts={SORTS} columns={COLUMNS}
        more={<MoreMenu toggles={[
          { id: 'writtenOff', label: 'Show written-off', value: !!t.extras.writtenOff, onChange: (v) => t.setExtra('writtenOff', v) },
          { id: 'trash', label: 'Show trash', value: trash, onChange: (v) => t.setExtra('trash', v) },
        ]} />} />

      <DataTable rows={items} rowKey={(a) => a.id} columns={COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null}
        onRowClick={(a) => navigate(`/assets/${a.id}`)} rowClassName={(a) => a.condition_status === 'Written-Off' && 'opacity-60'}
        selected={trash ? undefined : selected} onSelectedChange={trash || !can('asset.edit') ? undefined : (ids) => setSelected(ids as number[])}
        actions={rowMenu}
        empty={<EmptyRows icon={<Laptop className="h-9 w-9" />} title={trash ? 'Trash is empty' : 'No assets match'}
          hint={!trash && !filtered && can('asset.create') ? 'Add your first asset or import a CSV.' : !trash ? 'Try another tab or clear the filters.' : undefined} />}
        pager={{ page: t.page, pages: data?.total_pages ?? 1, total: data?.total ?? 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'assets' }} />

      {selected.length > 0 && can('asset.edit') && !trash && (
        <div className="fixed bottom-20 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-sheet-up flex-wrap items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 shadow-xl backdrop-blur lg:bottom-4">
          <span className="mr-1 text-sm font-semibold">{selected.length} selected</span>
          <Button size="sm" onClick={() => navigate(`/quick-actions?tab=assign&assets=${selected.join(',')}`)}><UserPlus className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Assign…</span></Button>
          <Button size="sm" variant="outline" onClick={() => setDialog('bulk')}><Pencil className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Bulk edit</span></Button>
          <Button size="sm" variant="outline" onClick={() => confirm('Write off assets', `Mark ${selected.length} asset(s) Written-Off and unassign them?`,
            () => retire.mutateAsync(selected).then(() => { toast.success('Assets written off'); setSelected([]) }), 'Write off')}><Archive className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Write off</span></Button>
          <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

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
