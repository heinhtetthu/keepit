import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Eye, EyeOff } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { KeyRound } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { BrandLogo, useBrandName } from '@/lib/branding'

export default function Login() {
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [otp, setOtp] = useState('')
  const [needsMfa, setNeedsMfa] = useState(false)
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { login } = useAuthStore()
  const brand = useBrandName()
  const navigate = useNavigate()

  const finish = async (access_token: string) => {
    localStorage.setItem('access_token', access_token)
    const meRes = await api.get('/auth/me')
    login(meRes.data, access_token, '')
    navigate('/dashboard')
  }

  const passkey = async () => {
    setError('')
    try {
      const { signInWithPasskey } = await import('@/lib/passkey')
      await finish((await signInWithPasskey()).access_token)
    } catch (err: any) {
      if (err?.name !== 'NotAllowedError') setError(err?.response?.data?.error?.message || err?.message || 'Passkey sign-in failed')
    }
  }

  const [forgot, setForgot] = useState(false)
  const [resetSent, setResetSent] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const res = await api.post('/auth/login', { identifier, password, otp: otp || undefined })
      await finish(res.data.access_token)
    } catch (err: any) {
      if (['MFA_REQUIRED', 'MFA_INVALID'].includes(err.response?.data?.error?.code)) setNeedsMfa(true)
      setError(err.response?.data?.error?.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="grid min-h-[100dvh] bg-background lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel */}
      <section className="relative hidden overflow-hidden bg-brand-gradient p-12 text-[#ffffffd9] lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-32 -top-32 h-[28rem] w-[28rem] rounded-full bg-[#ffffff26] blur-3xl" />
        <div className="pointer-events-none absolute -bottom-40 right-0 h-[30rem] w-[30rem] rounded-full bg-[#0000001f] blur-3xl" />
        <div className="relative flex items-center gap-3"><span className="rounded-2xl bg-[#ffffff] p-1.5 shadow-lift"><BrandLogo className="h-8 w-8" /></span><span className="text-xl font-semibold tracking-tight text-[#ffffff]">{brand}</span></div>
        <div className="relative mt-auto max-w-md space-y-6">
          <h2 className="text-4xl font-semibold leading-tight tracking-tight text-[#ffffff]">Everything your company owns.<br /><span className="text-[#ffffffb3]">Who has it. When it renews.</span></h2>
          <ul className="space-y-3 text-sm text-[#ffffffcc]">
            {['Devices, licenses, subscriptions and domains in one place', 'Assignments, repairs, borrows and offboarding in a few clicks', 'Reminders before anything expires, with documents attached'].map((t, i) => (
              <li key={t} style={{ animationDelay: `${150 + i * 90}ms` }} className="flex animate-page-in items-start gap-3 [animation-fill-mode:both]"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[#ffffff]" />{t}</li>
            ))}
          </ul>
        </div>
        <p className="relative mt-12 text-xs text-[#ffffffa6]">Secure by default: passkeys, MFA and a tamper-evident audit log.</p>
      </section>
      <div className="flex items-center justify-center p-4 sm:p-8">
      <Card className="w-full max-w-md animate-scale-in border-0 shadow-none sm:border sm:shadow-pop">
        <CardHeader>
          <div className="flex flex-col items-center gap-2 pt-2 lg:items-start">
            <BrandLogo className="h-12 w-12 lg:hidden" />
            <CardTitle className="text-2xl">Welcome back</CardTitle>
            <p className="text-sm text-gray-500">Sign in to {brand}</p>
          </div>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <div className="animate-pop-in rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}
            <div className="space-y-2">
            <label className="text-sm font-medium">Email or username</label>
            <Input
              type="text"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              placeholder="you@company.com or your username"
              required
              autoFocus
            />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Password</label>
              <div className="relative">
                <Input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pr-10"
                  required
                />
                <button
                  type="button"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  tabIndex={-1}
                  onClick={() => setShowPassword((s) => !s)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Signing in…' : 'Sign in'}
            </Button>
            {needsMfa && <label className="block space-y-1 text-sm">Authenticator or recovery code<Input aria-label="Authenticator or recovery code" value={otp} onChange={e => setOtp(e.target.value)} autoComplete="one-time-code" autoFocus /></label>}
            <div className="flex items-center justify-between text-sm">
              <button type="button" className="text-primary hover:underline" onClick={() => { setForgot(true); setResetSent('') }}>Forgot password?</button>
              {typeof window !== 'undefined' && window.PublicKeyCredential && (
                <button type="button" className="inline-flex items-center gap-1 text-gray-700 hover:underline" onClick={passkey}><KeyRound className="h-4 w-4" />Use a passkey</button>
              )}
            </div>
          </form>
          {forgot && (
            <form className="mt-4 space-y-2 border-t pt-4" onSubmit={async (e) => {
              e.preventDefault()
              try { setResetSent((await api.post('/auth/password-reset/request', { email: identifier })).data.message) }
              catch (err: any) { setError(err.response?.data?.error?.message || 'Could not send the reset link') }
            }}>
              <p className="text-sm text-gray-600">Enter your account email above, then send a reset link.</p>
              <Button type="submit" variant="outline" className="w-full" disabled={!identifier.includes('@')}>Email me a reset link</Button>
              {resetSent && <p className="text-sm text-green-700">{resetSent}</p>}
            </form>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  )
}
