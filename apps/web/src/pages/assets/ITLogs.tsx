import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Plus, Search } from 'lucide-react'
import { errorMessage, formatDate, formatMoney, useAssetMutation, useBorrows, useMaintenanceLog, useRepairLog } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import RowMenu from '@/components/ui/menu'
import { toast } from '@/components/ui/toaster'
import { MiniPager, TableCard, TableFooterInfo, TableScrollArea, TH_STICKY } from '@/components/table_shell'
import { BorrowDialog } from '@/components/assets/ActionDialogs'
import { EmptyState, Tabs, useCan, useConfirm } from '@/components/assets/shared'

type Tab = 'borrows' | 'repairs' | 'maintenance'
const th = `${TH_STICKY} px-3 py-2 text-left text-xs font-medium text-gray-500`

export default function ITLogs() {
  const [sp, setSp] = useSearchParams()
  const tab = (sp.get('tab') as Tab) || 'borrows'
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const set = (t: Tab) => { setSp({ tab: t }, { replace: true }); setPage(1) }
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">IT Logs</h1>
        <p className="text-sm text-gray-500">Borrowed items, repairs and maintenance across every asset.</p>
      </div>
      <Tabs value={tab} onChange={set} tabs={[{ key: 'borrows', label: 'Borrows' }, { key: 'repairs', label: 'Repairs' }, { key: 'maintenance', label: 'Maintenance' }]} />
      <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1) }}>
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <Input className="pl-8" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { setSearch(q.trim()); setPage(1) }} />
      </form>
      {tab === 'borrows' && <Borrows q={search} page={page} setPage={setPage} />}
      {tab === 'repairs' && <Repairs q={search} page={page} setPage={setPage} />}
      {tab === 'maintenance' && <MaintenanceLog q={search} page={page} setPage={setPage} />}
    </div>
  )
}

function Borrows({ q, page, setPage }: { q: string; page: number; setPage: (n: number) => void }) {
  const can = useCan()
  const [status, setStatus] = useState<'open' | 'overdue' | 'returned' | ''>('open')
  const [adding, setAdding] = useState(false)
  const { data, isLoading } = useBorrows({ q: q || undefined, status: status || undefined, page, page_size: 50 })
  const ret = useAssetMutation((a, id: number) => a.borrows.return(id))
  const del = useAssetMutation((a, id: number) => a.borrows.remove(id))
  const { confirm, dialog } = useConfirm()
  const items = data?.items ?? []
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        {(['open', 'overdue', 'returned', ''] as const).map((s) => (
          <Button key={s || 'all'} size="sm" variant={status === s ? 'default' : 'outline'} onClick={() => { setStatus(s); setPage(1) }}>{s ? s[0].toUpperCase() + s.slice(1) : 'All'}</Button>
        ))}
        {can('itlog.manage') && <Button size="sm" className="ml-auto" onClick={() => setAdding(true)}><Plus className="mr-1.5 h-4 w-4" />Lend item</Button>}
      </div>
      <TableCard footer={<div className="flex items-center"><TableFooterInfo shown={items.length} total={data?.total ?? 0} noun="entries" /><div className="ml-auto"><MiniPager page={page} pages={data?.total_pages ?? 1} onPage={setPage} /></div></div>}>
        <TableScrollArea>
          {isLoading ? <p className="p-6 text-center text-sm text-gray-400">Loading…</p> : !items.length ? <EmptyState title="Nothing here" /> : (
            <table className="w-full text-sm"><thead><tr><th className={th}>Item</th><th className={th}>Borrower</th><th className={th}>Borrowed</th><th className={th}>Due</th><th className={th}>Returned</th><th className={th} /></tr></thead>
              <tbody className="divide-y">{items.map((b) => (
                <tr key={b.id} className={b.overdue ? 'bg-red-50/40' : ''}>
                  <td className="px-3 py-2">{b.asset_id ? <Link className="font-medium hover:underline" to={`/assets/${b.asset_id}`}>{b.item_name}</Link> : <span className="font-medium">{b.item_name}</span>}{b.serial_number && <div className="text-xs text-gray-500">{b.serial_number}</div>}</td>
                  <td className="px-3 py-2">{b.employee_id ? <Link className="hover:underline" to={`/employees/${b.employee_id}`}>{b.borrower_name}</Link> : b.borrower_name}</td>
                  <td className="px-3 py-2 text-gray-600">{formatDate(b.borrowed_date)}</td>
                  <td className={`px-3 py-2 ${b.overdue ? 'font-medium text-red-700' : 'text-gray-600'}`}>{formatDate(b.expected_return_date)}{b.overdue && ' · overdue'}</td>
                  <td className="px-3 py-2 text-gray-600">{formatDate(b.returned_date)}</td>
                  <td className="px-3 py-2 text-right">{can('itlog.manage') && <RowMenu items={[
                    { label: 'Mark returned today', hidden: !!b.returned_date, onSelect: () => ret.mutate(b.id, { onSuccess: () => toast.success('Returned'), onError: (e) => toast.error(errorMessage(e)) }) },
                    { label: 'Delete', danger: true, onSelect: () => confirm('Delete borrow entry', 'Delete this entry? It can be restored from the activity log.', () => del.mutateAsync(b.id), 'Delete') },
                  ]} />}</td>
                </tr>
              ))}</tbody></table>
          )}
        </TableScrollArea>
      </TableCard>
      {adding && <BorrowDialog onClose={() => setAdding(false)} />}
      {dialog}
    </>
  )
}

function Repairs({ q, page, setPage }: { q: string; page: number; setPage: (n: number) => void }) {
  const { data, isLoading } = useRepairLog({ q: q || undefined, page, page_size: 50 })
  const items = data?.items ?? []
  return (
    <TableCard footer={<div className="flex items-center"><TableFooterInfo shown={items.length} total={data?.total ?? 0} noun="repairs" /><div className="ml-auto"><MiniPager page={page} pages={data?.total_pages ?? 1} onPage={setPage} /></div></div>}>
      <TableScrollArea>
        {isLoading ? <p className="p-6 text-center text-sm text-gray-400">Loading…</p> : !items.length ? <EmptyState title="No repairs logged" /> : (
          <table className="w-full text-sm"><thead><tr><th className={th}>Date</th><th className={th}>Asset</th><th className={th}>Issue</th><th className={th}>Vendor</th><th className={th}>Cost</th><th className={th}>Status</th></tr></thead>
            <tbody className="divide-y">{items.map((r) => (
              <tr key={r.id}><td className="px-3 py-2 text-gray-600">{formatDate(r.repair_date)}</td><td className="px-3 py-2"><Link className="hover:underline" to={`/assets/${r.asset_id}`}>{r.asset_name}</Link></td>
                <td className="px-3 py-2">{r.issue}</td><td className="px-3 py-2 text-gray-600">{r.vendor || '—'}</td><td className="px-3 py-2 text-gray-600">{formatMoney(r.cost, r.currency)}</td><td className="px-3 py-2">{r.status}</td></tr>
            ))}</tbody></table>
        )}
      </TableScrollArea>
    </TableCard>
  )
}

function MaintenanceLog({ q, page, setPage }: { q: string; page: number; setPage: (n: number) => void }) {
  const { data, isLoading } = useMaintenanceLog({ q: q || undefined, page, page_size: 50 })
  const items = data?.items ?? []
  return (
    <TableCard footer={<div className="flex items-center"><TableFooterInfo shown={items.length} total={data?.total ?? 0} noun="entries" /><div className="ml-auto"><MiniPager page={page} pages={data?.total_pages ?? 1} onPage={setPage} /></div></div>}>
      <TableScrollArea>
        {isLoading ? <p className="p-6 text-center text-sm text-gray-400">Loading…</p> : !items.length ? <EmptyState title="No maintenance logged" /> : (
          <table className="w-full text-sm"><thead><tr><th className={th}>Date</th><th className={th}>Asset</th><th className={th}>Body</th><th className={th}>OS</th><th className={th}>Issues found</th></tr></thead>
            <tbody className="divide-y">{items.map((m) => (
              <tr key={m.id}><td className="px-3 py-2 text-gray-600">{formatDate(m.maintenance_date)}</td><td className="px-3 py-2"><Link className="hover:underline" to={`/assets/${m.asset_id}`}>{m.asset_name}</Link></td>
                <td className="px-3 py-2">{m.body_condition}</td><td className="px-3 py-2 text-gray-600">{m.operating_system || '—'}</td>
                <td className="px-3 py-2 text-gray-600">{(m.components ?? []).filter((c) => !['Good', 'Done', 'Not Applicable'].includes(c.status)).map((c) => `${c.component}: ${c.status}`).join(', ') || 'None'}</td></tr>
            ))}</tbody></table>
        )}
      </TableScrollArea>
    </TableCard>
  )
}
