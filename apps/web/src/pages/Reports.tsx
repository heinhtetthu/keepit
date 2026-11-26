import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { RecordType, AllocationReport } from '../types'
import { useAuthStore } from '../store/auth'
import RenewalForecast from '@/components/RenewalForecast'
import ReportDownloads, { downloadReportJob } from '@/components/ReportDownloads'
import { Select } from '@/components/ui/select'

function ym(d: Date) { return d.toISOString().slice(0, 10) }
function yearsAgo(n: number) { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d }

export default function Reports() {
  const client = useQueryClient()
  const [allocationJob, setAllocationJob] = useState<string | null>(null)
  const [allocationPage, setAllocationPage] = useState(1)
  const [queueing, setQueueing] = useState(false)
  const { hasPermission, user } = useAuthStore()
  const canExport = hasPermission('report.export')
  const [selectedType, setSelectedType] = useState<number | null>(null)
  const [downloading, setDownloading] = useState<'pdf' | 'excel' | null>(null)
  const [error, setError] = useState('')

  const { data: recordTypes } = useQuery<RecordType[]>({
    queryKey: ['record-types', user?.id],
    queryFn: async () => (await api.get('/record-types')).data,
  })
  const trackedTypes = (recordTypes || []).filter((rt) => rt.track_ownership)

  const [start, setStart] = useState(ym(yearsAgo(1)))
  const [end, setEnd] = useState(ym(new Date()))
  const [product, setProduct] = useState('')

  const allocTypeId = trackedTypes[0]?.id ?? null
  const { data: allocationStatus } = useQuery<any>({ queryKey: ['allocation-job', user?.id, allocationJob], queryFn: async () => (await api.get(`/reports/jobs/${allocationJob}`)).data, enabled: !!allocationJob, refetchInterval: query => ['pending', 'processing'].includes(query.state.data?.status) ? 2500 : false })
  const { data: allocation, isFetching: fetchingAllocation } = useQuery<AllocationReport & { total: number }>({ queryKey: ['allocation-result', user?.id, allocationJob, allocationPage], queryFn: async () => (await api.get(`/reports/jobs/${allocationJob}/data`, { params: { page: allocationPage } })).data, enabled: allocationStatus?.status === 'ready', retry: false })
  const allocLoading = queueing || fetchingAllocation || ['pending', 'processing'].includes(allocationStatus?.status)
  const generateAllocation = async () => {
    setQueueing(true); setError('')
    try { const { data } = await api.post('/reports/jobs', { kind: 'allocation', record_type_id: allocTypeId, start, end, product: product || undefined }); setAllocationJob(data.id); setAllocationPage(1); client.invalidateQueries({ queryKey: ['export-jobs'] }) }
    catch { setError('Could not queue allocation. Check the date range and permissions.') }
    finally { setQueueing(false) }
  }

  const productOptions = Array.from(new Set(
    (recordTypes?.find((rt) => rt.id === allocTypeId)?.fields.find((f) => f.name === 'Product Name')?.options || []).map((o) => o.label)
  ))

  const downloadCSV = () => { if (allocationJob) downloadReportJob(allocationJob, 'allocation').catch(() => setError('Allocation download failed. Check permissions and regenerate.')) }

  const download = async (format: 'pdf' | 'excel') => {
    if (!selectedType) return
    setError('')
    setDownloading(format)
    try {
      await api.post('/reports/jobs', { kind: format, record_type_id: selectedType })
      client.invalidateQueries({ queryKey: ['export-jobs'] })
    } catch (err: any) {
      setError('Download failed. Please try again.')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Reports</h1>
      <ReportDownloads onOpenAllocation={id => { setAllocationJob(id); setAllocationPage(1) }} />
      {error && <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">{error}</div>}
      <RenewalForecast recordTypes={recordTypes || []} />

      {/* License allocation (record types with ownership tracking) */}
      {trackedTypes.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">License allocation - cost by business unit</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 mb-4">
              Each seat's cost is prorated by exact days held per business unit inside the selected window.
            </p>
            <div className="flex flex-wrap gap-2 mb-4 items-center"><Button onClick={generateAllocation} disabled={queueing || !allocTypeId || !start || !end || end < start}>Generate allocation report</Button><span className="text-xs text-gray-500">Generate after changing filters. Results below show the generated report window.</span>{allocationStatus?.error && <p role="alert" className="text-red-700 text-sm">{allocationStatus.error}</p>}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">From</label>
                <input type="date" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={start} onChange={(e) => setStart(e.target.value)} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500">To</label>
                <input type="date" className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={end} onChange={(e) => setEnd(e.target.value)} />
              </div>
              {productOptions.length > 0 && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Product</label>
                  <Select className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" value={product} onChange={(e) => setProduct(e.target.value)}>
                    <option value="">All products</option>
                    {productOptions.map((p) => <option key={p} value={p}>{p}</option>)}
                  </Select>
                </div>
              )}
              <div className="flex items-end">
                <Button variant="outline" onClick={downloadCSV} disabled={!canExport || !allocation || allocation.records.length === 0}>
                  Download CSV
                </Button>
              </div>
            </div>

            {!start || !end || end < start ? (
              <p className="text-sm text-amber-600">Pick a valid date window.</p>
            ) : allocLoading ? (
              <p className="text-sm text-gray-500">Calculating…</p>
            ) : !allocation || allocation.records.length === 0 ? (
              <p className="text-sm text-gray-400">No tracked records with ownership history in this window.</p>
            ) : (
              <div className="space-y-5">
                <div>
                  <h3 className="text-sm font-medium mb-2">Business units</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {allocation.business_units.map((b, i) => (
                      <div key={`${b.business_unit}-${b.currency}-${i}`} className="rounded-lg border bg-gray-50/60 px-4 py-3">
                        <div className="text-xs text-gray-400">{b.business_unit || '(no BU)'}</div>
                        <div className="text-xl font-semibold mt-0.5">
                          {b.allocated.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          <span className="text-sm text-gray-500 ml-1">{b.currency || ''}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-sm font-medium mb-2">
                    Seats ({allocation.total}) - {allocation.record_type_name}, window {allocation.start} → {allocation.end} ({allocation.window_days} days)
                  </h3>
                  <div className="overflow-auto max-h-[70vh] border rounded-md">
                    <table className="w-full text-sm">
                      <thead className="text-xs text-gray-500 border-b text-left bg-gray-50/60">
                        <tr>
                          <th className="sticky top-0 bg-gray-50 z-10 px-3 py-2">Seat</th>
                          <th className="sticky top-0 bg-gray-50 z-10 px-3 py-2">Product</th>
                          <th className="sticky top-0 bg-gray-50 z-10 px-3 py-2">Holder · BU</th>
                          <th className="sticky top-0 bg-gray-50 z-10 px-3 py-2 whitespace-nowrap">Span</th>
                          <th className="sticky top-0 bg-gray-50 z-10 px-3 py-2 whitespace-nowrap">Days</th>
                          <th className="sticky top-0 bg-gray-50 z-10 px-3 py-2 text-right whitespace-nowrap">Allocated</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {allocation.records.map((r) => (
                          <tr key={r.record_id} className="align-top hover:bg-gray-50">
                            <td className="px-3 py-2 font-medium whitespace-nowrap">
                              {r.name}
                              <Badge variant="secondary" className="ml-2">{r.status}</Badge>
                            </td>
                            <td className="px-3 py-2 text-xs">{r.product || '-'}</td>
                            <td className="px-3 py-2 text-xs space-y-0.5">
                              {r.spans.map((s) => (
                                <div key={`${s.assignment_id}-${s.from}`}>
                                  <span className="font-medium">{s.employee_name}</span>
                                  {s.business_unit && <span className="text-gray-500"> · {s.business_unit}</span>}
                                </div>
                              ))}
                            </td>
                            <td className="px-3 py-2 text-xs space-y-0.5">
                              {r.spans.map((s) => (
                                <div key={`${s.assignment_id}-${s.from}`}>{s.from} → {s.to}</div>
                              ))}
                            </td>
                            <td className="px-3 py-2 text-xs space-y-0.5">
                              {r.spans.map((s) => (
                                <div key={`${s.assignment_id}-${s.from}`}>{s.days}</div>
                              ))}
                            </td>
                            <td className="px-3 py-2 text-right text-xs space-y-0.5 whitespace-nowrap">
                              {r.spans.map((s) => (
                                <div key={`${s.assignment_id}-${s.from}`}>
                                  {(s.allocated || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                                  {s.currency ? ` ${s.currency}` : ''}
                                </div>
                              ))}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-end gap-3 mt-3 text-sm"><Button variant="outline" disabled={allocationPage <= 1} onClick={() => setAllocationPage(allocationPage - 1)}>Previous seats</Button><span>{allocationPage} / {Math.max(1, Math.ceil(allocation.total / 50))}</span><Button variant="outline" disabled={allocationPage * 50 >= allocation.total} onClick={() => setAllocationPage(allocationPage + 1)}>Next seats</Button></div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Classic record-type export */}
      <Card>
        <CardHeader><CardTitle>Generate Report</CardTitle></CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium block mb-2">Record Type</label>
              <Select
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={selectedType || ''}
                onChange={(e) => setSelectedType(Number(e.target.value) || null)}
              >
                <option value="">Select a record type...</option>
                {(recordTypes || []).map((rt) => (
                  <option key={rt.id} value={rt.id}>{rt.name}</option>
                ))}
              </Select>
            </div>
            <div className="flex gap-2">
              {canExport && (
                <Button onClick={() => download('excel')} disabled={!selectedType || downloading !== null}>
                  {downloading === 'excel' ? 'Preparing...' : 'Export Excel'}
                </Button>
              )}
              {canExport && (
                <Button onClick={() => download('pdf')} disabled={!selectedType || downloading !== null} variant="outline">
                  {downloading === 'pdf' ? 'Preparing...' : 'Export PDF'}
                </Button>
              )}
              {!canExport && (
                <p className="text-sm text-amber-600">You do not have permission to export reports.</p>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
</div>
)
}

