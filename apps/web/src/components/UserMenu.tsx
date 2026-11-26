import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { UserRound, KeyRound, LogOut, Settings } from 'lucide-react'
import { ThemeSegmented } from './ThemeToggle'
import Popover from '@/components/ui/popover'
import api from '@/lib/api'
import { useAuthStore } from '../store/auth'

/** Top-bar user profile menu: My Profile · Change password · Sign out. */
export default function UserMenu() {
  const navigate = useNavigate()
  const { user, logout } = useAuthStore()

  const { data: avatarUrl } = useQuery({
    queryKey: ['me-avatar'],
    queryFn: async () => {
      const res = await api.get('/users/me/avatar', { responseType: 'blob' })
      return URL.createObjectURL(res.data)
    },
    enabled: !!user?.has_avatar,
    retry: false,
  })

  const initial = user?.name?.charAt(0).toUpperCase() || '?'

  return (
    <Popover
      align="right"
      panelClassName="w-64 p-1.5"
      trigger={
        <button
          className="press ml-1 inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-gradient text-primary-foreground ring-2 ring-transparent transition-shadow hover:ring-primary/30"
          title={`${user?.name} - account menu`}
          aria-haspopup="menu"
          aria-label="Account menu"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full object-cover" />
          ) : initial !== '?' ? (
            <span className="text-sm font-semibold">{initial}</span>
          ) : (
            <UserRound className="h-4 w-4 text-gray-400" />
          )}
        </button>
      }
    >
      {(close) => (
        <>
          <div className="mb-1 border-b px-2.5 pb-2.5 pt-2">
            <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
            <p className="truncate text-xs text-gray-500">{user?.email}</p>
            <ThemeSegmented className="mt-2.5" />
          </div>
          {/* Account-level settings - available to every signed-in user */}
          <button
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-gray-100 text-left"
            onClick={() => { close(); navigate('/settings/profile') }}
          >
            <UserRound className="h-4 w-4 text-gray-400" /> My profile
          </button>
          <button
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-gray-100 text-left"
            onClick={() => { close(); navigate('/settings/security') }}
          >
            <KeyRound className="h-4 w-4 text-gray-400" /> Password &amp; security
          </button>
          <button
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm hover:bg-gray-100 text-left"
            onClick={() => { close(); navigate('/settings') }}
          >
            <Settings className="h-4 w-4 text-gray-400" /> All settings
          </button>
          <button
            className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-left text-red-600 hover:bg-red-50"
            onClick={async () => {
              close()
              try { await api.post('/auth/logout') }
              catch { return }
              logout()
              navigate('/login')
            }}
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </>
      )}
    </Popover>
  )
}
