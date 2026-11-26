import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Code2, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'
import { errorMessage, formatDate, useApi } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { passkeysSupported, registerPasskey } from '@/lib/passkey'

/** Passkeys: sign in with Touch ID, Windows Hello or a security key. */
export function PasskeysCard() {
  const api = useApi()
  const passkeys = useQuery({ queryKey: ['passkeys'], queryFn: api.account.passkeys })
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-primary" />Passkeys</CardTitle>
        <p className="text-sm text-gray-500">Sign in with Touch ID, Windows Hello or a security key instead of a password.</p></CardHeader>
      <CardContent className="space-y-3">
        <ul className="divide-y rounded-xl border text-sm">
          {(passkeys.data ?? []).map((p) => (
            <li key={p.id} className="flex items-center gap-2 px-3 py-2"><span className="flex-1">{p.name}<span className="block text-xs text-gray-500">Added {formatDate(p.created_at)}{p.last_used_at && ` · used ${formatDate(p.last_used_at)}`}</span></span>
              <button aria-label={`Remove ${p.name}`} className="press rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => api.account.deletePasskey(p.id).then(() => passkeys.refetch())}><Trash2 className="h-4 w-4" /></button></li>
          ))}
          {!passkeys.data?.length && <li className="px-3 py-3 text-xs text-gray-400">No passkeys yet</li>}
        </ul>
        <Button variant="outline" size="sm" disabled={!passkeysSupported()} onClick={async () => {
          try { await registerPasskey(navigator.platform ? `Passkey (${navigator.platform})` : 'Passkey'); toast.success('Passkey added'); passkeys.refetch() }
          catch (e) { if ((e as Error)?.name !== 'NotAllowedError') toast.error(errorMessage(e)) }
        }}><Plus className="h-4 w-4" />Add passkey</Button>
      </CardContent>
    </Card>
  )
}

/** Personal API tokens for the MCP server and scripts. */
export function TokensCard() {
  const api = useApi()
  const tokens = useQuery({ queryKey: ['api-tokens'], queryFn: api.account.tokens })
  const [tokenName, setTokenName] = useState('')
  const [newToken, setNewToken] = useState<string | null>(null)
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><Code2 className="h-4 w-4 text-primary" />API tokens</CardTitle>
        <p className="text-sm text-gray-500">For the MCP server and scripts. A token acts with your permissions and is shown once.</p></CardHeader>
      <CardContent className="space-y-3">
        {newToken && <div className="flex animate-pop-in items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 p-2"><code className="flex-1 break-all text-xs text-gray-800">{newToken}</code>
          <Button size="icon" variant="ghost" aria-label="Copy token" onClick={() => navigator.clipboard.writeText(newToken).then(() => toast.success('Copied'))}><Copy className="h-4 w-4" /></Button></div>}
        <ul className="divide-y rounded-xl border text-sm">
          {(tokens.data ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-2 px-3 py-2"><span className="flex-1">{t.name}<span className="block text-xs text-gray-500">{t.prefix}… · {t.last_used_at ? `used ${formatDate(t.last_used_at)}` : 'never used'}</span></span>
              <button aria-label={`Revoke ${t.name}`} className="press rounded-md p-1 text-gray-400 hover:bg-red-50 hover:text-red-600" onClick={() => api.account.revokeToken(t.id).then(() => tokens.refetch())}><Trash2 className="h-4 w-4" /></button></li>
          ))}
          {!tokens.data?.length && <li className="px-3 py-3 text-xs text-gray-400">No tokens</li>}
        </ul>
        <form className="flex gap-2" onSubmit={async (e) => {
          e.preventDefault()
          try { setNewToken((await api.account.createToken(tokenName.trim())).token); setTokenName(''); tokens.refetch() } catch (err) { toast.error(errorMessage(err)) }
        }}><Input placeholder="Token name (e.g. MCP on laptop)" value={tokenName} onChange={(e) => setTokenName(e.target.value)} /><Button variant="outline" disabled={!tokenName.trim()}>Create</Button></form>
      </CardContent>
    </Card>
  )
}
