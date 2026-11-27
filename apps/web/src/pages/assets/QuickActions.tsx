import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ArrowRight, Check, Laptop, Zap } from 'lucide-react'
import { errorMessage, formatDate, todayISO, useAssetMutation, useAssets, useEmployeeOverview, useReference, type Asset, type OffboardRequest } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { EmployeePicker, Field, useCan } from '@/components/assets/shared'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, TitleCell, clientRows, csv, filterField, useTableState, type Column, type SortDef,
} from '@/components/data-table'

type Tab = 'assign' | 'reassign' | 'offboard'

const dash = <span className="text-gray-400">-</span>
const ASSET_COLUMNS: Column<Asset>[] = [
  { id: 'asset', label: 'Asset', sort: 'brand', locked: true, render: (a) => <TitleCell title={[a.brand, a.model].filter(Boolean).join(' ') || a.asset_type} sub={a.serial_number ?? undefined} /> },
  { id: 'asset_type', label: 'Type', sort: 'asset_type', render: (a) => a.other_type_name || a.asset_type },
  { id: 'serial', label: 'Serial / product no.', sort: 'serial_number', render: (a) => <span className="font-mono text-xs">{a.serial_number || '-'}</span> },
  { id: 'location', label: 'Location', sort: 'location', render: (a) => a.location || dash },
  { id: 'supplier', label: 'Supplier', sort: 'supplier', render: (a) => a.supplier || dash },
  { id: 'warranty', label: 'Warranty', sort: 'warranty_end_date', render: (a) => a.warranty_end_date ? <span className="tabular-nums">{formatDate(a.warranty_end_date)}</span> : dash },
  { id: 'purchase_date', label: 'Purchased', sort: 'purchase_date', render: (a) => a.purchase_date ? <span className="tabular-nums">{formatDate(a.purchase_date)}</span> : dash },
]
const ASSET_SORTS: SortDef[] = [
  { id: 'brand', label: 'Asset (brand)' }, { id: 'asset_type', label: 'Type' }, { id: 'serial_number', label: 'Serial' }, { id: 'location', label: 'Location' },
  { id: 'supplier', label: 'Supplier' }, { id: 'warranty_end_date', label: 'Warranty end', kind: 'date' }, { id: 'purchase_date', label: 'Purchase date', kind: 'date' },
]

function useAssetFilterFields() {
  const { data: ref } = useReference()
  return useMemo(() => {
    const names = (k: 'asset_type' | 'brand' | 'location' | 'vendor') => (ref?.[k] ?? []).map((r) => r.name)
    return [
      filterField('asset_type', 'Type', 'select', names('asset_type')),
      filterField('brand', 'Brand', 'select', names('brand')),
      filterField('location', 'Location', 'select', names('location')),
      filterField('supplier', 'Supplier', 'select', names('vendor')),
    ]
  }, [ref])
}

/** Quick Assign (new hire), Reassignment (move between people), Offboarding (exit checklist). */
export default function QuickActions() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'assign'
  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><Zap className="h-5 w-5 text-gray-600" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">Quick actions</h1>
            <p className="truncate text-sm text-gray-500">Common people workflows in one place.</p>
          </div>
        </div>
      </div>
      <TableTabs value={tab} onChange={(t) => setSp({ tab: t }, { replace: true })} tabs={[{ id: 'assign', label: 'Quick assign' }, { id: 'reassign', label: 'Reassign' }, { id: 'offboard', label: 'Offboarding' }]} />
      {tab === 'assign' && <QuickAssign preselected={(sp.get('assets') ?? '').split(',').filter(Boolean).map(Number)} />}
      {tab === 'reassign' && <Reassign />}
      {tab === 'offboard' && <Offboard />}
    </div>
  )
}

function QuickAssign({ preselected }: { preselected: number[] }) {
  const [employeeId, setEmployeeId] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>(preselected)
  const t = useTableState({ key: 'quick-assign', defaultSort: 'brand', defaultColumns: ['asset_type', 'serial', 'location', 'warranty'] })
  const fields = useAssetFilterFields()
  const f = t.filters
  const { data, isLoading, isFetching, error } = useAssets({
    assignment_status: 'Unassigned', condition_status: 'Operational', q: t.search || undefined,
    asset_type: csv(f.asset_type), brand: csv(f.brand), location: csv(f.location), supplier: csv(f.supplier),
    page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order,
  })
  const m = useAssetMutation((a, _: void) => a.assets.bulkAssign({ items: picked.map((id) => ({ asset_id: id, employee_id: employeeId })), effective_date: todayISO() }))
  return (
    <>
      <Card className="shrink-0"><CardContent className="flex flex-wrap items-end gap-3 p-4">
        <Field label="Employee" className="min-w-[240px] flex-1"><EmployeePicker value={employeeId} onChange={setEmployeeId} /></Field>
        <Button disabled={!employeeId || !picked.length || m.isPending} onClick={() => m.mutate(undefined, {
          onSuccess: (r) => { toast.success(`Assigned ${r.updated} asset(s)`); setPicked([]) }, onError: (e) => toast.error(errorMessage(e)),
        })}>Assign {picked.length || ''} asset(s)</Button>
      </CardContent></Card>
      <TableToolbar state={t} searchPlaceholder="Brand, model, serial…" filterFields={fields} sorts={ASSET_SORTS} columns={ASSET_COLUMNS}>
        {picked.length > 0 && <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setPicked([])}>Clear {picked.length} selected</Button>}
      </TableToolbar>
      <DataTable rows={data?.items ?? []} rowKey={(a) => a.id} columns={ASSET_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null}
        selected={picked} onSelectedChange={(ids) => setPicked(ids as number[])}
        onRowClick={(a) => setPicked((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id])}
        empty={<EmptyRows icon={<Laptop className="h-9 w-9" />} title="No available assets" hint="Only unassigned, operational assets can be assigned here." />}
        pager={{ page: t.page, pages: data?.total_pages ?? 1, total: data?.total ?? 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'available assets' }} />
    </>
  )
}

function Reassign() {
  const [from, setFrom] = useState<number | null>(null)
  const [to, setTo] = useState<number | null>(null)
  const [picked, setPicked] = useState<number[]>([])
  const t = useTableState({ key: 'reassign', defaultSort: 'brand', defaultColumns: ['asset_type', 'serial', 'location', 'warranty'] })
  const fields = useAssetFilterFields()
  const { data, isLoading } = useEmployeeOverview(from ?? 0)
  const m = useAssetMutation((a, _: void) => a.assets.bulkAssign({ items: picked.map((id) => ({ asset_id: id, employee_id: to })), effective_date: todayISO(), remark: 'Reassigned' }))
  const assets = data?.assets ?? []
  const get = (a: Asset, slug: string): unknown => (a as unknown as Record<string, unknown>)[slug]
  const view = clientRows(assets, t, fields, get, (a) => [a.display_name, a.brand, a.model, a.serial_number, a.asset_type].filter(Boolean).join(' '))
  return (
    <>
      <Card className="shrink-0"><CardContent className="space-y-4 p-4">
        <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto_1fr_auto]">
          <Field label="From"><EmployeePicker includeInactive value={from} onChange={(v) => { setFrom(v); setPicked([]); t.setPage(1) }} /></Field>
          <ArrowRight className="mx-auto mb-3 hidden h-4 w-4 text-gray-400 sm:block" />
          <Field label="To (empty = unassign)"><EmployeePicker value={to} onChange={setTo} /></Field>
          <Button disabled={!picked.length || from === to || m.isPending} onClick={() => m.mutate(undefined, {
            onSuccess: (r) => { toast.success(`Moved ${r.updated} asset(s)`); setPicked([]) }, onError: (e) => toast.error(errorMessage(e)),
          })}>{to ? 'Transfer' : 'Unassign'} {picked.length || ''} asset(s)</Button>
        </div>
      </CardContent></Card>
      {from ? (
        <>
          <TableToolbar state={t} searchPlaceholder="Brand, model, serial…" filterFields={fields} sorts={ASSET_SORTS} columns={ASSET_COLUMNS} />
          <DataTable rows={view.rows} rowKey={(a) => a.id} columns={ASSET_COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
            loading={isLoading && !data} selected={picked} onSelectedChange={(ids) => setPicked(ids as number[])}
            onRowClick={(a) => setPicked((p) => p.includes(a.id) ? p.filter((x) => x !== a.id) : [...p, a.id])}
            empty={<EmptyRows icon={<Laptop className="h-9 w-9" />} title={assets.length ? 'No assets match' : 'This employee holds no assets'} hint={assets.length ? undefined : ''} />}
            pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'assets' }} />
        </>
      ) : <p className="text-sm text-gray-500">Pick who the assets are moving from to see what they hold.</p>}
    </>
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
