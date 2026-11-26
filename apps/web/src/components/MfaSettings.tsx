import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { useAuthStore } from '../store/auth'

export default function MfaSettings() {
  const user = useAuthStore(s => s.user)
  const client = useQueryClient()
  const key = ['mfa-status', user?.id]
  const { data, error: statusError } = useQuery<{ enabled: boolean }>({ queryKey: key, queryFn: async () => (await api.get('/security/mfa')).data })
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [secret, setSecret] = useState('')
  const [recovery, setRecovery] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (action: 'setup' | 'enable' | 'disable') => {
    setBusy(true); setError('')
    try {
      const { data: result } = await api.post(`/security/mfa/${action}`, { password, code })
      if (action === 'setup') setSecret(result.secret)
      else {
        client.setQueryData(key, { enabled: action === 'enable' })
        setSecret(''); setPassword(''); setCode(''); setRecovery(result.recovery_codes || [])
      }
    } catch (e: any) { setError(e.response?.data?.error?.message || 'Could not update authenticator settings.') }
    finally { setBusy(false) }
  }
  return <section className="rounded-lg border bg-white p-6 space-y-3">
    <h2 className="font-semibold">Authenticator security</h2>
    <p className="text-sm text-gray-500">{data?.enabled ? 'Two-factor authentication is enabled.' : 'Add an authenticator code to protect sign-in. Setup is optional for local use.'}</p>
    {statusError && <p role="alert" className="text-sm text-red-700">Could not load authenticator status.</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    {recovery.length > 0 && <div className="rounded border border-amber-300 bg-amber-50 p-4 space-y-2"><p className="text-sm font-medium">Save these recovery codes now. Each works once if you lose your authenticator. They will not be shown again.</p><pre className="whitespace-pre-wrap text-sm select-all">{recovery.join('\n')}</pre><Button variant="outline" onClick={() => setRecovery([])}>I saved my recovery codes</Button></div>}
    {!recovery.length && data && <>
      <label className="block text-sm">Current password<Input aria-label="MFA current password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label>
      {secret && <div className="rounded bg-gray-50 p-3 text-sm space-y-2"><p>In your authenticator, add a time-based account named Keepit using this secret. Then enter its six-digit code below. Enrollment expires in ten minutes.</p><code className="block break-all select-all">{secret}</code><p>SHA-1 · 6 digits · 30 seconds. Never share this secret.</p></div>}
      {(secret || data.enabled) && <label className="block text-sm">Authenticator or recovery code<Input aria-label="MFA verification code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></label>}
      <Button disabled={busy || !password || ((!!secret || data.enabled) && !code)} onClick={() => act(data.enabled ? 'disable' : secret ? 'enable' : 'setup')}>{busy ? 'Verifying…' : data.enabled ? 'Disable authenticator' : secret ? 'Verify and enable' : 'Set up authenticator'}</Button>
    </>}
  </section>
}
