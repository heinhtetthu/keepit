import { NavLink, Outlet } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAuthStore } from '../store/auth'

const sections = [
  { to: '/audit-logs', label: 'Audit Logs', systemAdminOnly: true },
  { to: '/audit-logs/auto-renewals', label: 'Auto-renewal Log' },
  { to: '/audit-logs/trash', label: 'Trash' },
]

export default function ActivityLayout() {
  const isSystemAdmin = useAuthStore(s => s.user?.is_superuser)

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <h1 className="shrink-0 text-2xl font-semibold tracking-tight text-gray-900">Activity</h1>
      <nav aria-label="Activity sections" className="flex shrink-0 flex-wrap gap-x-2 border-b border-gray-200">
        {sections.filter(section => !section.systemAdminOnly || isSystemAdmin).map(section => (
          <NavLink key={section.to} to={section.to} end className={({ isActive }) => cn(
            'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium',
            isActive ? 'border-primary text-primary' : 'border-transparent text-gray-600 hover:text-gray-900',
          )}>
            {section.label}
          </NavLink>
        ))}
      </nav>
      <div className="min-h-0 min-w-0 flex-1"><Outlet /></div>
    </div>
  )
}
