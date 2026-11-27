import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeftRight, ClipboardCheck, CornerDownLeft, ExternalLink, Pencil, Plus, RotateCcw, Trash2, Wrench } from 'lucide-react'
import {
  BODY_CONDITIONS, REPAIR_STATUSES, errorMessage, formatDate, formatMoney, useAssetMutation, useBorrows, useEmployees,
  useMaintenanceLog, useReference, useRepairLog, type Borrow, type LogEntry, type Maintenance, type Repair,
} from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import RowMenu from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import { BorrowDialog, MaintenanceDialog, RepairDialog, ReturnDialog } from '@/components/assets/ActionDialogs'
import { Tabs, useCan, useConfirm } from '@/components/assets/shared'
import {
  DataTable, EmptyRows, MoreMenu, TableTabs, TableToolbar, TitleCell, csv, filterField, range, yesNo, useTableState,
  type Column, type SortDef,
} from '@/components/data-table'
import type { FilterState } from '@/components/FilterBar'
import { cn } from '@/lib/utils'

/* IT Logs: borrows, repairs and maintenance across every asset, each on the
   shared data-table kit (preset tabs, filter panel, sort, columns, saved views). */

type Section = 'borrows' | 'repairs' | 'maintenance'
type RepairRow = LogEntry<Repair>
type MaintRow = LogEntry<Maintenance>

const dash = <span className="text-gray-400">-</span>
const day = (iso?: string | null) => (iso ? <span className="tabular-nums">{formatDate(iso)}</span> : dash)
const NO_ASSET = '__none__'
const OK = ['Good', 'Done', 'Not Applicable']
const issuesOf = (m: MaintRow) => (m.components ?? []).filter((c) => !OK.includes(c.status))
const assetLink = (id: number, label: ReactNode) => (
  <Link className="hover:text-primary hover:underline" to={`/assets/${id}`} onClick={(e) => e.stopPropagation()}>{label}</Link>
)

export default function ITLogs() {
  const [sp, setSp] = useSearchParams()
  const section = (['borrows', 'repairs', 'maintenance'].includes(sp.get('tab') ?? '') ? sp.get('tab') : 'borrows') as Section
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><ClipboardCheck className="h-5 w-5 text-gray-600" /></div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">IT Logs</h1>
          <p className="truncate text-sm text-gray-500">Borrowed items, repairs and maintenance across every asset.</p>
        </div>
      </div>
      <Tabs value={section} onChange={(t) => setSp({ tab: t }, { replace: true })}
        tabs={[{ key: 'borrows', label: 'Borrows' }, { key: 'repairs', label: 'Repairs' }, { key: 'maintenance', label: 'Maintenance' }]} />
      {section === 'borrows' && <Borrows />}
      {section === 'repairs' && <Repairs />}
      {section === 'maintenance' && <MaintenanceLog />}
    </div>
  )
}

/** Asset type choices for filters, from reference data. */
function useTypeNames() {
  const { data: ref } = useReference()
  return useMemo(() => ({ types: (ref?.asset_type ?? []).map((r) => r.name), vendors: (ref?.vendor ?? []).map((r) => r.name) }), [ref])
}

// ------------------------------------------------------------------ borrows
const BORROW_TABS = [
  { id: 'out', label: 'Out', status: 'open' },
  { id: 'overdue', label: 'Overdue', status: 'overdue', tone: 'text-red-700' },
  { id: 'returned', label: 'Returned', status: 'returned' },
  { id: 'all', label: 'All', status: undefined },
] as const
const BORROW_STATUS = [{ value: 'open', label: 'Out' }, { value: 'overdue', label: 'Overdue' }, { value: 'returned', label: 'Returned' }]

function BorrowStatus({ b }: { b: Borrow }) {
  if (b.returned_date) return <Badge variant="outline" className="border-gray-200 bg-gray-50 font-medium text-gray-600">Returned</Badge>
  if (b.overdue) return <Badge variant="outline" className="border-red-200 bg-red-50 font-medium text-red-700">Overdue</Badge>
  return <Badge variant="outline" className="border-violet-200 bg-violet-50 font-medium text-violet-700">Out</Badge>
}

const BORROW_COLUMNS: Column<Borrow>[] = [
  { id: 'item', label: 'Item', sort: 'item_name', locked: true, render: (b) => (
    <TitleCell title={b.asset_id ? assetLink(b.asset_id, b.item_name) : b.item_name} sub={b.serial_number ?? (b.asset_id ? undefined : 'Not an asset')} />) },
  { id: 'asset_type', label: 'Type', sort: 'asset_type', render: (b) => b.asset_type || dash },
  { id: 'borrower', label: 'Borrower', sort: 'borrower_name', render: (b) => b.employee_id
    ? <Link className="hover:text-primary hover:underline" to={`/employees/${b.employee_id}`} onClick={(e) => e.stopPropagation()}>{b.borrower_name}</Link> : b.borrower_name },
  { id: 'status', label: 'Status', render: (b) => <BorrowStatus b={b} /> },
  { id: 'borrowed', label: 'Borrowed', sort: 'borrowed_date', render: (b) => day(b.borrowed_date) },
  { id: 'due', label: 'Due', sort: 'expected_return_date', render: (b) => b.expected_return_date
    ? <span className={cn('tabular-nums', b.overdue ? 'font-medium text-red-700' : 'text-gray-700')}>{formatDate(b.expected_return_date)}</span> : dash },
  { id: 'returned', label: 'Returned', sort: 'returned_date', render: (b) => day(b.returned_date) },
  { id: 'notes', label: 'Notes', render: (b) => b.notes ? <span className="block max-w-[18rem] truncate text-gray-600" title={b.notes}>{b.notes}</span> : dash },
  { id: 'created_at', label: 'Logged', sort: 'created_at', render: (b) => day(b.created_at) },
]
const BORROW_SORTS: SortDef[] = [
  { id: 'borrowed_date', label: 'Borrowed date', kind: 'date' }, { id: 'expected_return_date', label: 'Due date', kind: 'date' },
  { id: 'returned_date', label: 'Returned date', kind: 'date' }, { id: 'item_name', label: 'Item' }, { id: 'borrower_name', label: 'Borrower' },
  { id: 'asset_type', label: 'Type' }, { id: 'created_at', label: 'Recently logged', kind: 'date' },
]

function borrowParams(f: FilterState) {
  const b = range(f.borrowed_date), d = range(f.expected_return_date), r = range(f.returned_date)
  return {
    status: csv(f.status), employee_ids: csv(f.borrower), asset_type: csv(f.asset_type),
    borrowed_from: b.from, borrowed_to: b.to, due_from: d.from, due_to: d.to, returned_from: r.from, returned_to: r.to,
  }
}

function Borrows() {
  const can = useCan()
  const navigate = useNavigate()
  const manage = can('itlog.manage')
  const t = useTableState({ key: 'borrows', defaultTab: 'out', defaultSort: 'borrowed_date', defaultOrder: 'desc',
    defaultColumns: ['asset_type', 'borrower', 'status', 'borrowed', 'due', 'returned'] })
  const trash = !!t.extras.trash
  const { types } = useTypeNames()
  const { data: employees = [] } = useEmployees(true)
  const fields = useMemo(() => [
    filterField('status', 'Status', 'select', BORROW_STATUS),
    filterField('borrower', 'Borrower', 'select', employees.map((e) => ({ value: String(e.id), label: e.active ? e.name : `${e.name} (inactive)` }))),
    filterField('asset_type', 'Item type', 'select', [...types, { value: NO_ASSET, label: 'Not an asset (other item)' }]),
    filterField('borrowed_date', 'Borrowed', 'date'),
    filterField('expected_return_date', 'Due', 'date'),
    filterField('returned_date', 'Returned', 'date'),
  ], [employees, types])

  const tab = BORROW_TABS.find((x) => x.id === t.tab) ?? BORROW_TABS[0]
  const panel = borrowParams(t.filters)
  const { data, isLoading, isFetching, error } = useBorrows({
    ...panel, ...(tab.status ? { status: tab.status } : {}), q: t.search || undefined, deleted: trash || undefined,
    page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order,
  })
  const counts = {
    out: useBorrows({ status: 'open', page_size: 1 }).data?.total,
    overdue: useBorrows({ status: 'overdue', page_size: 1 }).data?.total,
    returned: useBorrows({ status: 'returned', page_size: 1 }).data?.total,
    all: useBorrows({ page_size: 1 }).data?.total,
  }
  const items = data?.items ?? []
  const [dialog, setDialog] = useState<null | { kind: 'add' } | { kind: 'edit' | 'return'; row: Borrow }>(null)
  const del = useAssetMutation((a, id: number) => a.borrows.remove(id))
  const restore = useAssetMutation((a, id: number) => a.borrows.restore(id))
  const { confirm, dialog: confirmDialog } = useConfirm()
  const filtered = !!t.search || Object.keys(t.filters).length > 0 || tab.id !== 'all'

  const rowMenu = (b: Borrow): ReactNode => manage && (
    <RowMenu items={trash ? [
      { label: 'Restore', icon: <RotateCcw />, onSelect: () => restore.mutate(b.id, { onSuccess: () => toast.success('Entry restored'), onError: (e) => toast.error(errorMessage(e)) }) },
    ] : [
      { label: 'Return…', icon: <CornerDownLeft />, hidden: !!b.returned_date, onSelect: () => setDialog({ kind: 'return', row: b }) },
      { label: 'Edit', icon: <Pencil />, onSelect: () => setDialog({ kind: 'edit', row: b }) },
      { label: 'Open asset', icon: <ExternalLink />, hidden: !b.asset_id, onSelect: () => navigate(`/assets/${b.asset_id}`) },
      { label: 'Delete', icon: <Trash2 />, danger: true, divider: true, onSelect: () => confirm('Delete borrow entry', 'Delete this entry? You can restore it from "Show deleted".', () => del.mutateAsync(b.id).then(() => toast.success('Entry deleted')), 'Delete') },
    ]} />
  )

  return (
    <>
      <div className="flex shrink-0 flex-wrap items-end gap-2">
        {!trash && <div className="min-w-0 flex-1"><TableTabs tabs={BORROW_TABS.map((x) => ({ id: x.id, label: x.label, count: counts[x.id], tone: 'tone' in x ? x.tone : undefined }))} value={t.tab} onChange={t.setTab} /></div>}
        {trash && <Button variant="outline" size="sm" className="mr-auto" onClick={() => t.setExtra('trash', false)}>Back to borrows</Button>}
        {manage && !trash && <Button size="sm" onClick={() => setDialog({ kind: 'add' })}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Lend item</span></Button>}
      </div>
      <TableToolbar state={t} searchPlaceholder="Item, borrower, serial, notes…" filterFields={fields} sorts={BORROW_SORTS} columns={BORROW_COLUMNS}
        more={manage ? <MoreMenu toggles={[{ id: 'trash', label: 'Show deleted', value: trash, onChange: (v) => t.setExtra('trash', v) }]} /> : undefined} />
      <DataTable rows={items} rowKey={(b) => b.id} columns={BORROW_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null}
        onRowClick={manage && !trash ? (b) => setDialog({ kind: 'edit', row: b }) : undefined}
        rowClassName={(b) => !trash && b.overdue && 'bg-red-50/40'} actions={rowMenu}
        empty={<EmptyRows icon={<ArrowLeftRight className="h-9 w-9" />} title={trash ? 'Nothing deleted' : 'No borrow entries match'}
          hint={!trash && filtered ? 'Try another tab or clear the filters.' : undefined} />}
        pager={{ page: t.page, pages: data?.total_pages ?? 1, total: data?.total ?? 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'entries' }} />
      {dialog?.kind === 'add' && <BorrowDialog onClose={() => setDialog(null)} />}
      {dialog?.kind === 'edit' && <BorrowDialog borrow={dialog.row} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'return' && <ReturnDialog borrow={dialog.row} onClose={() => setDialog(null)} />}
      {confirmDialog}
    </>
  )
}

// ------------------------------------------------------------------ repairs
const REPAIR_TABS = [
  { id: 'open', label: 'In progress', status: 'In Progress', tone: 'text-amber-700' },
  { id: 'complete', label: 'Complete', status: 'Complete' },
  { id: 'all', label: 'All', status: undefined },
] as const

const REPAIR_COLUMNS: Column<RepairRow>[] = [
  { id: 'asset', label: 'Asset', sort: 'asset', locked: true, render: (r) => <TitleCell title={assetLink(r.asset_id, r.asset_name)} sub={r.serial_number ?? undefined} /> },
  { id: 'asset_type', label: 'Type', sort: 'asset_type', render: (r) => r.asset_type || dash },
  { id: 'date', label: 'Date', sort: 'date', render: (r) => day(r.repair_date) },
  { id: 'issue', label: 'Issue / work done', sort: 'issue', render: (r) => <span className="block max-w-[20rem] truncate" title={r.issue}>{r.issue}</span> },
  { id: 'vendor', label: 'Vendor', sort: 'vendor', render: (r) => r.vendor || dash },
  { id: 'cost', label: 'Cost', sort: 'cost', align: 'right', render: (r) => r.cost != null ? <span className="tabular-nums">{formatMoney(r.cost, r.currency)}</span> : dash },
  { id: 'status', label: 'Status', sort: 'status', render: (r) => r.status === 'Complete'
    ? <Badge variant="outline" className="border-green-200 bg-green-50 font-medium text-green-700">Complete</Badge>
    : <Badge variant="outline" className="border-amber-200 bg-amber-50 font-medium text-amber-700">In progress</Badge> },
  { id: 'warranty', label: 'Repair warranty', render: (r) => r.warranty || dash },
  { id: 'notes', label: 'Notes', render: (r) => r.notes ? <span className="block max-w-[18rem] truncate text-gray-600" title={r.notes}>{r.notes}</span> : dash },
  { id: 'created_at', label: 'Logged', sort: 'created_at', render: (r) => day(r.created_at) },
]
const REPAIR_SORTS: SortDef[] = [
  { id: 'date', label: 'Repair date', kind: 'date' }, { id: 'asset', label: 'Asset' }, { id: 'asset_type', label: 'Type' },
  { id: 'issue', label: 'Issue' }, { id: 'vendor', label: 'Vendor' }, { id: 'cost', label: 'Cost', kind: 'number' },
  { id: 'status', label: 'Status' }, { id: 'created_at', label: 'Recently logged', kind: 'date' },
]

function Repairs() {
  const can = useCan()
  const navigate = useNavigate()
  const manage = can('itlog.manage')
  const t = useTableState({ key: 'repairs', defaultTab: 'all', defaultSort: 'date', defaultOrder: 'desc',
    defaultColumns: ['asset_type', 'date', 'issue', 'vendor', 'cost', 'status'] })
  const { types, vendors } = useTypeNames()
  const fields = useMemo(() => [
    filterField('status', 'Status', 'select', [...REPAIR_STATUSES]),
    filterField('vendor', 'Vendor', 'select', vendors),
    filterField('asset_type', 'Asset type', 'select', types),
    filterField('date', 'Repair date', 'date'),
    filterField('cost', 'Cost', 'currency'),
  ], [types, vendors])
  const tab = REPAIR_TABS.find((x) => x.id === t.tab) ?? REPAIR_TABS[2]
  const when = range(t.filters.date)
  const { data, isLoading, isFetching, error } = useRepairLog({
    status: tab.status ?? csv(t.filters.status), vendor: csv(t.filters.vendor), asset_type: csv(t.filters.asset_type),
    date_from: when.from, date_to: when.to, cost_min: t.filters.cost?.gte, cost_max: t.filters.cost?.lte,
    q: t.search || undefined, page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order,
  })
  const counts = {
    open: useRepairLog({ status: 'In Progress', page_size: 1 }).data?.total,
    complete: useRepairLog({ status: 'Complete', page_size: 1 }).data?.total,
    all: useRepairLog({ page_size: 1 }).data?.total,
  }
  const items = (data?.items ?? []) as RepairRow[]
  const [editing, setEditing] = useState<RepairRow | null>(null)
  const del = useAssetMutation((a, r: RepairRow) => a.assets.deleteRepair(r.asset_id, r.id))
  const { confirm, dialog: confirmDialog } = useConfirm()

  const rowMenu = (r: RepairRow): ReactNode => (
    <RowMenu items={[
      { label: 'Edit', icon: <Pencil />, hidden: !manage, onSelect: () => setEditing(r) },
      { label: 'Open asset', icon: <ExternalLink />, onSelect: () => navigate(`/assets/${r.asset_id}`) },
      { label: 'Delete', icon: <Trash2 />, danger: true, divider: true, hidden: !manage, onSelect: () => confirm('Delete repair', `Delete this repair of ${r.asset_name}? This cannot be undone.`, () => del.mutateAsync(r).then(() => toast.success('Repair deleted')), 'Delete') },
    ]} />
  )
  return (
    <>
      <TableTabs tabs={REPAIR_TABS.map((x) => ({ id: x.id, label: x.label, count: counts[x.id], tone: 'tone' in x ? x.tone : undefined }))} value={t.tab} onChange={t.setTab} />
      <TableToolbar state={t} searchPlaceholder="Asset, serial, issue, vendor…" filterFields={fields} sorts={REPAIR_SORTS} columns={REPAIR_COLUMNS} />
      <DataTable rows={items} rowKey={(r) => r.id} columns={REPAIR_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null}
        onRowClick={manage ? setEditing : (r) => navigate(`/assets/${r.asset_id}`)} actions={rowMenu}
        empty={<EmptyRows icon={<Wrench className="h-9 w-9" />} title="No repairs match" hint="Repairs are logged from an asset's page or the Create menu." />}
        pager={{ page: t.page, pages: data?.total_pages ?? 1, total: data?.total ?? 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'repairs' }} />
      {editing && <RepairDialog asset={{ id: editing.asset_id, display_name: editing.asset_name }} repair={editing} onClose={() => setEditing(null)} />}
      {confirmDialog}
    </>
  )
}

// -------------------------------------------------------------- maintenance
const MAINT_TABS = [
  { id: 'all', label: 'All', issues: undefined },
  { id: 'issues', label: 'Issues found', issues: 'true', tone: 'text-amber-700' },
  { id: 'clean', label: 'No issues', issues: 'false' },
] as const

const MAINT_COLUMNS: Column<MaintRow>[] = [
  { id: 'asset', label: 'Asset', sort: 'asset', locked: true, render: (m) => <TitleCell title={assetLink(m.asset_id, m.asset_name)} sub={m.serial_number ?? undefined} /> },
  { id: 'asset_type', label: 'Type', sort: 'asset_type', render: (m) => m.asset_type || dash },
  { id: 'date', label: 'Date', sort: 'date', render: (m) => day(m.maintenance_date) },
  { id: 'body', label: 'Body', sort: 'body_condition', render: (m) => m.body_condition },
  { id: 'os', label: 'OS', sort: 'operating_system', render: (m) => m.operating_system || dash },
  { id: 'issues', label: 'Issues found', render: (m) => {
    const list = issuesOf(m)
    if (!list.length) return <span className="text-gray-500">None</span>
    const text = list.map((c) => `${c.component}: ${c.status}`).join(', ')
    return <span className="block max-w-[20rem] truncate text-amber-700" title={text}>{text}</span>
  } },
  { id: 'notes', label: 'Notes', render: (m) => m.notes ? <span className="block max-w-[18rem] truncate text-gray-600" title={m.notes}>{m.notes}</span> : dash },
  { id: 'created_at', label: 'Logged', sort: 'created_at', render: (m) => day(m.created_at) },
]
const MAINT_SORTS: SortDef[] = [
  { id: 'date', label: 'Maintenance date', kind: 'date' }, { id: 'asset', label: 'Asset' }, { id: 'asset_type', label: 'Type' },
  { id: 'body_condition', label: 'Body condition' }, { id: 'operating_system', label: 'Operating system' }, { id: 'created_at', label: 'Recently logged', kind: 'date' },
]

function MaintenanceLog() {
  const can = useCan()
  const navigate = useNavigate()
  const manage = can('itlog.manage')
  const t = useTableState({ key: 'maintenance', defaultTab: 'all', defaultSort: 'date', defaultOrder: 'desc',
    defaultColumns: ['asset_type', 'date', 'body', 'os', 'issues'] })
  const { types } = useTypeNames()
  const fields = useMemo(() => [
    filterField('issues', 'Issues found', 'boolean'),
    filterField('body_condition', 'Body condition', 'select', [...BODY_CONDITIONS]),
    filterField('asset_type', 'Asset type', 'select', types),
    filterField('date', 'Maintenance date', 'date'),
  ], [types])
  const tab = MAINT_TABS.find((x) => x.id === t.tab) ?? MAINT_TABS[0]
  const when = range(t.filters.date)
  const { data, isLoading, isFetching, error } = useMaintenanceLog({
    issues: tab.issues ?? yesNo(t.filters.issues), body_condition: csv(t.filters.body_condition), asset_type: csv(t.filters.asset_type),
    date_from: when.from, date_to: when.to, q: t.search || undefined, page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order,
  })
  const counts = {
    all: useMaintenanceLog({ page_size: 1 }).data?.total,
    issues: useMaintenanceLog({ issues: 'true', page_size: 1 }).data?.total,
    clean: useMaintenanceLog({ issues: 'false', page_size: 1 }).data?.total,
  }
  const items = (data?.items ?? []) as MaintRow[]
  const [editing, setEditing] = useState<MaintRow | null>(null)
  const del = useAssetMutation((a, m: MaintRow) => a.assets.deleteMaintenance(m.asset_id, m.id))
  const { confirm, dialog: confirmDialog } = useConfirm()

  const rowMenu = (m: MaintRow): ReactNode => (
    <RowMenu items={[
      { label: 'Edit', icon: <Pencil />, hidden: !manage, onSelect: () => setEditing(m) },
      { label: 'Open asset', icon: <ExternalLink />, onSelect: () => navigate(`/assets/${m.asset_id}`) },
      { label: 'Delete', icon: <Trash2 />, danger: true, divider: true, hidden: !manage, onSelect: () => confirm('Delete maintenance entry', `Delete this maintenance entry for ${m.asset_name}? This cannot be undone.`, () => del.mutateAsync(m).then(() => toast.success('Entry deleted')), 'Delete') },
    ]} />
  )
  return (
    <>
      <TableTabs tabs={MAINT_TABS.map((x) => ({ id: x.id, label: x.label, count: counts[x.id], tone: 'tone' in x ? x.tone : undefined }))} value={t.tab} onChange={t.setTab} />
      <TableToolbar state={t} searchPlaceholder="Asset, serial, notes…" filterFields={fields} sorts={MAINT_SORTS} columns={MAINT_COLUMNS} />
      <DataTable rows={items} rowKey={(m) => m.id} columns={MAINT_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null}
        onRowClick={manage ? setEditing : (m) => navigate(`/assets/${m.asset_id}`)} actions={rowMenu}
        empty={<EmptyRows icon={<ClipboardCheck className="h-9 w-9" />} title="No maintenance entries match" hint="Maintenance is logged from an asset's page or the Create menu." />}
        pager={{ page: t.page, pages: data?.total_pages ?? 1, total: data?.total ?? 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'entries' }} />
      {editing && <MaintenanceDialog asset={{ id: editing.asset_id, display_name: editing.asset_name, asset_type: editing.asset_type ?? '' }} entry={editing} onClose={() => setEditing(null)} />}
      {confirmDialog}
    </>
  )
}
