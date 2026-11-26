import { ReactNode, useRef, useState } from 'react'
import { Link, NavLink, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import {
  ArrowLeft, Banknote, Bell, Boxes, Building2, Camera, ChevronRight, Hash, KeyRound, LayoutTemplate, ListChecks,
  Palette, Search, ShieldCheck, Sparkles, Upload, UserRound, Users as UsersIcon, Activity,
} from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '../store/auth'
import UsersPanel from './Users'
import SearchableSelect from '../components/SearchableSelect'
import MfaSettings from '../components/MfaSettings'
import { PasskeysCard, TokensCard } from '../components/AccountExtras'
import { ThemeSegmented } from '../components/ThemeToggle'
import { SecurityHealth } from '../components/OperationsPanel'
import { AI, Alerts, Currency, LISTS, RefList, Serials, Templates } from './assets/assetSettingsSections'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import { errorMessage } from '@workspace/core'
import { BrandLogo, DEFAULT_PRIMARY, brandCss, useBranding } from '@/lib/branding'

type Section = {
  id: string; group: string; title: string; description: string; icon: typeof UserRound
  allowed: (has: (p: string) => boolean, admin: boolean) => boolean; render: () => ReactNode
}

const SECTIONS: Section[] = [
  { id: 'profile', group: 'Your account', title: 'Profile', description: 'Your name, username and photo.', icon: UserRound, allowed: () => true, render: () => <ProfileSection /> },
  { id: 'security', group: 'Your account', title: 'Password & security', description: 'Password, authenticator app, passkeys and API tokens.', icon: KeyRound, allowed: () => true, render: () => <SecuritySection /> },
  { id: 'general', group: 'Workspace', title: 'General', description: 'Workspace name, timezone and version.', icon: Building2, allowed: (h) => h('settings.view'), render: () => <GeneralSection /> },
  { id: 'appearance', group: 'Workspace', title: 'Appearance', description: 'Theme, primary colour, logo and favicon.', icon: Palette, allowed: () => true, render: () => <AppearanceSection /> },
  { id: 'currency', group: 'Workspace', title: 'Currency', description: 'Default currency and exchange rates for costs.', icon: Banknote, allowed: (h) => h('settings.edit'), render: () => <Currency /> },
  { id: 'notifications', group: 'Workspace', title: 'Notifications', description: 'Telegram delivery and the daily asset digest.', icon: Bell, allowed: (h) => h('settings.view'), render: () => <NotificationsSection /> },
  { id: 'ai', group: 'Workspace', title: 'AI', description: 'Provider for the Ask Keepit assistant.', icon: Sparkles, allowed: (_h, admin) => admin, render: () => <AI /> },
  { id: 'health', group: 'Workspace', title: 'System health', description: 'Encryption, backups and audit integrity.', icon: Activity, allowed: (h) => h('settings.view'), render: () => <SecurityHealth /> },
  { id: 'users', group: 'People', title: 'Users & roles', description: 'Who can sign in and what each role may do.', icon: ShieldCheck, allowed: (h) => h('user.view'), render: () => <UsersPanel /> },
  { id: 'asset-lists', group: 'Assets', title: 'Lists', description: 'Asset types, brands, locations, regions and vendors.', icon: ListChecks, allowed: (h) => h('reference.manage'), render: () => <div className="grid gap-4 md:grid-cols-2">{LISTS.map((l) => <RefList key={l.kind} kind={l.kind} label={l.label} />)}</div> },
  { id: 'spec-templates', group: 'Assets', title: 'Spec templates', description: 'Which specification fields each asset type shows.', icon: LayoutTemplate, allowed: (h) => h('reference.manage'), render: () => <Templates /> },
  { id: 'auto-numbers', group: 'Assets', title: 'Auto numbers', description: 'Generate product numbers like UPS-26-0001.', icon: Hash, allowed: (h) => h('reference.manage'), render: () => <Serials /> },
]
const GROUPS = ['Your account', 'Workspace', 'People', 'Assets']
const GROUP_ICON: Record<string, typeof UserRound> = { 'Your account': UserRound, Workspace: Building2, People: UsersIcon, Assets: Boxes }
const LEGACY_TABS: Record<string, string> = { account: 'profile', users: 'users', system: 'general' }

export default function Settings() {
  const { section } = useParams()
  const [sp] = useSearchParams()
  const navigate = useNavigate()
  const has = useAuthStore((s) => s.hasPermission)
  const admin = useAuthStore((s) => !!s.user?.is_superuser)
  const [q, setQ] = useState('')
  const visible = SECTIONS.filter((s) => s.allowed(has, admin))

  const legacy = sp.get('tab')
  if (!section && legacy && LEGACY_TABS[legacy]) return <Navigate to={`/settings/${LEGACY_TABS[legacy]}`} replace />
  if (section === 'employees') return <Navigate to="/employees" replace />
  const current = visible.find((s) => s.id === section)
  if (section && !current) return <Navigate to="/settings" replace />

  const nav = (
    <nav aria-label="Settings sections" className="space-y-5">
      {GROUPS.map((g) => {
        const items = visible.filter((s) => s.group === g)
        if (!items.length) return null
        return (
          <div key={g} className="space-y-0.5">
            <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g}</p>
            {items.map((s) => (
              <NavLink key={s.id} to={`/settings/${s.id}`} className={({ isActive }) => cn('press flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm',
                isActive ? 'bg-primary-soft font-medium text-primary' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900')}>
                <s.icon className="h-4 w-4 shrink-0" />{s.title}
              </NavLink>
            ))}
          </div>
        )
      })}
    </nav>
  )

  /* Overview: searchable card grid grouped like the sidebar. */
  if (!current) {
    const needle = q.trim().toLowerCase()
    const hits = visible.filter((s) => !needle || `${s.title} ${s.description} ${s.group}`.toLowerCase().includes(needle))
    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-4">
          <div><h1 className="text-2xl font-semibold tracking-tight text-gray-900">Settings</h1><p className="mt-1 text-sm text-gray-500">Everything you can configure, grouped by who it affects.</p></div>
          <div className="relative ml-auto w-full sm:w-72">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search settings…" aria-label="Search settings"
              onKeyDown={(e) => { if (e.key === 'Enter' && hits[0]) navigate(`/settings/${hits[0].id}`) }}
              className="h-10 w-full rounded-xl border border-input bg-white pl-9 pr-3 text-sm text-gray-900 shadow-soft outline-none transition focus:border-primary focus:shadow-glow" />
          </div>
        </div>
        {GROUPS.map((g) => {
          const items = hits.filter((s) => s.group === g)
          if (!items.length) return null
          const GI = GROUP_ICON[g]
          return (
            <section key={g} className="space-y-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-gray-700"><GI className="h-4 w-4 text-gray-400" />{g}</h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {items.map((s, i) => (
                  <Link key={s.id} to={`/settings/${s.id}`} style={{ animationDelay: `${i * 30}ms` }}
                    className="card-hover group flex animate-page-in items-start gap-3 rounded-xl border bg-white p-4 shadow-soft [animation-fill-mode:both] hover:border-primary/30">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><s.icon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-gray-900">{s.title}</span><span className="mt-0.5 block text-xs leading-relaxed text-gray-500">{s.description}</span></span>
                    <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-gray-300 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
                  </Link>
                ))}
              </div>
            </section>
          )
        })}
        {!hits.length && <p className="rounded-xl border bg-white p-8 text-center text-sm text-gray-500">No settings match “{q}”.</p>}
      </div>
    )
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[220px_1fr]">
      <aside className="hidden lg:block"><div className="sticky top-2">{nav}</div></aside>
      <div className="min-w-0 space-y-5">
        <div>
          <Link to="/settings" className="mb-2 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 lg:hidden"><ArrowLeft className="h-4 w-4" />All settings</Link>
          <p className="text-xs font-medium uppercase tracking-wider text-primary">{current.group}</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-gray-900">{current.title}</h1>
          <p className="mt-1 text-sm text-gray-500">{current.description}</p>
        </div>
        <div key={current.id} className="animate-page-in space-y-4">{current.render()}</div>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ sections */

function Notice({ ok, children }: { ok?: boolean; children: ReactNode }) {
  return <div className={cn('animate-pop-in rounded-lg p-3 text-sm', ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700')}>{children}</div>
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2 py-4 first:pt-0 last:pb-0 sm:grid-cols-[220px_1fr] sm:gap-6">
      <div><p className="text-sm font-medium text-gray-900">{label}</p>{hint && <p className="mt-0.5 text-xs leading-relaxed text-gray-500">{hint}</p>}</div>
      <div className="min-w-0">{children}</div>
    </div>
  )
}

function ProfileSection() {
  const queryClient = useQueryClient()
  const { user: me, setUser } = useAuthStore()
  const [form, setForm] = useState(() => ({ username: me?.username || '', name: me?.name || '' }))
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const refreshMe = async () => setUser((await api.get('/auth/me')).data)
  const fail = (err: any, fallback: string) => setMsg({ ok: false, text: err.response?.data?.error?.message || fallback })
  const avatar = useQuery({ queryKey: ['me-avatar'], queryFn: async () => URL.createObjectURL((await api.get('/users/me/avatar', { responseType: 'blob' })).data), enabled: !!me?.has_avatar, retry: false })
  const save = useMutation({ mutationFn: (p: { username?: string; name?: string }) => api.put('/users/me/profile', p), onSuccess: async () => { setMsg({ ok: true, text: 'Profile updated.' }); await refreshMe() }, onError: (e) => fail(e, 'Failed to update profile') })
  const upload = useMutation({
    mutationFn: (file: File) => { const fd = new FormData(); fd.append('file', file); return api.put('/users/me/avatar', fd) },
    onSuccess: async () => { setMsg({ ok: true, text: 'Photo updated.' }); queryClient.invalidateQueries({ queryKey: ['me-avatar'] }); await refreshMe() }, onError: (e) => fail(e, 'Failed to upload photo'),
  })
  const remove = useMutation({ mutationFn: () => api.delete('/users/me/avatar'), onSuccess: async () => { setMsg({ ok: true, text: 'Photo removed.' }); queryClient.invalidateQueries({ queryKey: ['me-avatar'] }); await refreshMe() }, onError: (e) => fail(e, 'Failed to remove photo') })
  return (
    <Card><CardContent className="pt-5">
      <form className="divide-y" onSubmit={(e) => {
        e.preventDefault()
        const p: { username?: string; name?: string } = {}
        if (form.username !== (me?.username || '')) p.username = form.username.trim().toLowerCase()
        if (form.name !== (me?.name || '')) p.name = form.name.trim()
        if (!Object.keys(p).length) return setMsg({ ok: false, text: 'Nothing to update' })
        save.mutate(p)
      }}>
        {msg && <div className="pb-4"><Notice ok={msg.ok}>{msg.text}</Notice></div>}
        <Row label="Photo" hint="PNG, JPEG or WebP, up to 512 KB.">
          <div className="flex items-center gap-4">
            {avatar.data ? <img src={avatar.data} alt="" className="h-16 w-16 rounded-full border object-cover" />
              : <div className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-gradient text-xl font-semibold text-primary-foreground">{(me?.name || '?').charAt(0).toUpperCase()}</div>}
            <div className="flex gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}><Camera className="h-4 w-4" />Change</Button>
              {me?.has_avatar && <Button type="button" variant="ghost" size="sm" disabled={remove.isPending} onClick={() => remove.mutate()}>Remove</Button>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = '' }} />
          </div>
        </Row>
        <Row label="Display name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Row>
        <Row label="Username" hint="You can sign in with this instead of your email.">
          <Input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} pattern="[a-zA-Z0-9._-]+" spellCheck={false} required />
        </Row>
        <Row label="Email" hint="Ask an administrator to change your sign-in email."><Input value={me?.email ?? ''} disabled /></Row>
        <div className="flex justify-end pt-4"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save profile'}</Button></div>
      </form>
    </CardContent></Card>
  )
}

function SecuritySection() {
  const [f, setF] = useState({ current_password: '', new_password: '', confirm: '' })
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const change = useMutation({
    mutationFn: (p: { current_password: string; new_password: string }) => api.put('/users/me/password', p),
    onSuccess: () => { setMsg({ ok: true, text: 'Password updated.' }); setF({ current_password: '', new_password: '', confirm: '' }) },
    onError: (err: any) => setMsg({ ok: false, text: err.response?.data?.error?.message || 'Failed to change password' }),
  })
  return (
    <>
      <Card>
        <CardHeader className="pb-3"><CardTitle className="flex items-center gap-2 text-base"><KeyRound className="h-4 w-4 text-primary" />Password</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 xl:grid-cols-3" onSubmit={(e) => {
            e.preventDefault()
            if (f.new_password !== f.confirm) return setMsg({ ok: false, text: 'New passwords do not match' })
            change.mutate({ current_password: f.current_password, new_password: f.new_password })
          }}>
            {msg && <div className="xl:col-span-3"><Notice ok={msg.ok}>{msg.text}</Notice></div>}
            <Input type="password" autoComplete="current-password" placeholder="Current password" value={f.current_password} onChange={(e) => setF({ ...f, current_password: e.target.value })} required />
            <Input type="password" autoComplete="new-password" placeholder="New password" minLength={8} value={f.new_password} onChange={(e) => setF({ ...f, new_password: e.target.value })} required />
            <Input type="password" autoComplete="new-password" placeholder="Repeat new password" minLength={8} value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} required />
            <div className="flex justify-end xl:col-span-3"><Button type="submit" disabled={change.isPending}>{change.isPending ? 'Updating…' : 'Update password'}</Button></div>
          </form>
        </CardContent>
      </Card>
      <MfaSettings />
      <div className="grid gap-4 xl:grid-cols-2"><PasskeysCard /><TokensCard /></div>
    </>
  )
}

const PRESETS = ['#3287f0', '#2563eb', '#4f46e5', '#7c3aed', '#0891b2', '#0d9488', '#16a34a', '#ea580c', '#e11d48', '#334155']

function AppearanceSection() {
  const canEdit = useAuthStore((s) => s.hasPermission('settings.edit'))
  return (
    <>
      <Card><CardContent className="pt-5">
        <Row label="Theme" hint="Your own preference. System follows your device and switches automatically.">
          <ThemeSegmented className="max-w-sm" />
        </Row>
      </CardContent></Card>
      {canEdit ? <BrandingCard /> : <p className="text-sm text-gray-500">Workspace colour, logo and favicon are set by an administrator.</p>}
    </>
  )
}

function BrandingCard() {
  const qc = useQueryClient()
  const { data } = useBranding()
  const [color, setColor] = useState<string | null>(null)
  const current = color ?? data?.primary_color ?? DEFAULT_PRIMARY
  const valid = /^#[0-9a-fA-F]{6}$/.test(current)
  const refresh = (b: unknown) => qc.setQueryData(['branding'], b)
  const preview = (hex: string) => {
    if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return
    let tag = document.getElementById('brand-vars') as HTMLStyleElement | null
    if (!tag) { tag = document.createElement('style'); tag.id = 'brand-vars'; document.head.appendChild(tag) }
    tag.textContent = brandCss(hex)
  }
  const pick = (hex: string) => { setColor(hex); preview(hex) }
  const saveColor = useMutation({
    mutationFn: async (hex: string) => (await api.put('/settings/branding', { primary_color: hex })).data,
    onSuccess: (b) => { refresh(b); setColor(null); toast.success('Primary colour saved for everyone') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: 'logo' | 'favicon'; file: File }) => {
      const fd = new FormData(); fd.append('file', file)
      return (await api.put(`/settings/branding/${kind}`, fd)).data
    },
    onSuccess: (b, v) => { refresh(b); toast.success(v.kind === 'logo' ? 'Logo updated' : 'Favicon updated') },
    onError: (e) => toast.error(errorMessage(e)),
  })
  const remove = useMutation({
    mutationFn: async (kind: 'logo' | 'favicon') => (await api.delete(`/settings/branding/${kind}`)).data,
    onSuccess: (b) => { refresh(b); toast.success('Reset to default') },
  })
  const dirty = color !== null && color.toLowerCase() !== (data?.primary_color ?? DEFAULT_PRIMARY)

  const ImageRow = ({ kind, label, hint }: { kind: 'logo' | 'favicon'; label: string; hint: string }) => {
    const ref = useRef<HTMLInputElement>(null)
    const url = kind === 'logo' ? data?.logo_url : data?.favicon_url
    return (
      <Row label={label} hint={hint}>
        <div className="flex flex-wrap items-center gap-4">
          <div className={cn('flex shrink-0 items-center justify-center rounded-xl border bg-gray-50', kind === 'logo' ? 'h-16 w-16' : 'h-12 w-12')}>
            {url ? <img src={url} alt="" className="max-h-[80%] max-w-[80%] object-contain" /> : kind === 'logo' ? <BrandLogo className="h-10 w-10" /> : <img src="/favicon.svg" alt="" className="h-6 w-6" />}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" disabled={upload.isPending} onClick={() => ref.current?.click()}><Upload className="h-4 w-4" />Upload</Button>
            {url && <Button type="button" variant="ghost" size="sm" onClick={() => remove.mutate(kind)}>Use default</Button>}
          </div>
          <input ref={ref} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/x-icon,.ico" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate({ kind, file: f }); e.target.value = '' }} />
        </div>
      </Row>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-2"><CardTitle className="text-base">Workspace brand</CardTitle>
        <p className="text-sm text-gray-500">Applies to everyone, including the sign-in page.</p></CardHeader>
      <CardContent className="divide-y">
        <Row label="Primary colour" hint="Buttons, links, highlights and the active menu item. Dark mode uses a lighter shade automatically.">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Preset colours">
              {PRESETS.map((hex) => (
                <button key={hex} type="button" role="radio" aria-checked={current.toLowerCase() === hex} aria-label={hex} onClick={() => pick(hex)}
                  className={cn('press h-8 w-8 rounded-full ring-offset-2 ring-offset-white transition', current.toLowerCase() === hex ? 'ring-2 ring-gray-900' : 'hover:scale-110')}
                  style={{ background: hex }} />
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative h-10 w-10 shrink-0 cursor-pointer overflow-hidden rounded-lg border shadow-soft" style={{ background: valid ? current : '#fff' }} title="Pick any colour">
                <input type="color" value={valid ? current : DEFAULT_PRIMARY} onChange={(e) => pick(e.target.value)} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom colour" />
              </label>
              <Input className="w-32 font-mono uppercase" value={current} maxLength={7} onChange={(e) => { const v = e.target.value.startsWith('#') ? e.target.value : `#${e.target.value}`; setColor(v); preview(v) }} />
              <Button type="button" size="sm" disabled={!dirty || !valid || saveColor.isPending} onClick={() => saveColor.mutate(current)}>Save colour</Button>
              {dirty && <Button type="button" variant="ghost" size="sm" onClick={() => { setColor(null); preview(data?.primary_color ?? DEFAULT_PRIMARY) }}>Cancel</Button>}
              {!dirty && (data?.primary_color ?? DEFAULT_PRIMARY) !== DEFAULT_PRIMARY && <Button type="button" variant="ghost" size="sm" onClick={() => { pick(DEFAULT_PRIMARY); saveColor.mutate(DEFAULT_PRIMARY) }}>Reset to default</Button>}
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-dashed p-3">
              <span className="text-xs text-gray-500">Preview</span>
              <Button size="sm" type="button">Primary</Button>
              <Button size="sm" type="button" variant="soft">Soft</Button>
              <span className="text-sm font-medium text-primary">Link text</span>
              <span className="rounded-lg bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary">Active item</span>
            </div>
          </div>
        </Row>
        <ImageRow kind="logo" label="Logo" hint="Square works best. PNG, SVG, JPEG or WebP up to 512 KB. Shown in the sidebar and sign-in page." />
        <ImageRow kind="favicon" label="Favicon" hint="The small icon in browser tabs. 32×32 or 64×64 PNG, SVG or ICO." />
      </CardContent>
    </Card>
  )
}

interface AppSettings { app_name: string; timezone: string; telegram_configured: boolean; frontend_url: string | null }

function useAppSettings() {
  return useQuery<AppSettings>({ queryKey: ['app-settings'], queryFn: async () => (await api.get('/settings')).data, retry: 1 })
}

function GeneralSection() {
  const qc = useQueryClient()
  const canEdit = useAuthStore((s) => s.hasPermission('settings.edit'))
  const { data: settings } = useAppSettings()
  const { data: timezones = [] } = useQuery<string[]>({ queryKey: ['timezones'], queryFn: async () => (await api.get('/settings/timezones')).data })
  const [form, setForm] = useState<{ app_name: string; timezone: string } | null>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const brand = form ?? { app_name: settings?.app_name ?? '', timezone: settings?.timezone ?? '' }
  const save = useMutation({
    mutationFn: (p: { app_name: string; timezone: string }) => api.put('/settings', p),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['app-settings'] }); qc.invalidateQueries({ queryKey: ['application-calendar'] }); setMsg({ ok: true, text: 'Settings saved.' }) },
    onError: (err: any) => setMsg({ ok: false, text: err.response?.data?.error?.message || 'Failed to save settings' }),
  })
  return (
    <Card><CardContent className="pt-5">
      <form className="divide-y" onSubmit={(e) => { e.preventDefault(); save.mutate({ app_name: brand.app_name.trim(), timezone: brand.timezone.trim() }) }}>
        {msg && <div className="pb-4"><Notice ok={msg.ok}>{msg.text}</Notice></div>}
        <Row label="Workspace name" hint="Shown in the sidebar, sign-in page and emails.">
          <Input value={brand.app_name} disabled={!canEdit} onChange={(e) => setForm({ ...brand, app_name: e.target.value })} placeholder="Keepit" />
        </Row>
        <Row label="Timezone" hint="Drives renewal-day calculations and the expiring-soon window.">
          <SearchableSelect value={brand.timezone} disabled={!canEdit}
            options={[...new Set([...timezones, brand.timezone].filter(Boolean))].map((value) => ({ value, label: value.replace(/_/g, ' ') }))}
            onChange={(value) => setForm({ ...brand, timezone: String(value) })} placeholder="Search timezones" />
        </Row>
        <Row label="About"><dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-1 text-sm"><dt className="text-gray-500">Version</dt><dd>2.0.0</dd><dt className="text-gray-500">API docs</dt><dd><a href="/docs" target="_blank" rel="noreferrer" className="text-primary hover:underline">/docs</a></dd></dl></Row>
        {canEdit && <div className="flex justify-end pt-4"><Button type="submit" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save changes'}</Button></div>}
      </form>
    </CardContent></Card>
  )
}

function NotificationsSection() {
  const { data: settings } = useAppSettings()
  const canEdit = useAuthStore((s) => s.hasPermission('settings.edit'))
  return (
    <>
      <Card><CardContent className="pt-5">
        <Row label="Telegram delivery" hint="Reminders and the asset digest are sent by the background worker.">
          <div className="flex flex-wrap items-center gap-3">
            <Badge variant={settings?.telegram_configured ? 'success' : 'warning'}>{settings?.telegram_configured ? 'Configured' : 'Not configured'}</Badge>
            <Link to="/notifications" className="text-sm text-primary hover:underline">Manage bots &amp; recipients</Link>
          </div>
          {!settings?.telegram_configured && <p className="mt-2 text-xs text-gray-500">Add a bot under Notifications, or set TELEGRAM_BOT_TOKEN on the server.</p>}
        </Row>
      </CardContent></Card>
      {canEdit && <Alerts />}
    </>
  )
}
