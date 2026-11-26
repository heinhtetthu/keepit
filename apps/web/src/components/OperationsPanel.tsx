import { useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import { useAuthStore } from '../store/auth'

export function NotificationHealth() {
  const user = useAuthStore(s => s.user)
  const { data, error } = useQuery({ queryKey: ['notification-health', user?.id], queryFn: async () => (await api.get('/operations/notifications')).data, refetchInterval: 30000 })
  return <section className="rounded-lg border bg-white p-4 space-y-3"><h2 className="font-semibold">Reminder delivery health</h2>{error && <p role="alert" className="text-red-700 text-sm">Could not load worker health.</p>}{data && <>
    <div className="flex flex-wrap gap-3 text-sm">{Object.entries(data.workers).map(([kind, info]: [string, any]) => <span key={kind} className={`rounded px-3 py-2 ${info.healthy ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-900'}`}>{kind === 'schedule' ? 'Scheduler' : kind === 'reports' ? 'Report worker' : 'Telegram dispatcher'}: {info.healthy ? 'Healthy' : 'Needs attention'}<span className="block text-xs">Last success: {info.last_success ? new Date(info.last_success).toLocaleString() : 'Not recorded'}</span></span>)}</div>
    <dl className="flex flex-wrap gap-4 text-sm">{['pending', 'processing', 'retry', 'failed', 'sent', 'cancelled'].map(status => <div key={status}><dt className="text-gray-500 capitalize">{status}</dt><dd className="font-semibold">{data.counts[status] || 0}</dd></div>)}<div><dt className="text-gray-500">Oldest due job</dt><dd className="font-semibold">{Math.floor(data.oldest_due_age_seconds / 60)} min</dd></div></dl>
    {data.attention.map((message: string) => <p key={message} role="status" className="rounded bg-amber-50 p-2 text-sm text-amber-900">{message}</p>)}
    <p className="text-xs text-gray-500">{data.scope} {data.semantics}</p>
  </>}</section>
}

export function SecurityHealth() {
  const user = useAuthStore(s => s.user)
  const { data: integrity } = useQuery({ queryKey: ['audit-integrity', user?.id], queryFn: async () => (await api.get('/security/audit-integrity')).data, enabled: !!user?.is_superuser, refetchInterval: 60000 })
  const { data, error } = useQuery({ queryKey: ['security-health', user?.id], queryFn: async () => (await api.get('/operations/security')).data, enabled: !!user?.is_superuser, refetchInterval: 60000 })
  if (!user?.is_superuser) return null
  return <section className="rounded-lg border bg-white p-4 space-y-3"><h2 className="font-semibold">Security and recovery</h2>{error && <p role="alert">Could not load security health.</p>}{data && <>
    {data.warnings.map((message: string) => <p key={message} className="rounded bg-amber-50 p-3 text-sm text-amber-900">{message}</p>)}
    <dl className="space-y-2 text-sm"><div>Environment: <strong>{data.environment}</strong></div><div>Application encryption: <strong>{data.data_encryption_configured ? 'Configured' : 'Missing'}</strong></div><div>Last encrypted backup: <strong>{data.backup.last_success ? new Date(data.backup.last_success).toLocaleString() : 'Not recorded'}</strong></div><div>Last verified restore: <strong>{data.backup.last_restore_verified ? new Date(data.backup.last_restore_verified).toLocaleString() : 'Not recorded'}</strong></div></dl>
    <p className="text-xs text-gray-500">Local encrypted backups require the separate backup key. Keep encryption keys and an additional backup copy safely outside this machine before relying on recovery from hardware loss.</p>
    {integrity && <div className={`rounded p-3 text-sm ${integrity.invalid_ids.length ? 'bg-red-50 text-red-800' : 'bg-gray-50 text-gray-700'}`}><strong>Audit integrity:</strong> {integrity.checked} checked; {integrity.unsigned_historical} historical unsigned; {integrity.invalid_ids.length} invalid.{integrity.invalid_ids.length > 0 && <p role="alert">Investigate audit entries: {integrity.invalid_ids.join(', ')}</p>}<p className="mt-1 text-xs">{integrity.scope}</p></div>}
  </>}</section>
}

