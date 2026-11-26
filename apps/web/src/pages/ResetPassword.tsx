import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export default function ResetPassword() {
  const [sp] = useSearchParams()
  const token = sp.get('token') ?? ''
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [state, setState] = useState<{ ok?: string; error?: string }>({})
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader><CardTitle>Choose a new password</CardTitle></CardHeader>
        <CardContent>
          {state.ok ? <p className="text-sm text-green-700">{state.ok} <Link className="text-primary hover:underline" to="/login">Sign in</Link></p> : (
            <form className="space-y-3" onSubmit={async (e) => {
              e.preventDefault()
              if (password !== confirm) return setState({ error: 'Passwords do not match' })
              try { setState({ ok: (await api.post('/auth/password-reset/confirm', { token, password })).data.message }) }
              catch (err: any) { setState({ error: err.response?.data?.error?.message || 'Reset failed' }) }
            }}>
              {!token && <p className="text-sm text-red-600">This link is missing its token. Request a new one from the sign-in page.</p>}
              {state.error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{state.error}</p>}
              <Input type="password" autoComplete="new-password" placeholder="New password (10+ characters)" minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} required />
              <Input type="password" autoComplete="new-password" placeholder="Repeat new password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
              <Button className="w-full" disabled={!token}>Save password</Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
