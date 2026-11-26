import { useEffect, useState } from 'react'
import api from '@/lib/api'
import { useAuthStore } from '../store/auth'
import { Button } from './ui/button'
import { Input } from './ui/input'

export default function SecretReveal({ recordId, fieldId }: { recordId: number; fieldId: number }) {
  const user = useAuthStore(s => s.user)
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [value, setValue] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (value === null) return
    const timer = window.setTimeout(() => setValue(null), 30000)
    const hide = () => { if (document.hidden) setValue(null) }
    document.addEventListener('visibilitychange', hide)
    return () => { clearTimeout(timer); document.removeEventListener('visibilitychange', hide) }
  }, [value])
  if (!user?.is_superuser) return <span>[Protected]</span>
  const reveal = async () => {
    setBusy(true); setError('')
    try {
      const { data } = await api.post(`/records/${recordId}/fields/${fieldId}/reveal`, { password, code })
      setValue(data.value == null ? '(empty)' : String(data.value)); setOpen(false); setPassword(''); setCode('')
    } catch (e: any) { setError(e.response?.data?.error?.message || 'Could not reveal value') }
    finally { setBusy(false) }
  }
  return <div className="space-y-2">
    {value !== null ? <><code className="block break-all select-all">{value}</code><Button size="sm" variant="outline" onClick={() => setValue(null)}>Hide value</Button><p className="text-xs text-gray-500">Hides after 30 seconds.</p></> : <Button size="sm" variant="outline" onClick={() => setOpen(!open)}>[Protected] · Reveal</Button>}
    {open && <div className="rounded border bg-gray-50 p-3 space-y-2 text-left"><p className="text-xs text-gray-500">Administrator reveal is audited. Enter your password and, if enabled, authenticator code.</p><Input type="password" aria-label="Reveal current password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /><Input aria-label="Reveal authenticator code" autoComplete="one-time-code" value={code} onChange={e => setCode(e.target.value)} />{error && <p role="alert" className="text-xs text-red-700">{error}</p>}<Button size="sm" disabled={busy || !password} onClick={reveal}>{busy ? 'Verifying…' : 'Reveal for 30 seconds'}</Button></div>}
  </div>
}
