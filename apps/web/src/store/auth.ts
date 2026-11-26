import { create } from 'zustand'

interface User {
  id: number
  email: string
  username?: string | null
  name: string
  has_avatar?: boolean
  is_superuser: boolean
  permissions: string[]
  must_change_password?: boolean
  /** {record_type_id: 'view' | 'edit'}; null = edit everywhere (system administrator). */
  record_type_access?: Record<string, 'view' | 'edit'> | null
  roles: string[]
}

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  login: (user: User, accessToken: string, refreshToken: string) => void
  setUser: (user: User) => void
  logout: () => void
  hasPermission: (permission: string) => boolean
  /** Role permission AND an Edit grant on this record type. */
  canInType: (permission: string, recordTypeId: number | undefined) => boolean
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  isAuthenticated: !!localStorage.getItem('access_token'),
  login: (user, accessToken, _refreshToken) => {
    localStorage.setItem('access_token', accessToken)
    localStorage.removeItem('refresh_token')
    set({ user, isAuthenticated: true })
  },
  setUser: (user) => set({ user }),
  logout: () => {
    localStorage.removeItem('access_token')
    localStorage.removeItem('refresh_token')
    set({ user: null, isAuthenticated: false })
  },
  canInType: (permission, recordTypeId) => {
    const { user } = get()
    if (!user) return false
    if (user.is_superuser) return true
    if (!user.permissions.includes(permission)) return false
    if (permission === 'record.view') return true
    const map = user.record_type_access
    return map == null || (recordTypeId !== undefined && map[String(recordTypeId)] === 'edit')
  },
  hasPermission: (permission) => {
    const { user } = get()
    if (!user) return false
    if (user.is_superuser) return true
    return user.permissions.includes(permission)
  },
}))
