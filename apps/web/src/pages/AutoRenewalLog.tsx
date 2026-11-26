import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TableCard, TableScrollArea, TH_STICKY, TablePager } from '../components/table_shell'
import { useAuthStore } from '../store/auth'

interface RenewalEntry {
  id: number
  record_id: number
  record_name: string
  record_type: string
  record_type_slug: string
  can_open: boolean
  created_at: string
  renewed_on: string | null
  old_date: string | null
  new_date: string
}

const calendarDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' })
const formatDate = (value: string | null) => value ? calendarDate.format(new Date(value)) : '—'
const columns = ['Logged at', 'Record', 'Record type', 'Previous expiry', 'New expiry']

export default function AutoRenewalLog() {
  const userId = useAuthStore(s => s.user?.id)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  const { data, isLoading, isError, refetch } = useQuery<{
    items: RenewalEntry[]
    total: number
    total_pages: number
  }>({
    queryKey: ['automatic-renewals', userId, page, search],
    queryFn: async () => (await api.get('/records/auto-renewals', { params: { page, search } })).data,
  })

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <header className="shrink-0">
        <h2 className="text-lg font-semibold">Auto-renewal Log</h2>
        <p className="text-sm text-gray-500 mt-1">Review automatic renewals across your record types, newest first.</p>
      </header>
      <TableCard
        className="flex-1 min-h-0"
        header={
          <form className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b"
            onSubmit={e => { e.preventDefault(); setSearch(draft.trim()); setPage(1) }}>
            <Input type="search" aria-label="Search by record name or type" placeholder="Search record or type"
              value={draft} onChange={e => setDraft(e.target.value)} maxLength={200} className="w-56 sm:w-72" />
            <Button variant="outline" size="sm" type="submit">Search</Button>
            {search && <Button variant="ghost" size="sm" type="button"
              onClick={() => { setDraft(''); setSearch(''); setPage(1) }}>Clear</Button>}
          </form>
        }
        footer={<TablePager shown={data?.items.length ?? 0} total={data?.total ?? 0} noun="renewals" page={page} pages={data?.total_pages ?? page} onPage={setPage} />}
      >
        <TableScrollArea className="flex-1">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-gray-500">
              <tr>{columns.map(column => <th key={column} scope="col" className={`px-3 py-2 whitespace-nowrap ${TH_STICKY}`}>{column}</th>)}</tr>
            </thead>
            <tbody className="divide-y">
              {isLoading && <tr><td colSpan={columns.length} className="p-8 text-center text-gray-500">Loading renewals…</td></tr>}
              {isError && <tr><td colSpan={columns.length} className="p-8 text-center">
                <p role="alert" className="text-red-700">Could not load the auto-renewal log.</p>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => refetch()}>Retry</Button>
              </td></tr>}
              {data?.items.length === 0 && <tr><td colSpan={columns.length} className="p-8 text-center text-gray-500">
                {search ? 'No automatic renewals match your search.' : 'No automatic renewals have been logged yet.'}
              </td></tr>}
              {data?.items.map(entry => (
                <tr key={entry.id} className="hover:bg-gray-50 align-top">
                  <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{new Date(entry.created_at).toLocaleString()}</td>
                  <td className="px-3 py-2.5 font-medium">
                    {entry.can_open ? <Link className="text-primary hover:underline"
                      to={`/records/${encodeURIComponent(entry.record_type_slug)}/${entry.record_id}`}>{entry.record_name}</Link> : entry.record_name}
                  </td>
                  <td className="px-3 py-2.5">{entry.record_type}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">{formatDate(entry.old_date)}</td>
                  <td className="px-3 py-2.5 whitespace-nowrap">
                    <span className="font-medium">{formatDate(entry.new_date)}</span>
                    {entry.renewed_on && entry.old_date && entry.renewed_on < entry.old_date &&
                      <span className="block text-xs text-gray-500">Recorded early. Effective {formatDate(entry.old_date)}.</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScrollArea>
      </TableCard>
    </div>
  )
}
