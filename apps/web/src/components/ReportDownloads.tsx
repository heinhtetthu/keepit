import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '../store/auth'
import { Button } from './ui/button'

export async function downloadReportJob(id: string, kind: string) {
  const response = await api.get(`/reports/jobs/${id}/download`, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url; link.download = `report_${id}.${kind === 'excel' ? 'xlsx' : kind === 'pdf' ? 'pdf' : 'csv'}`
  link.click(); URL.revokeObjectURL(url)
}

export default function ReportDownloads({ onOpenAllocation }: { onOpenAllocation?: (id: string) => void }) {
  const user = useAuthStore(s => s.user)
  const can = useAuthStore(s => s.hasPermission)
  const [error, setError] = useState('')
  const { data = [] } = useQuery<any[]>({ queryKey: ['export-jobs', user?.id], queryFn: async () => (await api.get('/reports/jobs')).data, refetchInterval: query => query.state.data?.some(j => ['pending', 'processing'].includes(j.status)) ? 2500 : 15000 })
  return <section className="rounded-lg border bg-white p-4 space-y-3"><h2 className="font-semibold">Background reports and downloads</h2><p className="text-sm text-gray-500">Reports run in the worker so you can keep using the app. Encrypted artifacts expire after 24 hours. Access is checked again before viewing or downloading.</p>{error && <p role="alert" className="text-red-700">{error}</p>}
    {!data.length && <p className="text-sm text-gray-400">No recent generated reports.</p>}
    {data.map(job => <div key={job.id} className="flex flex-wrap gap-2 items-center border-t pt-2 text-sm"><span className="font-medium uppercase">{job.kind}</span><span className="capitalize">{job.status}</span><span className="text-xs text-gray-500">{new Date(job.created_at).toLocaleString()}</span>{job.error && <span className="text-red-700">{job.error}</span>}{job.status === 'ready' && <>{job.kind === 'allocation' && onOpenAllocation && <Button size="sm" variant="outline" onClick={() => onOpenAllocation(job.id)}>View allocation</Button>}{can('report.export') && <Button size="sm" variant="outline" onClick={() => downloadReportJob(job.id, job.kind).catch(() => setError('Report download failed or access changed. Regenerate the report and try again.'))}>Download</Button>}</>}</div>)}
  </section>
}
