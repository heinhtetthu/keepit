import { useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Users, UserPlus, UserMinus, UserRound, Upload, X, Pencil, Building2, Trash2, Check, CircleDot, Download, FileSpreadsheet, Network, Plus } from 'lucide-react'
import { errorMessage, formatDate, GENDERS } from '@workspace/core'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Select } from '@/components/ui/select'
import Modal from '@/components/ui/modal'
import RowMenu from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import { useAuthStore } from '../store/auth'
import { cn } from '@/lib/utils'
import type { Employee } from '../types'
import OffboardDialog from '../components/OffboardDialog'
import EmployeeFormDialog from '../components/EmployeeFormDialog'
import { useConfirm } from '@/components/assets/shared'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, TitleCell, clientRows, filterField, useTableState,
  type Column, type SortDef,
} from '@/components/data-table'

interface BusinessUnit { id: number; name: string; active: boolean }
interface Department { id: number; name: string; employee_count: number }

interface ImportPreview {
  columns: string[]
  mapping: { [field: string]: string | null }
  total_rows: number
  preview_rows: { name: string; business_units: string[]; email: string | null; title: string | null; department?: string | null; country?: string | null }[]
}

interface ImportResult { created: number; updated: number; skipped: number; errors: string[]; total_rows: number }

export type EmployeesSection = 'employees' | 'units' | 'departments'

const apiMsg = (err: any, fallback: string) => err?.response?.data?.error?.message || err?.response?.data?.detail || fallback
const dash = <span className="text-gray-400">-</span>
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`

function useEmployeesAll() {
  return useQuery<Employee[]>({
    queryKey: ['employees', { include_inactive: true }],
    queryFn: async () => (await api.get('/employees?include_inactive=true')).data,
    retry: 1,
  })
}
function useBusinessUnitsAll() {
  return useQuery<BusinessUnit[]>({ queryKey: ['business-units', 'all'], queryFn: async () => (await api.get('/business-units?include_inactive=true')).data, retry: 1 })
}
function useDepartments() {
  return useQuery<Department[]>({ queryKey: ['departments'], queryFn: async () => (await api.get('/departments')).data, retry: 1 })
}
function useInvalidate() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['employees'] })
    qc.invalidateQueries({ queryKey: ['business-units'] })
    qc.invalidateQueries({ queryKey: ['departments'] })
  }
}

/** Employees directory, business units and departments (one section at a time). */
export default function EmployeesPanel({ show = 'employees' }: { show?: EmployeesSection }) {
  if (show === 'units') return <BusinessUnitsTable />
  if (show === 'departments') return <DepartmentsTable />
  return <EmployeeDirectory />
}

/* ---------------------------------------------------------------- directory */

type Tab = 'active' | 'resigned' | 'all'
const TABS: { id: Tab; label: string }[] = [{ id: 'active', label: 'Active' }, { id: 'resigned', label: 'Resigned' }, { id: 'all', label: 'All' }]

const COLUMNS: Column<Employee>[] = [
  { id: 'name', label: 'Name', sort: 'name', locked: true, render: (e) => (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">{e.name.charAt(0).toUpperCase()}</span>
      <TitleCell title={<Link to={`/employees/${e.id}`} className="hover:underline" onClick={(ev) => ev.stopPropagation()}>{e.name}</Link>} />
    </div>
  ) },
  { id: 'title', label: 'Title', sort: 'title', render: (e) => e.title || dash },
  { id: 'department', label: 'Department', sort: 'department', render: (e) => e.department || dash },
  { id: 'business_units', label: 'Business units', render: (e) => (e.business_units || []).length ? (
    <div className="flex gap-1">{e.business_units.map((u) => <span key={u} className="inline-flex items-center whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{u}</span>)}</div>
  ) : dash },
  { id: 'country', label: 'Country', sort: 'country', render: (e) => e.country || dash },
  { id: 'email', label: 'Email', sort: 'email', render: (e) => e.email
    ? <a href={`mailto:${e.email}`} className="hover:text-primary hover:underline" onClick={(ev) => ev.stopPropagation()}>{e.email}</a> : dash },
  { id: 'phone', label: 'Phone', render: (e) => e.phone
    ? <a href={`tel:${e.phone}`} className="hover:text-primary hover:underline" onClick={(ev) => ev.stopPropagation()}>{e.phone}</a> : dash },
  { id: 'gender', label: 'Gender', sort: 'gender', render: (e) => e.gender || dash },
  { id: 'joined', label: 'Joined', sort: 'join_date', render: (e) => e.join_date ? <span className="tabular-nums">{formatDate(e.join_date)}</span> : dash },
  { id: 'resigned', label: 'Resigned', sort: 'resignation_date', render: (e) => e.resignation_date ? <span className="tabular-nums">{formatDate(e.resignation_date)}</span> : dash },
  { id: 'status', label: 'Status', sort: 'status', render: (e) => <Badge variant={e.active ? 'success' : 'secondary'}>{e.active ? 'Active' : 'Resigned'}</Badge> },
]
const SORTS: SortDef[] = [
  { id: 'name', label: 'Name' }, { id: 'title', label: 'Title' }, { id: 'department', label: 'Department' }, { id: 'country', label: 'Country' },
  { id: 'join_date', label: 'Joined', kind: 'date' }, { id: 'resignation_date', label: 'Resigned', kind: 'date' }, { id: 'created_at', label: 'Recently added', kind: 'date' },
]

/** Value of one employee for filtering and sorting in the browser. */
function employeeValue(e: Employee, slug: string): unknown {
  switch (slug) {
    case 'business_unit': return e.business_units
    case 'status': return e.active ? 'Active' : 'Resigned'
    default: return (e as unknown as Record<string, unknown>)[slug] ?? null
  }
}
const employeeText = (e: Employee) => [e.name, e.email, e.phone, e.title, e.department, e.country, ...(e.business_units || [])].filter(Boolean).join(' ')
const distinct = (rows: Employee[], pick: (e: Employee) => string | null | undefined) =>
  [...new Set(rows.map(pick).filter((x): x is string => !!x))].sort((a, b) => a.localeCompare(b))

function EmployeeDirectory() {
  const navigate = useNavigate()
  const invalidate = useInvalidate()
  const canManage = useAuthStore((st) => st.hasPermission('employee.manage'))
  const canRelease = useAuthStore((st) => st.hasPermission('record.edit'))
  const t = useTableState({ key: 'employees', defaultSort: 'name', defaultTab: 'active', defaultColumns: ['department', 'business_units', 'country', 'email', 'joined', 'status'] })
  const { confirm, dialog: confirmDialog } = useConfirm()

  const [editing, setEditing] = useState<Employee | 'new' | null>(null)
  const [offboarding, setOffboarding] = useState<Employee | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [selected, setSelected] = useState<number[]>([])
  const [bulkBu, setBulkBu] = useState('')
  const [bulkDept, setBulkDept] = useState('')

  const { data: employees, isLoading, isFetching, error } = useEmployeesAll()
  const { data: businessUnits = [] } = useBusinessUnitsAll()
  const { data: departments = [] } = useDepartments()
  const all = useMemo(() => employees ?? [], [employees])

  const fields = useMemo(() => [
    filterField('department', 'Department', 'select', [...new Set([...departments.map((d) => d.name), ...distinct(all, (e) => e.department)])]),
    filterField('business_unit', 'Business unit', 'business_unit'),
    filterField('country', 'Country', 'select', distinct(all, (e) => e.country)),
    filterField('title', 'Title', 'select', distinct(all, (e) => e.title)),
    filterField('gender', 'Gender', 'select', [...GENDERS]),
    filterField('join_date', 'Joined', 'date'),
    filterField('resignation_date', 'Resigned', 'date'),
    filterField('status', 'Status', 'select', ['Active', 'Resigned']),
  ], [all, departments])

  const counts = useMemo(() => ({ active: all.filter((e) => e.active).length, resigned: all.filter((e) => !e.active).length, all: all.length }), [all])
  const inTab = useMemo(() => all.filter((e) => (t.tab === 'active' ? e.active : t.tab === 'resigned' ? !e.active : true)), [all, t.tab])
  const view = clientRows(inTab, t, fields, employeeValue, employeeText)
  const filtered = !!t.search || Object.keys(t.filters).length > 0

  const remove = useMutation({ mutationFn: async (id: number) => api.delete(`/employees/${id}`), onSuccess: invalidate })
  const bulkDelete = useMutation({ mutationFn: async (ids: number[]) => (await api.delete('/employees/bulk', { data: { ids } })).data as { deleted: number } })
  const bulkUpdate = useMutation({
    mutationFn: async (arg: { ids: number[]; business_units?: string[]; department?: string; active?: boolean }) => (await api.post('/employees/bulk', arg)).data as { updated: number },
    onSuccess: (d) => { invalidate(); setSelected([]); setBulkBu(''); setBulkDept(''); toast.success(`Updated ${plural(d.updated, 'employee')}`) },
    onError: (err) => toast.error(apiMsg(err, 'Bulk update failed')),
  })

  const rowMenu = (e: Employee): ReactNode => (
    <RowMenu label={`Actions for ${e.name}`} items={[
      { label: 'Open profile', icon: <UserRound />, onSelect: () => navigate(`/employees/${e.id}`) },
      { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(e), hidden: !canManage },
      { label: 'Release seats…', icon: <UserMinus />, onSelect: () => setOffboarding(e), hidden: !canRelease },
      { label: 'Delete', icon: <Trash2 />, danger: true, divider: true, hidden: !canManage, onSelect: () =>
        confirm('Delete employee', `Delete ${e.name}? Assignment history keeps the name.`, () => remove.mutateAsync(e.id).then(() => toast.success(`${e.name} deleted`)), 'Delete') },
    ]} />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <TableTabs tabs={TABS.map((x) => ({ id: x.id, label: x.label, count: employees ? counts[x.id] : null }))} value={t.tab}
        onChange={(id) => { t.setTab(id); setSelected([]) }} />

      <TableToolbar state={t} searchPlaceholder="Name, email, department, country…" filterFields={fields} sorts={SORTS} columns={COLUMNS}>
        {canManage && <>
          <Button variant="outline" size="sm" onClick={() => setShowImport(true)}><Upload className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Import</span></Button>
          <Button size="sm" onClick={() => setEditing('new')}><UserPlus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add employee</span></Button>
        </>}
      </TableToolbar>

      <DataTable rows={view.rows} rowKey={(e) => e.id} columns={COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading} fetching={isFetching && !isLoading} error={error ? errorMessage(error) : null}
        onRowClick={(e) => navigate(`/employees/${e.id}`)} rowClassName={(e) => !e.active && 'opacity-70'}
        selected={canManage ? selected : undefined} onSelectedChange={canManage ? (ids) => setSelected(ids as number[]) : undefined}
        actions={rowMenu}
        empty={<EmptyRows icon={<Users className="h-9 w-9" />} title={all.length === 0 ? 'No employees yet' : 'No employees match'}
          hint={all.length === 0 && canManage ? 'Use Import (CSV/XLSX) for your one-time batch, or add them one by one.' : filtered || t.tab !== 'all' ? 'Try another tab or clear the filters.' : undefined} />}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'employees' }} />

      {/* Bulk actions: floating bar while rows are selected */}
      {selected.length > 0 && canManage && (
        <div className="fixed bottom-20 left-1/2 z-[80] flex max-w-[calc(100vw-2rem)] -translate-x-1/2 animate-sheet-up flex-wrap items-center gap-2 rounded-xl border bg-white/95 px-3 py-2 shadow-xl backdrop-blur lg:bottom-4">
          <span className="mr-1 text-sm font-semibold">{selected.length} selected</span>
          <div className="flex items-center gap-1">
            <Select className="h-8 max-w-[150px] text-xs" value={bulkBu} onChange={(e) => setBulkBu(e.target.value)} aria-label="Business unit to set">
              <option value="">Business unit…</option>
              {businessUnits.map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
            </Select>
            <Button size="sm" variant="outline" disabled={!bulkBu || bulkUpdate.isPending} onClick={() => bulkUpdate.mutate({ ids: selected, business_units: [bulkBu] })}>Set</Button>
          </div>
          <div className="flex items-center gap-1">
            <Select className="h-8 max-w-[150px] text-xs" value={bulkDept} onChange={(e) => setBulkDept(e.target.value)} aria-label="Department to set">
              <option value="">Department…</option>
              {departments.map((d) => <option key={d.id} value={d.name}>{d.name}</option>)}
            </Select>
            <Button size="sm" variant="outline" disabled={!bulkDept || bulkUpdate.isPending} onClick={() => bulkUpdate.mutate({ ids: selected, department: bulkDept })}>Set</Button>
          </div>
          <Button size="sm" variant="outline" disabled={bulkUpdate.isPending} onClick={() => bulkUpdate.mutate({ ids: selected, active: true })}>Activate</Button>
          <Button size="sm" variant="outline" disabled={bulkUpdate.isPending} onClick={() => bulkUpdate.mutate({ ids: selected, active: false })}>Deactivate</Button>
          <Button size="sm" variant="outline" className="text-red-600 hover:bg-red-50" disabled={bulkDelete.isPending}
            onClick={() => confirm('Delete employees', `Delete ${plural(selected.length, 'selected employee')}? Existing assignment history keeps the name snapshots.`,
              () => bulkDelete.mutateAsync(selected).then((d) => { invalidate(); setSelected([]); toast.success(`Deleted ${plural(d.deleted, 'employee')}`) }), 'Delete')}>
            <Trash2 className="h-3.5 w-3.5 sm:mr-1" /><span className="hidden sm:inline">Delete</span>
          </Button>
          <Button variant="ghost" size="sm" className="text-gray-500" onClick={() => setSelected([])}>Clear</Button>
        </div>
      )}

      {editing && <EmployeeFormDialog employee={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} onSaved={invalidate} />}
      {showImport && <ImportEmployeesDialog onClose={() => setShowImport(false)} onImported={invalidate} />}
      {offboarding && <OffboardDialog employee={offboarding} onClose={() => setOffboarding(null)} />}
      {confirmDialog}
    </div>
  )
}

/* ------------------------------------------------- business units / departments */

interface MasterRow { id: number; name: string; active: boolean; employees: number }

/** Shared add / rename / delete table for the business unit and department master lists. */
function MasterListTable({ listKey, noun, icon, rows, loading, error, withActive, onSave, onDelete, deleteNote }: {
  listKey: string
  noun: string
  icon: ReactNode
  rows: MasterRow[]
  loading: boolean
  error: unknown
  withActive?: boolean
  onSave: (id: number | null, payload: Record<string, unknown>) => Promise<unknown>
  onDelete: (id: number) => Promise<unknown>
  deleteNote: string
}) {
  const t = useTableState({ key: listKey, defaultSort: 'name', defaultColumns: withActive ? ['employees', 'status'] : ['employees'] })
  const { confirm, dialog: confirmDialog } = useConfirm()
  const [adding, setAdding] = useState('')
  const [renaming, setRenaming] = useState<MasterRow | null>(null)
  const [busy, setBusy] = useState(false)
  const lower = noun.toLowerCase()

  const columns: Column<MasterRow>[] = [
    { id: 'name', label: 'Name', sort: 'name', locked: true, render: (r) => <span className="font-medium text-gray-900">{r.name}</span> },
    { id: 'employees', label: 'Employees', sort: 'employees', align: 'right', render: (r) => r.employees },
    ...(withActive ? [{ id: 'status', label: 'Status', sort: 'status', render: (r: MasterRow) => <Badge variant={r.active ? 'success' : 'secondary'}>{r.active ? 'Active' : 'Inactive'}</Badge> }] : []),
  ]
  const sorts: SortDef[] = [{ id: 'name', label: 'Name' }, { id: 'employees', label: 'Employees', kind: 'number' }, ...(withActive ? [{ id: 'status', label: 'Status' }] : [])]
  const fields = useMemo(() => (withActive ? [filterField('status', 'Status', 'select', ['Active', 'Inactive'])] : []), [withActive])
  const value = (r: MasterRow, slug: string): unknown => (slug === 'status' ? (r.active ? 'Active' : 'Inactive') : (r as unknown as Record<string, unknown>)[slug])
  const view = clientRows(rows, t, fields, value, (r) => r.name)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true)
    try { await fn(); toast.success(ok); return true } catch (e) { toast.error(apiMsg(e, `Could not save the ${lower}`)); return false } finally { setBusy(false) }
  }
  const add = async () => { const name = adding.trim(); if (name && await run(() => onSave(null, { name }), `${noun} ${name} added`)) setAdding('') }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <TableToolbar state={t} searchPlaceholder={`Search ${lower}s…`} filterFields={fields.length ? fields : undefined} sorts={sorts} columns={columns}>
        <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); add() }}>
          <Input className="h-9 w-48" placeholder={`New ${lower} name…`} value={adding} onChange={(e) => setAdding(e.target.value)} aria-label={`New ${lower} name`} />
          <Button type="submit" size="sm" disabled={!adding.trim() || busy}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add</span></Button>
        </form>
      </TableToolbar>
      <DataTable rows={view.rows} rowKey={(r) => r.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={loading} error={error ? errorMessage(error) : null} rowClassName={(r) => !r.active && 'opacity-60'}
        actions={(r) => (
          <RowMenu label={`Actions for ${r.name}`} items={[
            { label: 'Rename', icon: <Pencil />, onSelect: () => setRenaming(r) },
            { label: r.active ? 'Deactivate' : 'Activate', icon: <CircleDot />, hidden: !withActive, onSelect: () => run(() => onSave(r.id, { active: !r.active }), `${r.name} ${r.active ? 'deactivated' : 'activated'}`) },
            { label: 'Delete', icon: <Trash2 />, danger: true, divider: true, onSelect: () =>
              confirm(`Delete ${lower}`, <>Delete <b>{r.name}</b>? {deleteNote}</>, () => onDelete(r.id).then(() => toast.success(`${r.name} deleted`)), 'Delete') },
          ]} />
        )}
        empty={<EmptyRows icon={icon} title={rows.length ? `No ${lower}s match` : `No ${lower}s yet`} hint={rows.length ? 'Clear the search or filters.' : `Add your first ${lower} above.`} />}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: `${lower}s` }} />

      {renaming && (
        <Modal size="sm" title={`Rename ${lower}`} onClose={() => setRenaming(null)} footer={<>
          <Button variant="outline" onClick={() => setRenaming(null)}>Cancel</Button>
          <Button disabled={!renaming.name.trim() || busy} onClick={async () => { if (await run(() => onSave(renaming.id, { name: renaming.name.trim() }), `${noun} renamed`)) setRenaming(null) }}>Save</Button>
        </>}>
          <form onSubmit={async (e) => { e.preventDefault(); if (renaming.name.trim() && await run(() => onSave(renaming.id, { name: renaming.name.trim() }), `${noun} renamed`)) setRenaming(null) }}>
            <Input autoFocus value={renaming.name} onChange={(e) => setRenaming({ ...renaming, name: e.target.value })} aria-label="Name" />
          </form>
        </Modal>
      )}
      {confirmDialog}
    </div>
  )
}

function BusinessUnitsTable() {
  const invalidate = useInvalidate()
  const { data: units = [], isLoading, error } = useBusinessUnitsAll()
  const { data: employees = [] } = useEmployeesAll()
  const rows = useMemo(() => units.map((u) => ({ id: u.id, name: u.name, active: u.active, employees: employees.filter((e) => (e.business_units || []).includes(u.name)).length })), [units, employees])
  return (
    <MasterListTable listKey="business-units" noun="Business unit" icon={<Building2 className="h-9 w-9" />} rows={rows} loading={isLoading} error={error} withActive
      onSave={async (id, payload) => { await (id ? api.put(`/business-units/${id}`, payload) : api.post('/business-units', payload)); invalidate() }}
      onDelete={async (id) => { await api.delete(`/business-units/${id}`); invalidate() }}
      deleteNote="Values already stored on records and employees keep the name as free text." />
  )
}

function DepartmentsTable() {
  const invalidate = useInvalidate()
  const { data: departments = [], isLoading, error } = useDepartments()
  const rows = useMemo(() => departments.map((d) => ({ id: d.id, name: d.name, active: true, employees: d.employee_count })), [departments])
  return (
    <MasterListTable listKey="departments" noun="Department" icon={<Network className="h-9 w-9" />} rows={rows} loading={isLoading} error={error}
      onSave={async (id, payload) => { await (id ? api.put(`/departments/${id}`, payload) : api.post('/departments', payload)); invalidate() }}
      onDelete={async (id) => { await api.delete(`/departments/${id}`); invalidate() }}
      deleteNote="Employees keep the department name as free text. Renaming a department updates every employee in it." />
  )
}

/* ------------------------------------------------------------------- import */

const IMPORT_FIELDS = ['name', 'business_units', 'department', 'country', 'email', 'title', 'phone', 'join_date'] as const
const IMPORT_LABEL: Record<(typeof IMPORT_FIELDS)[number], string> = {
  name: 'Name', business_units: 'Business unit', department: 'Department', country: 'Country', email: 'Email', title: 'Title', phone: 'Phone', join_date: 'Join date',
}
const TEMPLATE_HREF = 'data:text/csv;charset=utf-8,' + encodeURIComponent('Name,Business Unit,Department,Country,Email,Title\nExample Person,Javelin,Finance,Myanmar,example@example.com,Manager\n')

/** CSV / XLSX upload (click or drag and drop) with column matching. */
function ImportEmployeesDialog({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importMap, setImportMap] = useState<Record<string, string | null>>({})
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  const previewMutation = useMutation({
    mutationFn: async (arg: { file: File; mapping?: Record<string, string | null> }) => {
      const fd = new FormData()
      fd.append('file', arg.file)
      if (arg.mapping) fd.append('mapping', JSON.stringify(arg.mapping))
      return api.post('/employees/import-file?preview=true', fd)
    },
    onSuccess: (res) => { setImportPreview(res.data); setImportMap(res.data.mapping || {}); setImportError('') },
    onError: (err: any) => setImportError(apiMsg(err, 'Could not read that file')),
  })
  const importRun = useMutation({
    mutationFn: async () => {
      if (!importFile) throw new Error('no file')
      const fd = new FormData()
      fd.append('file', importFile)
      fd.append('mapping', JSON.stringify(importMap))
      return api.post('/employees/import-file', fd)
    },
    onSuccess: (res) => {
      onImported()
      const d = res.data as { created: number; updated: number; skipped: number; errors: string[]; total_rows?: number }
      setImportResult({ created: d.created, updated: d.updated, skipped: d.skipped, errors: d.errors || [], total_rows: d.total_rows ?? 0 })
      setImportError('')
    },
    onError: (err: any) => setImportError(apiMsg(err, 'Import failed')),
  })
  const pickFile = (f: File | null) => {
    setImportFile(f); setImportPreview(null); setImportResult(null); setImportError('')
    if (f) previewMutation.mutate({ file: f })
  }

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <Card className="max-h-[92vh] w-full max-w-lg overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Import employees</CardTitle>
            <button onClick={onClose} className="rounded p-1 text-gray-400 hover:bg-gray-100" aria-label="Close"><X className="h-4 w-4" /></button>
          </div>
          <ol className="mt-3 flex items-center gap-1.5 text-[11px]">
            {[{ n: 1, label: 'Upload file' }, { n: 2, label: 'Map & preview' }, { n: 3, label: 'Done' }].map((s, i) => {
              const state = importResult ? 3 : importPreview ? 2 : 1
              const active = s.n === state
              const complete = s.n < state
              return (
                <li key={s.n} className="flex flex-1 items-center last:flex-none">
                  <span className={cn('flex items-center gap-1.5 rounded-full px-2 py-1 font-medium', active ? 'bg-primary text-primary-foreground' : complete ? 'text-green-700' : 'text-gray-400')}>
                    {complete ? <Check className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                    <span className="hidden sm:inline">{s.label}</span>
                    <span className="sm:hidden">{s.n}</span>
                  </span>
                  {i < 2 && <span className={cn('mx-1 h-px flex-1', complete ? 'bg-green-300' : 'bg-gray-200')} />}
                </li>
              )
            })}
          </ol>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-gray-500">
            Drop a spreadsheet below or click to browse. Columns are matched automatically and you can adjust the mapping before
            importing. The file needs a <strong>Name</strong> column; <strong>Business Unit</strong>, <strong>Department</strong>,{' '}
            <strong>Country</strong>, <strong>Email</strong> and <strong>Title</strong> are optional. Existing names (case-insensitive) are
            updated, new ones created. New department names are added to the department list.
          </p>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs text-gray-400">.csv, .xlsx, .xlsm, max 5 MB</span>
            <a className="inline-flex items-center text-xs text-primary hover:underline" href={TEMPLATE_HREF} download="employees-import-template.csv">
              <Download className="mr-1 h-3.5 w-3.5" /> Download CSV template
            </a>
          </div>
          <div role="button" tabIndex={0} aria-label="Upload employee file"
            className={cn('block cursor-pointer rounded-xl border-2 border-dashed px-4 py-8 text-center transition-colors',
              dragOver ? 'scale-[1.01] border-primary bg-primary/10' : 'border-gray-300 hover:border-primary/40 hover:bg-primary/5')}
            onClick={() => document.getElementById('emp-import-file')?.click()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('emp-import-file')?.click() }}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) pickFile(f) }}>
            <input id="emp-import-file" type="file" accept=".csv,.xlsx,.xlsm" className="hidden" onChange={(e) => pickFile(e.target.files?.[0] || null)} />
            <div className={cn('mx-auto flex h-12 w-12 items-center justify-center rounded-full transition-colors', dragOver ? 'bg-primary/15' : 'bg-gray-100')}>
              <FileSpreadsheet className={cn('h-6 w-6', dragOver ? 'text-primary' : 'text-gray-400')} />
            </div>
            <span className="mt-3 block text-sm">
              {dragOver ? <strong className="text-primary">Drop to upload</strong> : importFile ? <strong>{importFile.name}</strong> : 'Drag a .csv / .xlsx here, or click to browse'}
            </span>
            {!importFile && <span className="mt-1 block text-xs text-gray-400">First row must contain column headers</span>}
          </div>

          {previewMutation.isPending && <p className="mt-3 text-sm text-gray-500">Reading file…</p>}
          {importError && <p className="mt-3 text-sm text-red-700">{importError}</p>}

          {importPreview && (
            <div className="mt-3 space-y-2 rounded-lg border bg-gray-50/60 p-3 text-sm">
              <p className="text-xs text-gray-500">{plural(importPreview.total_rows, 'data row')} detected. Adjust the column mapping if needed:</p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {IMPORT_FIELDS.map((field) => (
                  <label key={field} className="flex items-center gap-2 text-xs">
                    <span className="w-24 shrink-0 font-medium text-gray-600">{IMPORT_LABEL[field]}{field === 'name' && <span className="text-red-500"> *</span>}</span>
                    <Select className="h-8 min-w-0 flex-1 text-xs" value={importMap[field] ?? ''} onChange={(e) => setImportMap({ ...importMap, [field]: e.target.value || null })}>
                      <option value="">(not imported)</option>
                      {importPreview.columns.map((c, i) => <option key={`${c}-${i}`} value={c}>{c}</option>)}
                    </Select>
                  </label>
                ))}
              </div>
              {importPreview.preview_rows.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="border-b text-left text-gray-400">
                      <tr><th className="py-1 pr-2">Name</th><th className="py-1 pr-2">Business unit</th><th className="py-1 pr-2">Department</th><th className="py-1 pr-2">Country</th><th className="py-1">Email</th></tr>
                    </thead>
                    <tbody className="divide-y">
                      {importPreview.preview_rows.map((r, i) => (
                        <tr key={i}>
                          <td className="max-w-[140px] truncate py-1 pr-2">{r.name || <span className="text-red-500">(missing)</span>}</td>
                          <td className="py-1 pr-2">{(r.business_units || []).join(' / ') || '-'}</td>
                          <td className="py-1 pr-2">{r.department || '-'}</td>
                          <td className="py-1 pr-2">{r.country || '-'}</td>
                          <td className="max-w-[140px] truncate py-1">{r.email || '-'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {importResult && (
            <div className="mt-3 text-sm">
              <p className="text-green-700">Imported: {importResult.created} created, {importResult.updated} updated, {importResult.skipped} skipped (of {importResult.total_rows} rows).</p>
              {importResult.errors.length > 0 && <ul className="mt-1 list-inside list-disc text-xs text-gray-500">{importResult.errors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={onClose}>{importResult ? 'Close' : 'Cancel'}</Button>
            <Button onClick={() => importRun.mutate()} disabled={!importFile || previewMutation.isPending || importRun.isPending || !!importResult || !importMap.name}>
              {importRun.isPending ? 'Importing…' : importPreview ? `Import ${importPreview.total_rows} rows` : 'Import'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>,
    document.body,
  )
}
