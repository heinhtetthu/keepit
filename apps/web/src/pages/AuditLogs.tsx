import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { TableCard, TableScrollArea, RowsPerPageSelect, MiniPager, TableFooterInfo, usePageSize, TH_STICKY } from '../components/table_shell'
import { cn } from '@/lib/utils'
import type { AuditLog } from '../types'
import { useAuthStore } from '../store/auth'

export default function AuditLogs() {
  const userId = useAuthStore(s => s.user?.id)
  const [page, setPage] = useState(1)
  const [entityType, setEntityType] = useState('')
  const [pageSize, setPageSize] = usePageSize('audit')

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', userId, page, pageSize, entityType],
    queryFn: async () => (await api.get('/audit-logs', { params: { page, page_size: pageSize, entity_type: entityType } })).data,
    retry: 1,
  })

  const totalPages = data?.total_pages || 1

  return (
    <div className="flex flex-col gap-4 h-full min-h-0">
      <div className="shrink-0">
        <h2 className="text-lg font-semibold">Audit Logs</h2>
        <p className="text-sm text-gray-500 mt-1">Who did what, across the whole app.</p>
      </div>

      <TableCard
        className="flex-1 min-h-0"
        header={
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b shrink-0">
            <Input placeholder="Filter by entity type..." value={entityType} onChange={(e) => { setEntityType(e.target.value); setPage(1) }} className="w-52 sm:w-64" />
          </div>
        }
        footer={
          <>
            <TableFooterInfo shown={data?.items?.length || 0} total={data?.total ?? 0} noun="entries" />
            <div className="flex items-center gap-3 justify-end">
              <RowsPerPageSelect value={pageSize} onChange={(n) => { setPageSize(n); setPage(1) }} />
              <MiniPager page={page} pages={totalPages} onPage={setPage} />
            </div>
          </>
        }
      >
        <TableScrollArea className="flex-1">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-xs text-gray-500">
              <tr>
                <th className={cn('px-3 py-2 w-44', TH_STICKY)}>When</th>
                <th className={cn('px-3 py-2 w-40', TH_STICKY)}>User</th>
                <th className={cn('px-3 py-2 w-36', TH_STICKY)}>Action</th>
                <th className={cn('px-3 py-2 w-56', TH_STICKY)}>Entity</th>
                <th className={cn('px-3 py-2', TH_STICKY)}>Details</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {isLoading ? (
                <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">Loading…</td></tr>
              ) : (
                <>
                  {(data?.items || []).map((log: AuditLog) => (
                    <tr key={log.id} className="hover:bg-gray-50 align-top">
                      <td className="px-3 py-2.5 text-xs text-gray-500 whitespace-nowrap">{new Date(log.timestamp).toLocaleString()}</td>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">{log.user_name || 'System'}</td>
                      <td className="px-3 py-2.5 text-gray-600 text-xs font-mono">{log.action}</td>
                      <td className="px-3 py-2.5 min-w-0">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-primary truncate">{log.entity_name || log.entity_type}</span>
                          <Badge variant="secondary" className="shrink-0">{log.entity_type}</Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 text-sm min-w-0">
                        <span className="block max-w-[420px] truncate" title={log.details || ''}>{log.details || '- '}</span>
                      </td>
                    </tr>
                  ))}
                  {(!data?.items || data.items.length === 0) && (
                    <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-500">No audit logs found</td></tr>
                  )}
                </>
              )}
            </tbody>
          </table>
        </TableScrollArea>
      </TableCard>
    </div>
  )
}
