import { useEffect, useState } from 'react'
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
  const [uri, setUri] = useState('')
  const [qr, setQr] = useState('')
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!uri) { setQr(''); return }
    let live = true
    import('qrcode-generator').then(({ default: qrcode }) => {
      const code = qrcode(0, 'M')
      code.addData(uri)
      code.make()
      if (live) setQr(code.createSvgTag({ cellSize: 5, margin: 2, scalable: true }))
    }).catch(() => { if (live) setQr('') })
    return () => { live = false }
  }, [uri])
  const [recovery, setRecovery] = useState<string[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const act = async (action: 'setup' | 'enable' | 'disable') => {
    setBusy(true); setError('')
    try {
      const { data: result } = await api.post(`/security/mfa/${action}`, { password, code })
      if (action === 'setup') { setSecret(result.secret); setUri(result.uri || '') }
      else {
        client.setQueryData(key, { enabled: action === 'enable' })
        setSecret(''); setUri(''); setPassword(''); setCode(''); setRecovery(result.recovery_codes || [])
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
      {secret && <div className="space-y-3 rounded-lg border bg-gray-50 p-4 text-sm">
        <p className="font-medium text-gray-900">1. Scan this QR code with your authenticator app</p>
        <div className="flex flex-col items-start gap-4 sm:flex-row">
          {qr
            ? <div className="w-44 shrink-0 rounded-lg bg-white p-2 shadow-sm [&_svg]:h-auto [&_svg]:w-full" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: qr }} />
            : <div className="flex h-44 w-44 shrink-0 items-center justify-center rounded-lg bg-white text-xs text-gray-400">{uri ? 'Drawing QR code…' : 'QR code unavailable'}</div>}
          <div className="min-w-0 space-y-2 text-gray-600">
            <p>Google Authenticator, Microsoft Authenticator, 1Password and similar apps can scan it. Enrollment expires in ten minutes.</p>
            <p className="text-xs">Can't scan? Add a time-based account named Keepit and type this secret:</p>
            <div className="flex items-center gap-2">
              <code className="min-w-0 break-all rounded bg-white px-2 py-1 font-mono text-xs select-all">{secret.replace(/(.{4})/g, '$1 ').trim()}</code>
              <Button type="button" size="sm" variant="outline" onClick={() => navigator.clipboard?.writeText(secret).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) })}>{copied ? 'Copied' : 'Copy'}</Button>
            </div>
            <p className="text-xs text-gray-400">SHA-1, 6 digits, 30 seconds. Never share this secret.</p>
          </div>
        </div>
        <p className="font-medium text-gray-900">2. Enter the 6-digit code the app shows</p>
      </div>}
      {secret && <label className="block text-sm">Authenticator code<Input aria-label="MFA verification code" autoComplete="one-time-code" inputMode="numeric" maxLength={6} placeholder="123456" className="w-40 text-center font-mono tracking-[0.3em]" value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} /></label>}
      {data.enabled && <label className="block text-sm">Authenticator or recovery code<Input aria-label="MFA verification code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} /></label>}
      <div className="flex flex-wrap gap-2"><Button disabled={busy || !password || (data.enabled && !code) || (!!secret && code.length !== 6)} onClick={() => act(data.enabled ? 'disable' : secret ? 'enable' : 'setup')}>{busy ? 'Verifying…' : data.enabled ? 'Disable authenticator' : secret ? 'Verify and enable' : 'Set up authenticator'}</Button>
        {secret && <Button variant="ghost" disabled={busy} onClick={() => { setSecret(''); setUri(''); setCode('') }}>Cancel</Button>}</div>
    </>}
  </section>
}
