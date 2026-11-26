import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '../store/auth'
import { toast } from '@/components/ui/toaster'
import { Input } from '@/components/ui/input'

interface TrashResult { items: { id: number; name: string; type: string; deleted_at: string; purge_eligible_at: string }[]; total: number; retention_days: number; policy: string }

export default function Trash() {
  const user = useAuthStore(s => s.user)
  const can = useAuthStore(s => s.hasPermission)
  const [page, setPage] = useState(1)
  const [purging, setPurging] = useState<{ id: number; name: string } | null>(null)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const client = useQueryClient()
  const { data, isPending, error } = useQuery<TrashResult>({ queryKey: ['trash', user?.id, page], queryFn: async () => (await api.get('/records/trash', { params: { page } })).data })
  const restore = useMutation({ mutationFn: (id: number) => api.post(`/records/${id}/restore`), onSuccess: () => { client.invalidateQueries({ queryKey: ['trash'] }); client.invalidateQueries({ queryKey: ['records'] }); client.invalidateQueries({ queryKey: ['dashboard'] }); toast.success('Record restored') }, onError: () => toast.error('Could not restore this record. Check permissions and retry.') })
  const purge = useMutation({ mutationFn: () => api.post(`/records/${purging!.id}/purge`, { password, code }), onSuccess: () => { setPurging(null); setPassword(''); setCode(''); setConfirmation(''); client.invalidateQueries({ queryKey: ['trash'] }); toast.success('Record permanently deleted') }, onError: (e: any) => toast.error(e.response?.data?.error?.message || 'Purge failed. A recent verified backup and password verification are required.') })
  return <div className="space-y-4"><div><h2 className="text-lg font-semibold">Trash</h2><p className="mt-1 text-sm text-gray-500">Deleted records stay recoverable here. Archived records remain in Records → Include archived.</p></div>
    {data && <p className="rounded border bg-sky-50 p-3 text-sm">Minimum recovery window: {data.retention_days} days. {data.policy}</p>}
    {user?.is_superuser && data?.items.some(r => new Date(r.purge_eligible_at).getTime() <= Date.now()) && <section className="rounded border border-red-200 p-4 space-y-3"><h2 className="font-semibold">Permanent deletion</h2><p className="text-sm text-gray-600">Only records past the recovery window qualify. Purging removes their values, renewal and assignment history. Audit entries remain. A restore-verified backup from the last two days is required.</p><div className="flex flex-wrap gap-2">{data.items.filter(r => new Date(r.purge_eligible_at).getTime() <= Date.now()).map(r => <Button variant="outline" key={r.id} onClick={() => { setPurging(r); setPassword(''); setCode(''); setConfirmation('') }}>Purge {r.name}</Button>)}</div></section>}
    {purging && <section role="dialog" aria-label="Confirm permanent deletion" className="rounded border border-red-300 bg-red-50 p-4 space-y-3"><p>Type <strong>{purging.name}</strong> to permanently delete this record.</p><Input aria-label="Record name confirmation" value={confirmation} onChange={e => setConfirmation(e.target.value)} /><Input type="password" autoComplete="current-password" aria-label="Purge password" placeholder="Current password" value={password} onChange={e => setPassword(e.target.value)} /><Input autoComplete="one-time-code" aria-label="Purge authenticator code" placeholder="Authenticator code, if enabled" value={code} onChange={e => setCode(e.target.value)} /><div className="flex gap-2"><Button disabled={confirmation !== purging.name || !password || purge.isPending} onClick={() => purge.mutate()}>Permanently delete</Button><Button variant="outline" onClick={() => { setPurging(null); setPassword(''); setCode('') }}>Cancel</Button></div></section>}
    {error && <p role="alert" className="text-red-700">Trash could not load.</p>}{isPending && <p>Loading trash…</p>}
    <div className="overflow-x-auto rounded-lg border bg-white"><table className="w-full text-left text-sm"><thead className="bg-gray-50"><tr>{['Record', 'Type', 'Deleted', 'Purge eligible', 'Action'].map(h => <th key={h} className="p-3">{h}</th>)}</tr></thead><tbody>{data?.items.map(r => <tr key={r.id} className="border-t"><td className="p-3">{r.name}</td><td className="p-3">{r.type}</td><td className="p-3 whitespace-nowrap">{new Date(r.deleted_at).toLocaleString()}</td><td className="p-3 whitespace-nowrap">{new Date(r.purge_eligible_at).toLocaleDateString()}</td><td className="p-3">{can('record.delete') ? <Button size="sm" variant="outline" disabled={restore.isPending} onClick={() => restore.mutate(r.id)}>Restore</Button> : 'Read only'}</td></tr>)}</tbody></table>{data?.items.length === 0 && <p className="p-8 text-center text-gray-500">Trash is empty.</p>}</div>
    <div className="flex items-center justify-end gap-3 text-sm"><Button variant="outline" disabled={page <= 1} onClick={() => setPage(page - 1)}>Previous</Button><span>{page} / {Math.max(1, Math.ceil((data?.total || 0) / 25))}</span><Button variant="outline" disabled={page * 25 >= (data?.total || 0)} onClick={() => setPage(page + 1)}>Next</Button></div>
  </div>
}
