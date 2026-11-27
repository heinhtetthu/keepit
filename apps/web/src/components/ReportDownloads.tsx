import { useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, FileDown } from 'lucide-react'
import api from '@/lib/api'
import { useAuthStore } from '../store/auth'
import { Button } from './ui/button'
import { DataTable, EmptyRows, TableToolbar, clientRows, filterField, type Column, type SortDef, useTableState } from '@/components/data-table'
import { cn } from '@/lib/utils'

export async function downloadReportJob(id: string, kind: string) {
  const response = await api.get(`/reports/jobs/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url; link.download = `report_${id}.${kind === 'excel' ? 'xlsx' : kind === 'pdf' ? 'pdf' : 'csv'}`
  link.click(); URL.revokeObjectURL(url)
}

/** Save rows the user is looking at as CSV (formula-looking text is neutralised for spreadsheets). */
export function downloadCsv(name: string, header: string[], rows: (string | number | null | undefined)[][]) {
  const esc = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v)
    if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const text = '﻿' + [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n'
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' })), download: `${name}-${new Date().toISOString().slice(0, 10)}.csv` })
  a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
}

interface Job { id: string; kind: string; status: string; created_at: string; error?: string | null }
const KIND_LABEL: Record<string, string> = { excel: 'Excel', pdf: 'PDF', allocation: 'Allocation', csv: 'CSV' }
const STATUS_TONE: Record<string, string> = {
  ready: 'bg-green-50 text-green-700', failed: 'bg-red-50 text-red-700', pending: 'bg-amber-50 text-amber-700', processing: 'bg-blue-50 text-blue-700',
}
const SORTS: SortDef[] = [{ id: 'created_at', label: 'Created', kind: 'date' }, { id: 'kind', label: 'Type' }, { id: 'status', label: 'Status' }]

export default function ReportDownloads({ onOpenAllocation, picker }: { onOpenAllocation?: (id: string) => void; picker?: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const can = useAuthStore((s) => s.hasPermission)
  const [error, setError] = useState('')
  const t = useTableState({ key: 'rpt-downloads', defaultSort: 'created_at', defaultOrder: 'desc', defaultColumns: ['status', 'created_at'] })
  const { data = [], isLoading } = useQuery<Job[]>({
    queryKey: ['export-jobs', user?.id], queryFn: async () => (await api.get('/reports/jobs')).data,
    refetchInterval: (query) => query.state.data?.some((j) => ['pending', 'processing'].includes(j.status)) ? 2500 : 15000,
  })
  const fields = useMemo(() => [
    filterField('kind', 'Type', 'select', [...new Set(data.map((j) => j.kind))].map((k) => ({ value: k, label: KIND_LABEL[k] ?? k }))),
    filterField('status', 'Status', 'select', [...new Set(data.map((j) => j.status))]),
    filterField('created_at', 'Created', 'date'),
  ], [data])
  const columns = useMemo<Column<Job>[]>(() => [
    { id: 'kind', label: 'Report', sort: 'kind', locked: true, render: (j) => (
      <span className="inline-flex items-center gap-2 font-medium text-gray-900"><FileDown className="h-4 w-4 text-gray-400" />{KIND_LABEL[j.kind] ?? j.kind}</span>) },
    { id: 'status', label: 'Status', sort: 'status', render: (j) => (
      <span className="inline-flex items-center gap-2">
        <span className={cn('inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium capitalize', STATUS_TONE[j.status] ?? 'bg-gray-100 text-gray-600')}>{j.status}</span>
        {j.error && <span className="max-w-[20rem] truncate text-xs text-red-700" title={j.error}>{j.error}</span>}
      </span>) },
    { id: 'created_at', label: 'Created', sort: 'created_at', render: (j) => <span className="tabular-nums">{new Date(j.created_at).toLocaleString()}</span> },
  ], [])
  const view = clientRows(data, { search: t.search, filters: t.filters, sort: t.sort, order: t.order, page: t.page, pageSize: t.pageSize },
    fields, (j, k) => (j as unknown as Record<string, unknown>)[k], (j) => `${KIND_LABEL[j.kind] ?? j.kind} ${j.status} ${j.error ?? ''}`)
  const filtered = !!t.search || Object.keys(t.filters).length > 0

  return (
    <>
      {picker && <div className="flex shrink-0 flex-wrap items-center gap-2">{picker}</div>}
      <p className="shrink-0 text-sm text-gray-500">Reports run in the worker so you can keep using the app. Encrypted files expire after 24 hours, and access is checked again before viewing or downloading.</p>
      {error && <p role="alert" className="shrink-0 rounded-md bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      <TableToolbar state={t} searchPlaceholder="Search downloads…" filterFields={fields} sorts={SORTS} columns={columns} />
      <DataTable rows={view.rows} rowKey={(j) => j.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort} loading={isLoading}
        actions={(j) => j.status === 'ready' && (
          <div className="flex justify-end gap-1.5">
            {j.kind === 'allocation' && onOpenAllocation && <Button size="sm" variant="outline" onClick={() => onOpenAllocation(j.id)}>View</Button>}
            {can('report.export') && <Button size="sm" variant="outline" aria-label="Download" onClick={() => downloadReportJob(j.id, j.kind).catch(() => setError('Report download failed or access changed. Regenerate the report and try again.'))}>
              <Download className="h-3.5 w-3.5" /></Button>}
          </div>
        )}
        empty={<EmptyRows icon={<FileDown className="h-9 w-9" />} title={filtered ? 'No downloads match' : 'No recent reports'} hint={filtered ? 'Clear the search or filters.' : 'Exports and allocation reports you generate appear here.'} />}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'reports' }} />
    </>
  )
}
