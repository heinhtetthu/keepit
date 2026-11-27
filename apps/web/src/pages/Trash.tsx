import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { RotateCcw, Trash2 } from 'lucide-react'
import api from '@/lib/api'
import { errorMessage } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Modal from '@/components/ui/modal'
import RowMenu from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, TitleCell, clientRows, filterField, filterRows, useTableState,
  type Column, type SortDef,
} from '@/components/data-table'
import { useAuthStore } from '../store/auth'

interface TrashItem { id: number; name: string; type: string; deleted_at: string; purge_eligible_at: string }
interface TrashPage { items: TrashItem[]; total: number; retention_days: number; policy: string }

/* The endpoint only pages, so trash loads whole (up to MAX rows) and is
   searched, filtered, sorted and paged in the browser. */
const MAX_PAGES = 20
const NONE: TrashItem[] = []
async function fetchAll(): Promise<TrashPage> {
  let first: TrashPage | null = null
  const items: TrashItem[] = []
  for (let page = 1; page <= MAX_PAGES; page++) {
    const data: TrashPage = (await api.get('/records/trash', { params: { page, page_size: 100 } })).data
    first ??= data
    items.push(...data.items)
    if (items.length >= data.total || data.items.length === 0) break
  }
  return { ...(first as TrashPage), items }
}

const eligible = (r: TrashItem) => new Date(r.purge_eligible_at).getTime() <= Date.now()
const get = (r: TrashItem, slug: string): unknown => (slug === 'eligible' ? eligible(r) : (r as unknown as Record<string, unknown>)[slug])

const COLUMNS: Column<TrashItem>[] = [
  { id: 'name', label: 'Record', sort: 'name', locked: true, render: (r) => <TitleCell title={r.name} sub={r.type} /> },
  { id: 'type', label: 'Type', sort: 'type', render: (r) => r.type },
  { id: 'deleted_at', label: 'Deleted', sort: 'deleted_at', render: (r) => <span className="tabular-nums">{new Date(r.deleted_at).toLocaleString()}</span> },
  { id: 'purge_eligible_at', label: 'Can be purged from', sort: 'purge_eligible_at', render: (r) => (
    <span className={eligible(r) ? 'tabular-nums font-medium text-amber-700' : 'tabular-nums text-gray-500'}>{new Date(r.purge_eligible_at).toLocaleDateString()}</span>) },
]
const SORTS: SortDef[] = [
  { id: 'deleted_at', label: 'Deleted', kind: 'date' }, { id: 'name', label: 'Record' }, { id: 'type', label: 'Type' },
  { id: 'purge_eligible_at', label: 'Can be purged from', kind: 'date' },
]
type Tab = 'all' | 'eligible'

export default function Trash() {
  const user = useAuthStore((s) => s.user)
  const can = useAuthStore((s) => s.hasPermission)
  const client = useQueryClient()
  const t = useTableState({ key: 'trash', defaultSort: 'deleted_at', defaultOrder: 'desc', defaultColumns: ['type', 'deleted_at', 'purge_eligible_at'] })
  const [purging, setPurging] = useState<TrashItem | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState('')

  const { data, isLoading, isFetching, error } = useQuery<TrashPage>({ queryKey: ['trash', user?.id, 'all'], queryFn: fetchAll })
  const restore = useMutation({
    mutationFn: (id: number) => api.post(`/records/${id}/restore`),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['trash'] }); client.invalidateQueries({ queryKey: ['records'] }); client.invalidateQueries({ queryKey: ['dashboard'] }); toast.success('Record restored') },
    onError: () => toast.error('Could not restore this record. Check permissions and retry.'),
  })
  const closePurge = () => { setPurging(null); setPassword(''); setCode(''); setConfirmation('') }
  const purge = useMutation({
    mutationFn: () => api.post(`/records/${purging!.id}/purge`, { password, code }),
    onSuccess: () => { closePurge(); client.invalidateQueries({ queryKey: ['trash'] }); toast.success('Record permanently deleted') },
    onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Purge failed. A recent verified backup and password verification are required.'),
  })

  const all = data?.items ?? NONE
  const fields = useMemo(() => [
    filterField('type', 'Type', 'select', [...new Set(all.map((r) => r.type))].sort()),
    filterField('deleted_at', 'Deleted', 'date'),
    filterField('eligible', 'Past the recovery window', 'boolean'),
  ], [all])
  const tabs = useMemo(() => {
    const base = filterRows(all, t.filters, fields, get)
    return [{ id: 'all', label: 'All', count: base.length }, { id: 'eligible', label: 'Past recovery window', count: base.filter(eligible).length, tone: 'text-amber-700' }]
  }, [all, t.filters, fields])
  const tab = (t.tab === 'eligible' ? 'eligible' : 'all') as Tab
  const view = clientRows(tab === 'eligible' ? all.filter(eligible) : all, t, fields, get, (r) => `${r.name} ${r.type}`)
  const canRestore = can('record.delete')

  const rowMenu = (r: TrashItem) => (
    <RowMenu items={[
      { label: 'Restore', icon: <RotateCcw />, onSelect: () => restore.mutate(r.id), hidden: !canRestore },
      { label: 'Delete permanently…', icon: <Trash2 />, danger: true, divider: true, hidden: !user?.is_superuser || !eligible(r), onSelect: () => { closePurge(); setPurging(r) } },
    ]} />
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold">Trash</h2>
        <p className="mt-1 text-sm text-gray-500">Deleted records stay recoverable here. Archived records remain in Records, under Include archived.</p>
      </div>
      {data && <p className="shrink-0 rounded-lg border bg-sky-50 px-3 py-2 text-sm text-gray-700">Minimum recovery window: {data.retention_days} days. {data.policy}</p>}

      <TableTabs tabs={tabs} value={tab} onChange={t.setTab} />

      <TableToolbar state={t} searchPlaceholder="Record or type…" filterFields={fields} sorts={SORTS} columns={COLUMNS} />

      <DataTable rows={view.rows} rowKey={(r) => r.id} columns={COLUMNS} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading} fetching={isFetching && !isLoading} error={error ? `Trash could not load. ${errorMessage(error)}` : null}
        actions={canRestore || user?.is_superuser ? rowMenu : undefined}
        empty={<EmptyRows icon={<Trash2 className="h-9 w-9" />} title={all.length ? 'Nothing matches' : 'Trash is empty'} hint={all.length ? 'Try another tab or clear the filters.' : undefined} />}
        pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'records' }} />

      {purging && (
        <Modal title="Delete permanently" subtitle={`${purging.name} (${purging.type})`} onClose={closePurge} footer={<>
          <Button variant="outline" onClick={closePurge}>Cancel</Button>
          <Button variant="destructive" disabled={confirmation !== purging.name || !password || purge.isPending} onClick={() => purge.mutate()}>
            {purge.isPending ? 'Deleting…' : 'Permanently delete'}</Button>
        </>}>
          <div className="space-y-3 text-sm">
            <p className="text-gray-600">Purging removes the record's values, renewal and assignment history. Audit entries remain. A restore-verified backup from the last two days is required. This cannot be undone.</p>
            <p>Type <strong>{purging.name}</strong> to confirm.</p>
            <Input aria-label="Record name confirmation" value={confirmation} onChange={(e) => setConfirmation(e.target.value)} />
            <Input type="password" autoComplete="current-password" aria-label="Purge password" placeholder="Current password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Input autoComplete="one-time-code" aria-label="Purge authenticator code" placeholder="Authenticator code, if enabled" value={code} onChange={(e) => setCode(e.target.value)} />
          </div>
        </Modal>
      )}
    </div>
  )
}
