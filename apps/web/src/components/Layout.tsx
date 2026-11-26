import { useEffect, useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, Database, RefreshCw, FileBarChart, Bell, Settings, ScrollText, BookOpen,
  Laptop, Wrench, Zap, FileText, Users, PanelLeftClose, PanelLeftOpen, X, Plus, Menu, Search, Shapes,
} from 'lucide-react'
import { BrandLogo, useBrandName } from '@/lib/branding'
import { useAuthStore } from '../store/auth'
import { pushRecent } from '../store/recent'
import RecentDropdown from './RecentDropdown'
import GlobalSearch from './GlobalSearch'
import CreateMenu, { useCreateMenu } from './CreateMenu'
import UserMenu from './UserMenu'
import ThemeToggle from './ThemeToggle'
import AssistantChat from './AssistantChat'
import ForcePasswordChange from './ForcePasswordChange'
import { Toaster } from './ui/toaster'
import { cn } from '@/lib/utils'

type NavItem = { to: string; icon: typeof LayoutDashboard; label: string; permission: string | string[] }
const navGroups: { label: string | null; items: NavItem[] }[] = [
  { label: null, items: [{ to: '/dashboard', icon: LayoutDashboard, label: 'Dashboard', permission: ['record.view', 'asset.view'] }] },
  { label: 'Assets', items: [
    { to: '/assets', icon: Laptop, label: 'Assets', permission: 'asset.view' },
    { to: '/it-logs', icon: Wrench, label: 'IT Logs', permission: 'itlog.view' },
    { to: '/documents', icon: FileText, label: 'Documents', permission: 'document.view' },
    { to: '/quick-actions', icon: Zap, label: 'Quick Actions', permission: ['asset.edit', 'record.edit', 'employee.manage'] },
  ] },
  { label: 'People', items: [
    { to: '/employees', icon: Users, label: 'Employees', permission: ['employee.view', 'record.view'] },
  ] },
  { label: 'Renewals', items: [
    { to: '/records', icon: Database, label: 'Records', permission: 'record.view' },
    { to: '/renewals', icon: RefreshCw, label: 'Reminders', permission: 'reminder.view' },
    { to: '/notifications', icon: Bell, label: 'Notifications', permission: 'notification.view' },
    { to: '/record-types', icon: Shapes, label: 'Record Types', permission: 'record_type.view' },
  ] },
  { label: 'Insights', items: [
    { to: '/reports', icon: FileBarChart, label: 'Reports', permission: 'report.view' },
    { to: '/audit-logs', icon: ScrollText, label: 'Activity', permission: 'record.view' },
  ] },
]
const PAGES: { prefix: string; label: string }[] = [
  { prefix: '/dashboard', label: 'Dashboard' }, { prefix: '/renewals', label: 'Reminders' }, { prefix: '/reports', label: 'Reports' },
  { prefix: '/notifications', label: 'Notifications' }, { prefix: '/record-types', label: 'Record Types' }, { prefix: '/audit-logs', label: 'Activity' },
  { prefix: '/settings', label: 'Settings' }, { prefix: '/system-guide', label: 'Guide' }, { prefix: '/records', label: 'Records' },
  { prefix: '/assets', label: 'Assets' }, { prefix: '/it-logs', label: 'IT Logs' }, { prefix: '/quick-actions', label: 'Quick Actions' },
  { prefix: '/documents', label: 'Documents' },
  { prefix: '/employees', label: 'Employees' },
]

export default function Layout() {
  const location = useLocation()
  const [drawer, setDrawer] = useState(false)
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem('sidebar-collapsed') === '1' } catch { return false } })
  const [mobileSearch, setMobileSearch] = useState(false)
  const { hasPermission, user } = useAuthStore()
  const openCreate = useCreateMenu((s) => s.setOpen)
  const brand = useBrandName()

  useEffect(() => { try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : '0') } catch { /* ignore */ } }, [collapsed])
  useEffect(() => { setDrawer(false); setMobileSearch(false) }, [location.pathname])
  useEffect(() => { document.title = `${PAGES.find((m) => location.pathname.startsWith(m.prefix))?.label ?? brand} · ${brand}` }, [location.pathname, brand])

  const allowed = (p: string | string[]) => (Array.isArray(p) ? p.some(hasPermission) : hasPermission(p))
  const groups = navGroups.map((g) => ({ ...g, items: g.items.filter((i) => allowed(i.permission)) })).filter((g) => g.items.length)
  const canCreate = ['record.create', 'asset.create', 'itlog.manage', 'employee.manage', 'document.upload'].some(hasPermission)

  useEffect(() => {
    const path = location.pathname
    if (path.startsWith('/records/') || /^\/(assets|employees)\/\d+/.test(path)) return
    const meta = PAGES.find((m) => path.startsWith(m.prefix))
    if (meta) pushRecent({ url: meta.prefix === '/audit-logs' ? meta.prefix : path, label: meta.label, sublabel: 'Page', kind: 'page', icon: null })
  }, [location.pathname])

  const navLink = (item: NavItem, rail: boolean) => (
    <NavLink key={item.to} to={item.to} title={rail ? item.label : undefined}
      className={({ isActive }) => cn(
        'press group relative flex items-center gap-3 rounded-lg px-3 py-2 text-[13.5px] font-medium',
        rail && 'justify-center px-0',
        isActive ? 'bg-primary/10 text-primary' : 'text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground',
      )}>
      {({ isActive }) => (<>
        <span className={cn('absolute left-0 top-1/2 h-5 w-[3px] -translate-y-1/2 rounded-r-full bg-primary transition-all duration-300', isActive ? 'opacity-100' : 'h-0 opacity-0')} />
        <item.icon className={cn('h-[18px] w-[18px] shrink-0 transition-colors', isActive ? 'text-primary' : 'text-sidebar-muted group-hover:text-sidebar-foreground')} />
        {!rail && <span className="truncate">{item.label}</span>}
      </>)}
    </NavLink>
  )

  const sidebar = (rail: boolean) => (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      <div className={cn('flex h-16 shrink-0 items-center gap-2.5 px-4', rail && 'justify-center px-0')}>
        <BrandLogo className="h-8 w-8 shrink-0" />
        {!rail && <span className="truncate text-[17px] font-semibold tracking-tight text-sidebar-foreground">{brand}</span>}
        <button className="ml-auto rounded-lg p-1.5 text-sidebar-muted hover:bg-sidebar-hover lg:hidden" onClick={() => setDrawer(false)} aria-label="Close menu"><X className="h-5 w-5" /></button>
      </div>
      {canCreate && (
        <div className={cn('px-3 pb-3', rail && 'px-2')}>
          <button onClick={() => openCreate(true)} title="Create (C)"
            className={cn('press group flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary font-medium text-primary-foreground shadow-[0_6px_20px_-6px_hsl(var(--primary)/0.7)] hover:bg-primary/90',
              rail ? 'px-0' : 'px-3 text-sm')}>
            <Plus className="h-[18px] w-[18px] transition-transform duration-300 group-hover:rotate-90" />
            {!rail && <><span>Create</span><kbd className="ml-auto rounded border border-current/30 px-1.5 text-[10px] font-medium opacity-70">C</kbd></>}
          </button>
        </div>
      )}
      <nav className={cn('flex-1 space-y-5 overflow-y-auto px-3 pb-4', rail && 'px-2')}>
        {groups.map((g) => (
          <div key={g.label ?? 'top'} className="space-y-0.5">
            {g.label && (rail ? <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" /> : <p className="px-3 pb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-muted/70">{g.label}</p>)}
            {g.items.map((i) => navLink(i, rail))}
          </div>
        ))}
      </nav>
      <div className={cn('space-y-0.5 border-t border-sidebar-border p-3', rail && 'px-2')}>
        {navLink({ to: '/system-guide', icon: BookOpen, label: 'Guide', permission: [] }, rail)}
        {navLink({ to: '/settings', icon: Settings, label: 'Settings', permission: [] }, rail)}
      </div>
    </div>
  )

  return (
    <div className="flex h-[100dvh] bg-background">
      {/* Desktop sidebar (expanded or icon rail) */}
      <aside className={cn('hidden shrink-0 border-r border-sidebar-border transition-[width] duration-300 ease-out lg:block', collapsed ? 'w-[68px]' : 'w-64')}>
        {sidebar(collapsed)}
      </aside>
      {/* Mobile drawer */}
      {drawer && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 animate-fade-in bg-gray-950/60 backdrop-blur-sm" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 max-w-[85vw] animate-slide-in-left shadow-pop">{sidebar(false)}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-2 border-b bg-white/80 px-3 backdrop-blur-xl supports-[backdrop-filter]:bg-white/70 sm:px-5">
          <button onClick={() => setDrawer(true)} className="press rounded-lg p-2 text-gray-600 hover:bg-gray-100 lg:hidden" aria-label="Open menu"><Menu className="h-5 w-5" /></button>
          <button onClick={() => setCollapsed((c) => !c)} className="press hidden rounded-lg p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 lg:inline-flex"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-label="Toggle sidebar">
            {collapsed ? <PanelLeftOpen className="h-[18px] w-[18px]" /> : <PanelLeftClose className="h-[18px] w-[18px]" />}
          </button>
          <BrandLogo className="h-7 w-7 lg:hidden" />
          <div className="hidden min-w-0 flex-1 justify-center md:flex"><GlobalSearch className="max-w-xl" /></div>
          <div className="ml-auto flex shrink-0 items-center gap-1 md:ml-0">
            <button onClick={() => setMobileSearch((v) => !v)} className="press rounded-lg p-2 text-gray-600 hover:bg-gray-100 md:hidden" aria-label="Search"><Search className="h-5 w-5" /></button>
            <RecentDropdown />
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        {mobileSearch && <div className="animate-pop-in border-b bg-white px-3 py-2 md:hidden"><GlobalSearch autoFocus /></div>}

        <main className="flex-1 overflow-auto">
          <div key={location.pathname} className="page-enter mx-auto w-full max-w-[1400px] p-4 pb-28 sm:p-6 lg:pb-8">
            <Outlet />
          </div>
          <Toaster />
        </main>
      </div>

      {/* Phone tab bar */}
      <nav data-bottom-nav className="fixed inset-x-0 bottom-0 z-40 border-t bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden" aria-label="Quick navigation">
        <div className="mx-auto grid h-16 max-w-md grid-cols-5 items-center">
          {[{ to: '/dashboard', icon: LayoutDashboard, label: 'Home', p: ['record.view', 'asset.view'] }, { to: '/assets', icon: Laptop, label: 'Assets', p: 'asset.view' }].map((t) => allowed(t.p) ? (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => cn('flex flex-col items-center gap-0.5 text-[10.5px] font-medium', isActive ? 'text-primary' : 'text-gray-500')}><t.icon className="h-5 w-5" />{t.label}</NavLink>
          ) : <span key={t.to} />)}
          <div className="flex justify-center">
            {canCreate && <button onClick={() => openCreate(true)} aria-label="Create" className="press -mt-6 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-[0_10px_24px_-6px_hsl(var(--primary)/0.7)]"><Plus className="h-6 w-6" /></button>}
          </div>
          {[{ to: '/records', icon: Database, label: 'Records', p: 'record.view' }].map((t) => allowed(t.p) ? (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => cn('flex flex-col items-center gap-0.5 text-[10.5px] font-medium', isActive ? 'text-primary' : 'text-gray-500')}><t.icon className="h-5 w-5" />{t.label}</NavLink>
          ) : <span key={t.to} />)}
          <button onClick={() => setDrawer(true)} className="flex flex-col items-center gap-0.5 text-[10.5px] font-medium text-gray-500"><Menu className="h-5 w-5" />More</button>
        </div>
      </nav>

      <CreateMenu />
      <AssistantChat key={user?.id} />
      <ForcePasswordChange />
    </div>
  )
}
