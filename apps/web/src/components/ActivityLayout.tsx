import { NavLink, Outlet } from 'react-router-dom'
import { ScrollText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAuthStore } from '../store/auth'

const sections = [
  { to: '/audit-logs', label: 'Audit logs', systemAdminOnly: true },
  { to: '/audit-logs/auto-renewals', label: 'Auto-renewal log' },
  { to: '/audit-logs/trash', label: 'Trash' },
]

export default function ActivityLayout() {
  const isSystemAdmin = useAuthStore(s => s.user?.is_superuser)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><ScrollText className="h-5 w-5 text-gray-600" /></div>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">Activity</h1>
          <p className="truncate text-sm text-gray-500">The audit trail, automatic renewals and deleted records.</p>
        </div>
      </div>
      <nav aria-label="Activity sections" className="flex shrink-0 gap-1 overflow-x-auto rounded-lg bg-gray-100 p-1 sm:self-start">
        {sections.filter(section => !section.systemAdminOnly || isSystemAdmin).map(section => (
          <NavLink key={section.to} to={section.to} end className={({ isActive }) => cn(
            'press whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors',
            isActive ? 'bg-white text-gray-900 shadow-soft' : 'text-gray-500 hover:text-gray-900',
          )}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1"><Outlet /></div>
    </div>
  )
}
