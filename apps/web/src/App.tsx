import { lazy, Suspense, useEffect, useState } from 'react'
import { Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { useAuthStore } from './store/auth'
import api from './lib/api'
import Layout from './components/Layout'
import ActivityLayout from './components/ActivityLayout'
import Login from './pages/Login'
import { BrandingEffect } from './lib/branding'
const Home = lazy(() => import('./pages/Home'))
const Assets = lazy(() => import('./pages/assets/Assets'))
const AssetDetail = lazy(() => import('./pages/assets/AssetDetail'))
const ITLogs = lazy(() => import('./pages/assets/ITLogs'))
const QuickActions = lazy(() => import('./pages/assets/QuickActions'))
const Documents = lazy(() => import('./pages/assets/Documents'))
const EmployeeDetail = lazy(() => import('./pages/assets/EmployeeDetail'))
const EmployeesPage = lazy(() => import('./pages/assets/EmployeesPage'))
const ResetPassword = lazy(() => import('./pages/ResetPassword'))
const Records = lazy(() => import('./pages/Records'))
const RecordDetail = lazy(() => import('./pages/RecordDetail'))
const Renewals = lazy(() => import('./pages/Renewals'))
const AutoRenewalLog = lazy(() => import('./pages/AutoRenewalLog'))
const Reports = lazy(() => import('./pages/reports/Reports'))
const Notifications = lazy(() => import('./pages/Notifications'))
const RecordTypes = lazy(() => import('./pages/RecordTypes'))
const AuditLogs = lazy(() => import('./pages/AuditLogs'))
const Settings = lazy(() => import('./pages/Settings'))
const NotFound = lazy(() => import('./pages/NotFound'))
const SystemGuide = lazy(() => import('./pages/SystemGuide'))
const Trash = lazy(() => import('./pages/Trash'))

function AuthBootstrap({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  const user = useAuthStore((s) => s.user)
  const setUser = useAuthStore((s) => s.setUser)
  const [booting, setBooting] = useState(false)

  useEffect(() => {
    if (isAuthenticated && !user) {
      setBooting(true)
      api.get('/auth/me')
        .then((res) => setUser(res.data))
        .catch(() => useAuthStore.getState().logout())
        .finally(() => setBooting(false))
    }
  }, [isAuthenticated, user, setUser])

  if (booting) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-300 border-t-gray-800" />
      </div>
    )
  }
  return <>{children}</>
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated)
  if (!isAuthenticated) return <Navigate to="/login" replace />
  return <>{children}</>
}

/** Permission required to open each route. `null` = open to every signed-in user. */
const ROUTE_PERMISSIONS: { path: string; permission: string | null }[] = [
  { path: '/dashboard', permission: 'record.view' },
  { path: '/dashboard', permission: 'asset.view' },
  { path: '/records', permission: 'record.view' },
  { path: '/assets', permission: 'asset.view' },
  { path: '/it-logs', permission: 'itlog.view' },
  { path: '/documents', permission: 'document.view' },
  { path: '/employees', permission: 'employee.view' },
  { path: '/renewals', permission: 'reminder.view' },
  { path: '/reports', permission: 'report.view' },
  { path: '/notifications', permission: 'notification.view' },
  { path: '/record-types', permission: 'record_type.view' },
  { path: '/users', permission: 'user.view' },
  { path: '/settings', permission: null },
]

function useFirstAllowedPath() {
  const hasPermission = useAuthStore((s) => s.hasPermission)
  const first = ROUTE_PERMISSIONS.find((r) => !r.permission || hasPermission(r.permission))
  return first?.path || '/settings'
}

/** Sends the user to the first page they are allowed to open. */
function HomeRedirect() {
  const firstAllowed = useFirstAllowedPath()
  return <Navigate to={firstAllowed} replace />
}

/** Hides a route entirely when the signed-in user lacks its permission. */
function RequirePermission({ permission, children }: { permission: string | string[] | null; children: React.ReactNode }) {
  const allowed = useAuthStore(({ hasPermission }) => !permission || (Array.isArray(permission) ? permission.some(hasPermission) : hasPermission(permission)))
  const navigate = useNavigate()
  const firstAllowed = useFirstAllowedPath()

  if (allowed) return <>{children}</>

  return (
    <div className="mx-auto mt-12 max-w-md rounded-lg border bg-white p-6 text-center shadow-sm">
      <h1 className="text-lg font-semibold text-gray-900">Access denied</h1>
      <p className="mt-1.5 text-sm text-gray-500">You don&apos;t have permission to view this page.</p>
      <button
        className="mt-4 rounded-md border border-input bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        onClick={() => navigate(firstAllowed)}
      >
        Go back
      </button>
    </div>
  )
}

function ActivityIndex() {
  const isSystemAdmin = useAuthStore(s => s.user?.is_superuser)
  return isSystemAdmin ? <AuditLogs /> : <Navigate to="/audit-logs/auto-renewals" replace />
}

export default function App() {
  return (
    <AuthBootstrap>
      <BrandingEffect />
      <Suspense fallback={<div role="status" className="flex h-40 items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-primary" /></div>}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
          <Route index element={<HomeRedirect />} />
          <Route path="dashboard" element={<RequirePermission permission={['record.view', 'asset.view']}><Home /></RequirePermission>} />
          <Route path="assets" element={<RequirePermission permission="asset.view"><Assets /></RequirePermission>} />
          <Route path="assets/:id" element={<RequirePermission permission="asset.view"><AssetDetail /></RequirePermission>} />
          <Route path="it-logs" element={<RequirePermission permission="itlog.view"><ITLogs /></RequirePermission>} />
          <Route path="quick-actions" element={<RequirePermission permission={['asset.edit', 'record.edit', 'employee.manage']}><QuickActions /></RequirePermission>} />
          <Route path="documents" element={<RequirePermission permission="document.view"><Documents /></RequirePermission>} />
          <Route path="employees" element={<RequirePermission permission={['employee.view', 'record.view']}><EmployeesPage /></RequirePermission>} />
          <Route path="employees/:id" element={<RequirePermission permission={['employee.view', 'record.view']}><EmployeeDetail /></RequirePermission>} />
          <Route path="asset-settings" element={<Navigate to="/settings/asset-lists" replace />} />
          <Route path="records" element={<RequirePermission permission="record.view"><Records /></RequirePermission>} />
          <Route path="records/:typeSlug" element={<RequirePermission permission="record.view"><Records /></RequirePermission>} />
          <Route path="records/:typeSlug/:id" element={<RequirePermission permission="record.view"><RecordDetail /></RequirePermission>} />
          <Route path="renewals" element={<RequirePermission permission="reminder.view"><Renewals /></RequirePermission>} />
          <Route path="auto-renewals" element={<Navigate to="/audit-logs/auto-renewals" replace />} />
          <Route path="reports" element={<RequirePermission permission="report.view"><Reports /></RequirePermission>} />
          <Route path="notifications" element={<RequirePermission permission="notification.view"><Notifications /></RequirePermission>} />
          <Route path="record-types" element={<RequirePermission permission="record_type.view"><RecordTypes /></RequirePermission>} />
          <Route path="users" element={<Navigate to="/settings/users" replace />} />
          <Route path="audit-logs" element={<RequirePermission permission="record.view"><ActivityLayout /></RequirePermission>}>
            <Route index element={<ActivityIndex />} />
            <Route path="auto-renewals" element={<RequirePermission permission="record.view"><AutoRenewalLog /></RequirePermission>} />
            <Route path="trash" element={<RequirePermission permission="record.view"><Trash /></RequirePermission>} />
          </Route>
          <Route path="settings" element={<Settings />} />
          <Route path="settings/:section" element={<Settings />} />
          <Route path="system-guide" element={<SystemGuide />} />
          <Route path="trash" element={<Navigate to="/audit-logs/trash" replace />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
      </Suspense>
    </AuthBootstrap>
  )
}
