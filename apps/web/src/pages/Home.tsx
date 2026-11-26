import { lazy, Suspense } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeftRight, FileUp, Handshake, Plus } from 'lucide-react'
import { useAuthStore } from '../store/auth'
import { useCreateMenu } from '../components/CreateMenu'
const Dashboard = lazy(() => import('./Dashboard'))
const AssetDashboard = lazy(() => import('../components/assets/AssetDashboard'))

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
}

/** One home: greeting + quick actions, then asset and renewal overviews by permission. */
export default function Home() {
  const has = useAuthStore((s) => s.hasPermission)
  const name = useAuthStore((s) => s.user?.name?.split(' ')[0])
  const openCreate = useCreateMenu((s) => s.setOpen)
  const navigate = useNavigate()
  const quick = [
    { label: 'Create', icon: Plus, run: () => openCreate(true), show: true, primary: true },
    { label: 'Assign assets', icon: ArrowLeftRight, run: () => navigate('/quick-actions?tab=assign'), show: has('asset.edit') },
    { label: 'Lend an item', icon: Handshake, run: () => navigate('/it-logs?tab=borrows'), show: has('itlog.manage') },
    { label: 'Upload document', icon: FileUp, run: () => navigate('/documents'), show: has('document.upload') },
  ].filter((q) => q.show)
  return (
    <div className="space-y-8">
      <section className="relative overflow-hidden rounded-2xl border bg-gradient-to-br from-primary-soft via-white to-white p-6 shadow-soft sm:p-8">
        <div className="pointer-events-none absolute -right-16 -top-20 h-64 w-64 rounded-full bg-primary/15 blur-3xl" />
        <p className="text-sm font-medium text-primary">{new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-gray-900 sm:text-3xl">{greeting()}{name ? `, ${name}` : ''}</h1>
        <p className="mt-1 max-w-xl text-sm text-gray-500">Here's what needs attention across your assets and renewals.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {quick.map((q) => (
            <button key={q.label} onClick={q.run}
              className={q.primary
                ? 'press inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-soft hover:bg-primary/90'
                : 'press inline-flex h-10 items-center gap-2 rounded-lg border bg-white/80 px-4 text-sm font-medium text-gray-700 shadow-soft hover:bg-white'}>
              <q.icon className="h-4 w-4" />{q.label}
            </button>
          ))}
        </div>
      </section>
      <Suspense fallback={<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <div key={i} className="skeleton h-28" />)}</div>}>
        {has('asset.view') && <AssetDashboard />}
        {has('record.view') && <Dashboard />}
      </Suspense>
    </div>
  )
}
