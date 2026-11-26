import { useEffect, useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Eye, EyeOff, Laptop, Database, Pencil, ShieldCheck, Sparkles, Building2, X } from 'lucide-react'
import { errorMessage } from '@workspace/core'
import api from '@/lib/api'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import TypeIcon from '@/components/TypeIcon'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'

type LevelKey = 'none' | 'viewer' | 'editor' | 'manager'
export interface LevelInfo { key: LevelKey; title: string; description: string; can: string[]; cannot: string[] }
export interface AccessCatalog {
  assets: { title: string; summary: string; levels: LevelInfo[] }
  records: { title: string; summary: string; levels: LevelInfo[] }
  workspace: { title: string; description: string }
  assistant: { title: string; description: string }
  superuser: { title: string; description: string }
  grants: { title: string; description: string }
  record_types: { id: number; name: string; icon: string | null }[]
}
export interface AccessProfile {
  assets: LevelKey; records: LevelKey; workspace_admin: boolean; assistant: boolean; superuser: boolean
  grants: { record_type_id: number; access: 'view' | 'edit' }[]; custom_role_ids: number[]
}

export function useAccessCatalog(enabled = true) {
  return useQuery<AccessCatalog>({ queryKey: ['access-catalog'], queryFn: async () => (await api.get('/users/access-catalog')).data, staleTime: 5 * 60_000, enabled })
}

function LevelPicker({ levels, value, onChange, disabled }: { levels: LevelInfo[]; value: LevelKey; onChange: (v: LevelKey) => void; disabled?: boolean }) {
  const current = levels.find((l) => l.key === value)
  return (
    <div className="space-y-2">
      <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-xl bg-gray-100 p-1 sm:grid-cols-4">
        {levels.map((l) => (
          <button key={l.key} type="button" role="radio" aria-checked={value === l.key} disabled={disabled} onClick={() => onChange(l.key)}
            className={cn('press rounded-lg px-2 py-1.5 text-sm font-medium', value === l.key ? 'bg-white text-primary shadow-soft' : 'text-gray-600 hover:text-gray-900')}>
            {l.title}
          </button>
        ))}
      </div>
      {current && (
        <div key={current.key} className="animate-pop-in rounded-xl border bg-gray-50/70 p-3 text-sm">
          <p className="text-gray-700">{current.description}</p>
          {(current.can.length > 0 || current.cannot.length > 0) && (
            <div className="mt-2 grid gap-x-4 gap-y-1 sm:grid-cols-2">
              <ul className="space-y-1">{current.can.map((c) => <li key={c} className="flex gap-1.5 text-xs text-gray-600"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-green-600" />{c}</li>)}</ul>
              <ul className="space-y-1">{current.cannot.map((c) => <li key={c} className="flex gap-1.5 text-xs text-gray-500"><X className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray-400" />{c}</li>)}</ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function Toggle({ checked, onChange, disabled, icon: Icon, title, description }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; icon: typeof Laptop; title: string; description: string }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors', checked ? 'border-primary/40 bg-primary-soft' : 'hover:bg-gray-50', disabled && 'cursor-not-allowed opacity-60')}>
      <Icon className={cn('mt-0.5 h-4 w-4 shrink-0', checked ? 'text-primary' : 'text-gray-400')} />
      <span className="flex-1"><span className="block text-sm font-medium text-gray-900">{title}</span><span className="block text-xs text-gray-500">{description}</span></span>
      <span className={cn('relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-primary' : 'bg-gray-300')}>
        <span className={cn('absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-4' : 'translate-x-0.5')} />
      </span>
      <input type="checkbox" className="sr-only" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

/** One place to set everything a person may do, with an explanation of each choice. */
export default function AccessDialog({ user, onClose }: { user: { id: number; name: string }; onClose: () => void }) {
  const qc = useQueryClient()
  const me = useAuthStore((s) => s.user)
  const isAdmin = !!me?.is_superuser
  const { data: cat } = useAccessCatalog()
  const { data: current } = useQuery<AccessProfile>({ queryKey: ['user-access', user.id], queryFn: async () => (await api.get(`/users/${user.id}/access`)).data })
  const [p, setP] = useState<AccessProfile | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { if (current && !p) setP(current) }, [current, p])
  const grants = useMemo(() => new Map((p?.grants ?? []).map((g) => [g.record_type_id, g.access])), [p])

  if (!cat || !p) return <Modal title={`Access for ${user.name}`} onClose={onClose}><div className="skeleton h-64" /></Modal>
  const set = (patch: Partial<AccessProfile>) => setP({ ...p, ...patch })
  const setGrant = (id: number, access: 'none' | 'view' | 'edit') =>
    set({ grants: [...p.grants.filter((g) => g.record_type_id !== id), ...(access === 'none' ? [] : [{ record_type_id: id, access }])] })
  const recordsOff = p.records === 'none' || p.superuser
  const editCapable = p.records === 'editor' || p.records === 'manager'

  const save = async () => {
    setBusy(true)
    try {
      await api.put(`/users/${user.id}/access`, p)
      qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['user-access', user.id] })
      toast.success(`Access updated for ${user.name}. It applies the next time they sign in.`)
      onClose()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }

  return (
    <Modal size="xl" title={`Access for ${user.name}`} subtitle="Assets and records are set separately, then each record type is View or Edit." onClose={onClose}
      footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!isAdmin || busy} onClick={save}>{busy ? 'Saving…' : 'Save access'}</Button></>}>
      <div className="space-y-6">
        {!isAdmin && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-800">Only a system administrator can change access. You can review it here.</p>}
        <Toggle icon={ShieldCheck} checked={p.superuser} disabled={!isAdmin || user.id === me?.id} onChange={(v) => set({ superuser: v })} title={cat.superuser.title} description={cat.superuser.description} />

        <fieldset disabled={p.superuser || !isAdmin} className={cn('space-y-6', p.superuser && 'pointer-events-none opacity-50')}>
          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Laptop className="h-4 w-4 text-primary" />{cat.assets.title}</h3>
            <p className="text-xs text-gray-500">{cat.assets.summary}</p>
            <LevelPicker levels={cat.assets.levels} value={p.assets} onChange={(v) => set({ assets: v })} />
          </section>

          <section className="space-y-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold text-gray-900"><Database className="h-4 w-4 text-primary" />{cat.records.title}</h3>
            <p className="text-xs text-gray-500">{cat.records.summary}</p>
            <LevelPicker levels={cat.records.levels} value={p.records} onChange={(v) => set({ records: v })} />
            <div className={cn('mt-3 rounded-xl border', recordsOff && 'opacity-50')}>
              <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
                <p className="text-xs font-medium text-gray-700">{cat.grants.title}</p>
                <div className="flex gap-1 text-[11px]">
                  <button type="button" className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100" onClick={() => set({ grants: cat.record_types.map((t) => ({ record_type_id: t.id, access: editCapable ? 'edit' : 'view' })) })}>All {editCapable ? 'edit' : 'view'}</button>
                  <button type="button" className="rounded px-1.5 py-0.5 text-gray-500 hover:bg-gray-100" onClick={() => set({ grants: [] })}>None</button>
                </div>
              </div>
              <p className="px-3 pt-2 text-xs text-gray-500">{cat.grants.description}</p>
              <ul className="divide-y">
                {cat.record_types.map((t) => {
                  const g = grants.get(t.id) ?? 'none'
                  return (
                    <li key={t.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <TypeIcon icon={t.icon} className="h-4 w-4 text-gray-500" />
                      <span className="flex-1 text-sm text-gray-800">{t.name}</span>
                      <div role="radiogroup" aria-label={`${t.name} access`} className="flex rounded-lg bg-gray-100 p-0.5 text-xs font-medium">
                        {([['none', 'Hidden', EyeOff], ['view', 'View', Eye], ['edit', 'Edit', Pencil]] as const).map(([k, label, I]) => (
                          <button key={k} type="button" role="radio" aria-checked={g === k} disabled={recordsOff}
                            title={k === 'edit' && !editCapable ? 'Needs Records level Editor or Manager to take effect' : undefined}
                            onClick={() => setGrant(t.id, k)}
                            className={cn('press inline-flex items-center gap-1 rounded-md px-2 py-1', g === k ? 'bg-white text-primary shadow-soft' : 'text-gray-500 hover:text-gray-800')}>
                            <I className="h-3 w-3" />{label}
                          </button>
                        ))}
                      </div>
                      {g === 'edit' && !editCapable && !recordsOff && <span className="w-full text-[11px] text-amber-700">Acts as View until the Records level is Editor or Manager.</span>}
                    </li>
                  )
                })}
              </ul>
            </div>
          </section>

          <section className="grid gap-2 sm:grid-cols-2">
            <Toggle icon={Building2} checked={p.workspace_admin} onChange={(v) => set({ workspace_admin: v })} title={cat.workspace.title} description={cat.workspace.description} />
            <Toggle icon={Sparkles} checked={p.assistant} onChange={(v) => set({ assistant: v })} title={cat.assistant.title} description={cat.assistant.description} />
          </section>
        </fieldset>
      </div>
    </Modal>
  )
}
