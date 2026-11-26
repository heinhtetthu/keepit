import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/auth'
import { createPortal } from 'react-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Users, UserPlus, UserMinus, UserRound, Upload, X, Pencil, Building2, Trash2, Check, CircleDot, Download, FileSpreadsheet } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { TableCard, TableScrollArea, usePageSize, TH_STICKY, TablePager } from '../components/table_shell'
import { cn } from '@/lib/utils'
import type { Employee } from '../types'
import RowMenu from '@/components/ui/menu'
import OffboardDialog from '../components/OffboardDialog'
import EmployeeFormDialog from '../components/EmployeeFormDialog'
import { formatDate } from '@workspace/core'
import { Select } from '@/components/ui/select'

interface BusinessUnit {
  id: number
  name: string
  active: boolean
}

interface ImportPreview {
  columns: string[]
  mapping: { [field: string]: string | null }
  total_rows: number
  preview_rows: { name: string; business_units: string[]; email: string | null; title: string | null }[]
}

interface ImportResult {
  created: number
  updated: number
  skipped: number
  errors: string[]
  total_rows: number
}

export default function EmployeesPanel({ show = 'all' }: { show?: 'all' | 'employees' | 'units' }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [showInactive, setShowInactive] = useState(false)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Employee | null>(null)
  const [showImport, setShowImport] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null)
  const [importMap, setImportMap] = useState<Record<string, string | null>>({})
  const [importResult, setImportResult] = useState<ImportResult | null>(null)
  const [importError, setImportError] = useState('')
  const [dragOver, setDragOver] = useState(false)
  const [bulkMsg, setBulkMsg] = useState('')
  const [offboarding, setOffboarding] = useState<Employee | null>(null)
  const canManage = useAuthStore((st) => st.hasPermission('employee.manage'))
  const canRelease = useAuthStore((st) => st.hasPermission('record.edit'))

  const { data: employees, isLoading } = useQuery<Employee[]>({
    queryKey: ['employees', { include_inactive: showInactive }],
    queryFn: async () => (await api.get(`/employees?include_inactive=${showInactive}`)).data,
    retry: 1,
  })

  const { data: businessUnits } = useQuery<BusinessUnit[]>({
    queryKey: ['business-units', 'all'],
    queryFn: async () => (await api.get('/business-units?include_inactive=true')).data,
    retry: 1,
  })
  const [editingBu, setEditingBu] = useState<BusinessUnit | null>(null)
  const [newBu, setNewBu] = useState('')
  const [empSearch, setEmpSearch] = useState('')
  const [empPage, setEmpPage] = useState(1)
  const [empPageSize, setEmpPageSize] = usePageSize('employees')
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [bulkBu, setBulkBu] = useState('')

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['employees'] })
    queryClient.invalidateQueries({ queryKey: ['business-units'] })
  }

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => api.delete(`/employees/${id}`),
    onSuccess: () => {
      invalidate()
      setError('')
    },
    onError: (err: any) => setError(err.response?.data?.error?.message || 'Failed to delete employee'),
  })

  const saveBuMutation = useMutation({
    mutationFn: async (arg: { id: number | null; payload: Record<string, unknown> }) =>
      arg.id ? api.put(`/business-units/${arg.id}`, arg.payload) : api.post('/business-units', arg.payload),
    onSuccess: () => {
      invalidate()
      setEditingBu(null)
      setNewBu('')
      setError('')
    },
    onError: (err: any) => setError(err.response?.data?.error?.message || 'Failed to save business unit'),
  })

  const deleteBuMutation = useMutation({
    mutationFn: async (id: number) => api.delete(`/business-units/${id}`),
    onSuccess: () => {
      invalidate()
      setError('')
    },
    onError: (err: any) => setError(err.response?.data?.error?.message || 'Failed to delete business unit'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => api.delete('/employees/bulk', { data: { ids } }),
    onSuccess: (res) => {
      invalidate()
      setSelectedIds(new Set())
      setError('')
      const d = res.data as { deleted: number }
      setImportResult(null)
      setBulkMsg(`Deleted ${d.deleted} employee${d.deleted === 1 ? '' : 's'}.`)
    },
    onError: (err: any) => setError(err.response?.data?.error?.message || 'Bulk delete failed'),
  })

  const bulkUpdateMutation = useMutation({
    mutationFn: async (arg: { ids: number[]; business_units?: string[]; active?: boolean }) =>
      api.post('/employees/bulk', arg),
    onSuccess: (res) => {
      invalidate()
      setSelectedIds(new Set())
      setBulkBu('')
      setError('')
      const d = res.data as { updated: number }
      setBulkMsg(`Updated ${d.updated} employee${d.updated === 1 ? '' : 's'}.`)
    },
    onError: (err: any) => setError(err.response?.data?.error?.message || 'Bulk update failed'),
  })

  const previewMutation = useMutation({
    mutationFn: async (arg: { file: File; mapping?: Record<string, string | null> }) => {
      const fd = new FormData()
      fd.append('file', arg.file)
      if (arg.mapping) fd.append('mapping', JSON.stringify(arg.mapping))
      return api.post('/employees/import-file?preview=true', fd)
    },
    onSuccess: (res) => {
      setImportPreview(res.data)
      setImportMap(res.data.mapping || {})
      setImportError('')
    },
    onError: (err: any) => setImportError(err.response?.data?.error?.message || err.response?.data?.detail || 'Could not read that file'),
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
      invalidate()
      const d = res.data as { created: number; updated: number; skipped: number; errors: string[]; total_rows?: number }
      setImportResult({ created: d.created, updated: d.updated, skipped: d.skipped, errors: d.errors || [], total_rows: d.total_rows ?? 0 })
      setImportError('')
    },
    onError: (err: any) => setImportError(err.response?.data?.error?.message || err.response?.data?.detail || 'Import failed'),
  })


  /* client-side search + pagination for the employee table */
  const filteredEmployees = (employees || []).filter((e) =>
    !empSearch.trim() ||
    e.name.toLowerCase().includes(empSearch.trim().toLowerCase()) ||
    (e.email || '').toLowerCase().includes(empSearch.trim().toLowerCase()) ||
    (e.business_units || []).some((u) => u.toLowerCase().includes(empSearch.trim().toLowerCase())),
  )
  const empPages = Math.max(1, Math.ceil(filteredEmployees.length / empPageSize))
  const empCurPage = Math.min(empPage, empPages)
  const empPageRows = filteredEmployees.slice((empCurPage - 1) * empPageSize, empCurPage * empPageSize)
  const allPageSelected = empPageRows.length > 0 && empPageRows.every((e) => selectedIds.has(e.id))
  const toggleSelectAll = () => {
    if (allPageSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        empPageRows.forEach((e) => next.delete(e.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        empPageRows.forEach((e) => next.add(e.id))
        return next
      })
    }
  }
  const toggleSelect = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <div className="space-y-6">
      {/* Business units master list */}
      {show !== 'employees' && (<>
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Building2 className="h-4 w-4 text-gray-400" />
            Business units
          </CardTitle>
        </CardHeader>
        <CardContent>
          {error && <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm mb-3">{error}</div>}
          <div className="flex gap-2 mb-4">
            <Input
              className="max-w-xs"
              placeholder="New business unit name…"
              value={newBu}
              onChange={(e) => setNewBu(e.target.value)}
            />
            <Button
              size="sm"
              disabled={!newBu.trim() || saveBuMutation.isPending}
              onClick={() => saveBuMutation.mutate({ id: null, payload: { name: newBu.trim() } })}
            >
              Add unit
            </Button>
          </div>
          {!businessUnits || businessUnits.length === 0 ? (
            <p className="text-sm text-gray-400">No business units yet.</p>
          ) : (
            <div className="border rounded-md divide-y">
              {businessUnits.map((b) => (
                <div key={b.id} className="flex items-center justify-between px-3 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{b.name}</span>
                    {!b.active && <Badge variant="secondary">Inactive</Badge>}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      className="text-xs text-gray-500 hover:text-primary"
                      onClick={() => saveBuMutation.mutate({ id: b.id, payload: { active: !b.active } })}
                    >
                      {b.active ? 'Deactivate' : 'Activate'}
                    </button>
                    <button
                      className="p-1 rounded text-gray-300 hover:text-primary hover:bg-primary/5"
                      title={`Rename ${b.name}`}
                      aria-label={`Rename business unit ${b.name}`}
                      onClick={() => setEditingBu(b)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50"
                      title={`Delete ${b.name}`}
                      aria-label={`Delete business unit ${b.name}`}
                      onClick={() => {
                        if (confirm(`Delete business unit "${b.name}"?\n\nValues already stored on records keep the name as free text.`))
                          deleteBuMutation.mutate(b.id)
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      </>)}

      {/* Employees master list */}
      {show !== 'units' && (<>
      <TableCard
        className="max-h-[calc(100dvh-260px)] min-h-[280px]"
        header={
          <>
            {/* Row 1: title */}
            <div className="px-4 pt-3 pb-1 shrink-0">
              <CardTitle className="text-base flex items-center gap-2">
                <Users className="h-4 w-4 text-gray-400" />
                Employee list
              </CardTitle>
            </div>
            {/* Row 2: search + include-inactive + actions, right beneath the title */}
            <div className="flex flex-wrap items-center gap-2 px-3 pb-2.5 pt-1 shrink-0">
              <div className="relative w-52 sm:w-60">
                <Input
                  placeholder="Search employees…"
                  value={empSearch}
                  onChange={(e) => { setEmpSearch(e.target.value); setEmpPage(1) }}
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer whitespace-nowrap">
                <input type="checkbox" className="h-4 w-4" checked={showInactive} onChange={(e) => { setShowInactive(e.target.checked); setEmpPage(1) }} />
                Include resigned
              </label>
              {canManage && <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={() => { setImportFile(null); setImportPreview(null); setImportError(''); setShowImport(true) }}>
                  <Upload className="h-3.5 w-3.5 mr-1.5" /> Import
                </Button>
                <Button size="sm" onClick={() => setEditing({ id: 0, name: '', email: '', business_units: [], title: '', active: true, created_at: '', updated_at: '' })}>
                  <UserPlus className="h-3.5 w-3.5 mr-1.5" /> Add employee
                </Button>
              </div>}
            </div>
          </>
        }
        footer={<TablePager shown={empPageRows.length} total={filteredEmployees.length} noun={`employee${filteredEmployees.length === 1 ? '' : 's'}`} page={empCurPage} pages={empPages} onPage={setEmpPage} pageSize={empPageSize} onPageSize={(n) => { setEmpPageSize(n); setEmpPage(1) }} />}
      >
        <TableScrollArea className="flex-1 min-h-0">
          {isLoading ? (
            <p className="text-sm text-gray-500 px-3 py-4">Loading…</p>
          ) : !employees || employees.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <Users className="h-8 w-8 mx-auto text-gray-300" />
              <p className="text-sm text-gray-500 mt-2">No employees yet.</p>
              <p className="text-xs text-gray-400 mt-1">Use Import (CSV/XLSX) for your one-time batch, or add them one by one.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 border-b text-left">
                  <tr>
                    <th className={cn('w-9 px-2 py-2', TH_STICKY)}>
                      <input
                        type="checkbox"
                        className={cn('h-4 w-4 cursor-pointer accent-primary align-middle', !canManage && 'invisible')}
                        disabled={!canManage}
                        checked={allPageSelected}
                        ref={(el) => { if (el) el.indeterminate = !allPageSelected && empPageRows.some((e) => selectedIds.has(e.id)) }}
                        onChange={toggleSelectAll}
                        aria-label="Select all on this page"
                      />
                    </th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Name</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Title</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Business units</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Contact</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Joined</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Status</th>
                    <th className={cn('px-3 py-2 text-right', TH_STICKY)}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {empPageRows.map((e) => (
                    <tr key={e.id} className={cn('hover:bg-gray-50 transition-colors', selectedIds.has(e.id) && 'bg-primary/5')}>
                      <td className="px-2 py-2">
                        <input
                          type="checkbox"
                          className={cn('h-4 w-4 cursor-pointer accent-primary align-middle', !canManage && 'invisible')}
                          disabled={!canManage}
                          checked={selectedIds.has(e.id)}
                          onChange={() => toggleSelect(e.id)}
                          aria-label={`Select ${e.name}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="h-8 w-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                            {e.name.charAt(0).toUpperCase()}
                          </span>
                          <Link to={`/employees/${e.id}`} className="font-medium text-gray-800 truncate hover:underline">{e.name}</Link>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">{e.title || <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          {(e.business_units || []).length ? (
                            (e.business_units || []).map((u) => (
                              <span key={u} className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-600">{u}</span>
                            ))
                          ) : <span className="text-gray-300">-</span>}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {e.email ? <a href={`mailto:${e.email}`} className="block truncate hover:text-primary hover:underline">{e.email}</a> : null}
                        {e.phone ? <a href={`tel:${e.phone}`} className="block hover:text-primary hover:underline">{e.phone}</a> : null}
                        {!e.email && !e.phone && <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{e.join_date ? formatDate(e.join_date) : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Badge variant={e.active ? 'success' : 'secondary'}>{e.active ? 'Active' : 'Resigned'}</Badge>
                        {!e.active && e.resignation_date && <span className="mt-0.5 block text-[11px] text-gray-500">{formatDate(e.resignation_date)}</span>}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        <RowMenu label={`Actions for ${e.name}`} items={[
                          { label: 'Open profile', icon: <UserRound />, onSelect: () => navigate(`/employees/${e.id}`) },
                          { label: 'Edit', icon: <Pencil />, onSelect: () => setEditing(e), hidden: !canManage },
                          { label: 'Release seats…', icon: <UserMinus />, onSelect: () => setOffboarding(e), hidden: !canRelease },
                          { label: 'Delete', icon: <Trash2 />, danger: true, divider: true, hidden: !canManage, onSelect: () => {
                            if (confirm(`Delete employee "${e.name}"?\n\nAssignment history keeps the name.`)) deleteMutation.mutate(e.id)
                          } },
                        ]} />
                      </td>
                    </tr>
                  ))}
                  {empPageRows.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">No employees match your search.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </TableScrollArea>
      </TableCard>
      </>)}

        {/* Bulk actions - floating bar, always visible while rows are selected */}
        {selectedIds.size > 0 && (
          <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[80] flex flex-wrap items-center gap-2 rounded-xl border border-primary/30 bg-white/95 backdrop-blur px-3 py-2 shadow-xl max-w-[calc(100vw-2rem)]">
            <span className="text-sm font-semibold text-primary mr-1">{selectedIds.size} selected</span>
            <label className="flex items-center gap-1.5 text-xs text-gray-500">
              Set business unit:
              <Select
                className="h-8 rounded-md border border-input bg-white px-1.5 text-xs max-w-[140px]"
                value={bulkBu}
                onChange={(e) => setBulkBu(e.target.value)}
              >
                <option value="">Choose…</option>
                {(businessUnits || []).map((b) => <option key={b.id} value={b.name}>{b.name}</option>)}
              </Select>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={!bulkBu || bulkUpdateMutation.isPending}
              onClick={() => bulkUpdateMutation.mutate({ ids: [...selectedIds], business_units: [bulkBu] })}
            >
              Apply BU
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkUpdateMutation.isPending}
              onClick={() => bulkUpdateMutation.mutate({ ids: [...selectedIds], active: true })}
            >
              Activate
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkUpdateMutation.isPending}
              onClick={() => bulkUpdateMutation.mutate({ ids: [...selectedIds], active: false })}
            >
              Deactivate
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="text-red-600 hover:bg-red-50"
              disabled={bulkDeleteMutation.isPending}
              onClick={() => {
                if (confirm(`Delete ${selectedIds.size} selected employee${selectedIds.size === 1 ? '' : 's'}?\n\nExisting assignment history keeps the name snapshots.`)) {
                  bulkDeleteMutation.mutate([...selectedIds])
                }
              }}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              {bulkDeleteMutation.isPending ? 'Deleting…' : 'Delete selected'}
            </Button>
            <button className="text-xs text-gray-400 hover:text-gray-600 px-1" onClick={() => setSelectedIds(new Set())}>
              Clear
            </button>
          </div>
        )}

        {/* Transient confirmation after a bulk action */}
        {bulkMsg && (
          <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[80] flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700 shadow-lg">
            <Check className="h-4 w-4" />
            {bulkMsg}
            <button className="text-xs text-green-600 hover:underline ml-1" onClick={() => setBulkMsg('')}>Dismiss</button>
          </div>
        )}

      {/* Add / edit employee */}
      {editing && <EmployeeFormDialog employee={editing.id ? editing : undefined} onClose={() => setEditing(null)} onSaved={invalidate} />}

      {/* Import modal - CSV / XLSX upload (click or drag & drop) + column matching */}
      {showImport && createPortal(
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4" onClick={() => setShowImport(false)}>
          <Card className="w-full max-w-lg max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Import employees</CardTitle>
                <button onClick={() => setShowImport(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="Close">
                  <X className="h-4 w-4" />
                </button>
              </div>
              {/* Step indicator */}
              <ol className="mt-3 flex items-center gap-1.5 text-[11px]">
                {[
                  { n: 1, label: 'Upload file' },
                  { n: 2, label: 'Map & preview' },
                  { n: 3, label: 'Done' },
                ].map((s, i) => {
                  const state = importResult ? 3 : importPreview ? 2 : 1
                  const active = s.n === state
                  const complete = s.n < state
                  return (
                    <li key={s.n} className="flex items-center flex-1 last:flex-none">
                      <span className={cn(
                        'flex items-center gap-1.5 rounded-full px-2 py-1 font-medium',
                        active ? 'bg-primary text-primary-foreground' : complete ? 'text-green-700' : 'text-gray-400',
                      )}>
                        {complete ? <Check className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                        <span className="hidden sm:inline">{s.label}</span>
                        <span className="sm:hidden">{s.n}</span>
                      </span>
                      {i < 2 && <span className={cn('h-px flex-1 mx-1', complete ? 'bg-green-300' : 'bg-gray-200')} />}
                    </li>
                  )
                })}
              </ol>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-gray-500 mb-3">
                Drop a spreadsheet below or click to browse. Columns are matched automatically and you can
                adjust the mapping before importing - the file needs a <strong>Name</strong> column;
                <strong> Business Unit</strong>, <strong>Email</strong> and <strong>Title</strong> are optional.
                Existing names (case-insensitive) are updated, new ones created.
              </p>

              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400">.csv, .xlsx, .xlsm - max 5 MB</span>
                <a
                  className="inline-flex items-center text-xs text-primary hover:underline"
                  href="data:text/csv;charset=utf-8,Name,Business Unit,Email,Title%0AExample Person,Javelin,example@example.com,Manager%0A"
                  download="employees-import-template.csv"
                >
                  <Download className="h-3.5 w-3.5 mr-1" /> Download CSV template
                </a>
              </div>

              <div
                role="button"
                tabIndex={0}
                aria-label="Upload employee file"
                className={cn(
                  'block border-2 border-dashed rounded-xl px-4 py-8 text-center cursor-pointer transition-colors',
                  dragOver ? 'border-primary bg-primary/10 scale-[1.01]' : 'border-gray-300 hover:border-primary/40 hover:bg-primary/5',
                )}
                onClick={() => document.getElementById('emp-import-file')?.click()}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') document.getElementById('emp-import-file')?.click() }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setDragOver(false)
                  const f = e.dataTransfer.files?.[0] || null
                  if (!f) return
                  setImportFile(f)
                  setImportPreview(null)
                  setImportResult(null)
                  setImportError('')
                  previewMutation.mutate({ file: f })
                }}
              >
                <input
                  id="emp-import-file"
                  type="file"
                  accept=".csv,.xlsx,.xlsm"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] || null
                    setImportFile(f)
                    setImportPreview(null)
                    setImportResult(null)
                    setImportError('')
                    if (f) previewMutation.mutate({ file: f })
                  }}
                />
                <div className={cn('h-12 w-12 mx-auto rounded-full flex items-center justify-center transition-colors', dragOver ? 'bg-primary/15' : 'bg-gray-100')}>
                  <FileSpreadsheet className={cn('h-6 w-6', dragOver ? 'text-primary' : 'text-gray-400')} />
                </div>
                <span className="block text-sm mt-3">
                  {dragOver ? <strong className="text-primary">Drop to upload</strong> : importFile ? <strong>{importFile.name}</strong> : 'Drag a .csv / .xlsx here, or click to browse'}
                </span>
                {!importFile && <span className="block text-xs text-gray-400 mt-1">First row must contain column headers</span>}
              </div>

              {previewMutation.isPending && <p className="text-sm text-gray-500 mt-3">Reading file…</p>}
              {importError && <p className="text-sm text-red-700 mt-3">{importError}</p>}

              {importPreview && (
                <div className="mt-3 border rounded-lg p-3 bg-gray-50/60 text-sm space-y-2">
                  <p className="text-xs text-gray-500">
                    {importPreview.total_rows} data row{importPreview.total_rows === 1 ? '' : 's'} detected.
                    Adjust the column mapping if needed:
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {(['name', 'business_units', 'email', 'title'] as const).map((field) => (
                      <label key={field} className="flex items-center gap-2 text-xs">
                        <span className="w-24 shrink-0 font-medium text-gray-600">
                          {field === 'business_units' ? 'Business unit' : field.charAt(0).toUpperCase() + field.slice(1)}
                          {field === 'name' && <span className="text-red-500"> *</span>}
                        </span>
                        <Select
                          className="flex-1 h-8 rounded-md border border-input bg-white px-1.5 text-xs min-w-0"
                          value={importMap[field] ?? ''}
                          onChange={(e) => setImportMap({ ...importMap, [field]: e.target.value || null })}
                        >
                          <option value="">(not imported)</option>
                          {importPreview.columns.map((c, i) => (
                            <option key={`${c}-${i}`} value={c}>{c}</option>
                          ))}
                        </Select>
                      </label>
                    ))}
                  </div>
                  {importPreview.preview_rows.length > 0 && (
                    <table className="w-full text-xs">
                      <thead className="text-gray-400 border-b text-left">
                        <tr>
                          <th className="py-1 pr-2">Name</th>
                          <th className="py-1 pr-2">Business unit</th>
                          <th className="py-1 pr-2">Email</th>
                          <th className="py-1">Title</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {importPreview.preview_rows.map((r, i) => (
                          <tr key={i}>
                            <td className="py-1 pr-2 truncate max-w-[140px]">{r.name || <span className="text-red-500">(missing)</span>}</td>
                            <td className="py-1 pr-2">{(r.business_units || []).join(' / ') || '-'}</td>
                            <td className="py-1 pr-2 truncate max-w-[140px]">{r.email || '-'}</td>
                            <td className="py-1">{r.title || '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {importResult && (
                <div className="mt-3 text-sm">
                  <p className="text-green-700">
                    Imported: {importResult.created} created · {importResult.updated} updated · {importResult.skipped} skipped (of {importResult.total_rows} rows).
                  </p>
                  {importResult.errors.length > 0 && (
                    <ul className="mt-1 text-xs text-gray-500 list-disc list-inside">
                      {importResult.errors.map((e, i) => <li key={i}>{e}</li>)}
                    </ul>
                  )}
                </div>
              )}

              <div className="flex justify-end gap-2 mt-4">
                <Button variant="outline" onClick={() => setShowImport(false)}>Cancel</Button>
                <Button
                  onClick={() => importRun.mutate()}
                  disabled={!importFile || previewMutation.isPending || importRun.isPending || !!importResult || !importMap.name}
                >
                  {importRun.isPending ? 'Importing…' : importPreview ? `Import ${importPreview.total_rows} rows` : 'Import'}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body,
      )}

      {/* Rename business unit */}
      {editingBu && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditingBu(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">Rename business unit</CardTitle>
            </CardHeader>
            <CardContent>
              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  if (!editingBu.name.trim()) return
                  saveBuMutation.mutate({ id: editingBu.id, payload: { name: editingBu.name.trim() } })
                }}
                className="space-y-4"
              >
                <div className="space-y-1">
                  <label className="text-sm font-medium">Name</label>
                  <Input value={editingBu.name} onChange={(e) => setEditingBu({ ...editingBu, name: e.target.value })} autoFocus />
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="outline" onClick={() => setEditingBu(null)}>Cancel</Button>
                  <Button type="submit" disabled={saveBuMutation.isPending}>Save</Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
      {offboarding && <OffboardDialog employee={offboarding} onClose={() => setOffboarding(null)} />}
    </div>
  )
}
