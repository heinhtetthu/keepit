import { useState } from 'react'
import api from '@/lib/api'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { useAuthStore } from '@/store/auth'

/** Blocks the app until a user with a temporary (admin-set or seeded) password picks their own. */
export default function ForcePasswordChange() {
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [f, setF] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState('')
  if (!user?.must_change_password) return null
  return (
    <Modal title="Choose a new password" subtitle="Your password was set by an administrator." onClose={() => undefined} footer={
      <Button onClick={async () => {
        if (f.next !== f.confirm) return setError('Passwords do not match')
        try {
          await api.put('/users/me/password', { current_password: f.current, new_password: f.next })
          setUser({ ...user, must_change_password: false })
        } catch (e: any) { setError(e.response?.data?.error?.message || 'Could not change the password') }
      }}>Save password</Button>}>
      <div className="space-y-2">
        {error && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        <Input type="password" placeholder="Current password" autoComplete="current-password" value={f.current} onChange={(e) => setF({ ...f, current: e.target.value })} />
        <Input type="password" placeholder="New password" autoComplete="new-password" value={f.next} onChange={(e) => setF({ ...f, next: e.target.value })} />
        <Input type="password" placeholder="Repeat new password" autoComplete="new-password" value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} />
      </div>
    </Modal>
  )
}
