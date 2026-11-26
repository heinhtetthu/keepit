import { ReactNode, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { create } from 'zustand'
import { ArrowLeftRight, FileUp, Handshake, Laptop, Search, UserMinus, UserPlus, Wrench, ClipboardCheck } from 'lucide-react'
import { useAsset, useAssets } from '@workspace/core'
import api from '@/lib/api'
import Modal from '@/components/ui/modal'
import Combobox from '@/components/ui/combobox'
import { Button } from '@/components/ui/button'
import TypeIcon from '@/components/TypeIcon'
import DynamicForm from '@/components/DynamicForm'
import AssetFormDialog from '@/components/assets/AssetFormDialog'
import { BorrowDialog, MaintenanceDialog, RepairDialog } from '@/components/assets/ActionDialogs'
import { UploadDialog } from '@/components/documents/DocumentDialogs'
import EmployeeFormDialog from '@/components/EmployeeFormDialog'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'
import type { RecordType } from '../types'

export const useCreateMenu = create<{ open: boolean; setOpen: (v: boolean) => void }>((set) => ({ open: false, setOpen: (open) => set({ open }) }))

type Action = { key: string; group: 'Records' | 'Assets' | 'People & documents'; title: string; hint: string; icon: ReactNode; run: () => void }
type Pending = { kind: 'record'; type: RecordType } | { kind: 'asset' | 'borrow' | 'employee' | 'upload' } | { kind: 'repair' | 'maintenance'; step: 'pick' | 'form'; assetId?: number }

/** Global Create: every "new thing" in one searchable sheet (press C anywhere). */
export default function CreateMenu() {
  const { open, setOpen } = useCreateMenu()
  const has = useAuthStore((s) => s.hasPermission)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [q, setQ] = useState('')
  const [pending, setPending] = useState<Pending | null>(null)
  const { data: types = [] } = useQuery<RecordType[]>({ queryKey: ['record-types'], queryFn: async () => (await api.get('/record-types')).data, enabled: has('record.create') })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (e.key.toLowerCase() !== 'c' || e.metaKey || e.ctrlKey || e.altKey || t.closest('input,textarea,[contenteditable="true"],[role="dialog"]')) return
      e.preventDefault(); setOpen(true)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [setOpen])

  const actions = useMemo<Action[]>(() => {
    const go = (p: Pending) => () => { setOpen(false); setPending(p) }
    const list: Action[] = []
    const canInType = useAuthStore.getState().canInType
    if (has('record.create')) for (const t of types.filter((x) => canInType('record.create', x.id))) list.push({ key: `rt-${t.id}`, group: 'Records', title: t.name, hint: t.description || `New ${t.name.toLowerCase()} record`, icon: <TypeIcon icon={t.icon} className="h-[18px] w-[18px]" />, run: go({ kind: 'record', type: t }) })
    if (has('asset.create')) list.push({ key: 'asset', group: 'Assets', title: 'Asset', hint: 'Laptop, monitor, phone…', icon: <Laptop className="h-[18px] w-[18px]" />, run: go({ kind: 'asset' }) })
    if (has('itlog.manage')) {
      list.push({ key: 'borrow', group: 'Assets', title: 'Lend an item', hint: 'Record a borrow with a due date', icon: <Handshake className="h-[18px] w-[18px]" />, run: go({ kind: 'borrow' }) })
      list.push({ key: 'repair', group: 'Assets', title: 'Log a repair', hint: 'Issue, vendor and cost', icon: <Wrench className="h-[18px] w-[18px]" />, run: go({ kind: 'repair', step: 'pick' }) })
      list.push({ key: 'maint', group: 'Assets', title: 'Log maintenance', hint: 'Checklist for a device', icon: <ClipboardCheck className="h-[18px] w-[18px]" />, run: go({ kind: 'maintenance', step: 'pick' }) })
    }
    if (has('asset.edit')) list.push({ key: 'assign', group: 'Assets', title: 'Assign assets', hint: 'Equip a new hire in one go', icon: <ArrowLeftRight className="h-[18px] w-[18px]" />, run: () => { setOpen(false); navigate('/quick-actions?tab=assign') } })
    if (has('employee.manage')) list.push({ key: 'emp', group: 'People & documents', title: 'Employee', hint: 'Add someone to the directory', icon: <UserPlus className="h-[18px] w-[18px]" />, run: go({ kind: 'employee' }) })
    if (has('document.upload')) list.push({ key: 'doc', group: 'People & documents', title: 'Upload document', hint: 'Invoice, warranty, contract…', icon: <FileUp className="h-[18px] w-[18px]" />, run: go({ kind: 'upload' }) })
    if (has('asset.edit') || has('record.edit')) list.push({ key: 'off', group: 'People & documents', title: 'Offboard someone', hint: 'Return assets, release seats', icon: <UserMinus className="h-[18px] w-[18px]" />, run: () => { setOpen(false); navigate('/quick-actions?tab=offboard') } })
    return list
  }, [types, has, navigate, setOpen])

  const needle = q.trim().toLowerCase()
  const shown = actions.filter((a) => !needle || `${a.title} ${a.hint} ${a.group}`.toLowerCase().includes(needle))
  const groups = (['Records', 'Assets', 'People & documents'] as const).map((g) => ({ g, items: shown.filter((a) => a.group === g) })).filter((x) => x.items.length)
  const close = () => { setOpen(false); setQ('') }

  return (
    <>
      {open && (
        <Modal size="xl" title="Create" subtitle={<>Pick what you want to add.<span className="hidden sm:inline"> Tip: press <kbd className="rounded border px-1 text-[11px]">C</kbd> anywhere.</span></>} onClose={close}>
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search: laptop, license, repair…"
              onKeyDown={(e) => { if (e.key === 'Enter' && shown[0]) { e.preventDefault(); shown[0].run() } }}
              className="h-11 w-full rounded-xl border border-input bg-gray-50 pl-9 pr-3 text-sm text-gray-900 outline-none transition focus:border-primary focus:bg-white focus:shadow-glow" />
          </div>
          {!groups.length && <p className="py-8 text-center text-sm text-gray-500">Nothing to create matches “{q}”.</p>}
          <div className={cn('grid gap-5', groups.length >= 3 ? 'md:grid-cols-3' : groups.length === 2 ? 'md:grid-cols-2' : '')}>
            {groups.map(({ g, items }) => (
              <section key={g}>
                <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{g}</h3>
                <div className="grid gap-1.5">
                  {items.map((a, i) => (
                    <button key={a.key} onClick={a.run} style={{ animationDelay: `${i * 25}ms` }}
                      className="press group flex animate-page-in items-center gap-3 rounded-xl border border-transparent px-3 py-2.5 text-left hover:border-gray-200 hover:bg-gray-50 focus-visible:border-primary focus-visible:outline-none [animation-fill-mode:both]">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary transition-transform duration-200 group-hover:scale-105">{a.icon}</span>
                      <span className="min-w-0"><span className="block truncate text-sm font-medium text-gray-900">{a.title}</span><span className="block truncate text-xs text-gray-500">{a.hint}</span></span>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </Modal>
      )}

      {pending?.kind === 'record' && <DynamicForm recordType={pending.type} onClose={() => setPending(null)} onSaved={() => { qc.invalidateQueries({ queryKey: ['records'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }} />}
      {pending?.kind === 'asset' && <AssetFormDialog onClose={() => setPending(null)} onSaved={(a) => navigate(`/assets/${a.id}`)} />}
      {pending?.kind === 'borrow' && <BorrowDialog onClose={() => setPending(null)} />}
      {pending?.kind === 'employee' && <EmployeeFormDialog onClose={() => setPending(null)} />}
      {pending?.kind === 'upload' && <UploadDialog onClose={() => setPending(null)} />}
      {(pending?.kind === 'repair' || pending?.kind === 'maintenance') && pending.step === 'pick' && (
        <PickAsset title={pending.kind === 'repair' ? 'Log a repair' : 'Log maintenance'} onClose={() => setPending(null)} onPick={(id) => setPending({ ...pending, step: 'form', assetId: id })} />
      )}
      {(pending?.kind === 'repair' || pending?.kind === 'maintenance') && pending.step === 'form' && <PickedAssetDialog kind={pending.kind} assetId={pending.assetId!} onClose={() => setPending(null)} />}
    </>
  )
}

function PickAsset({ title, onClose, onPick }: { title: string; onClose: () => void; onPick: (id: number) => void }) {
  const { data } = useAssets({ page_size: 500, sort: 'brand', order: 'asc' })
  const [id, setId] = useState<number | null>(null)
  return (
    <Modal title={title} subtitle="Which asset?" onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!id} onClick={() => id && onPick(id)}>Continue</Button></>}>
      <Combobox autoOpen value={id ? String(id) : null} onChange={(v) => setId(v ? Number(v) : null)} placeholder="Search by brand, model or serial…"
        options={(data?.items ?? []).map((a) => ({ value: String(a.id), label: a.display_name, sublabel: [a.asset_type, a.employee?.name].filter(Boolean).join(' · ') }))} />
    </Modal>
  )
}

function PickedAssetDialog({ kind, assetId, onClose }: { kind: 'repair' | 'maintenance'; assetId: number; onClose: () => void }) {
  const { data: asset } = useAsset(assetId)
  if (!asset) return null
  return kind === 'repair' ? <RepairDialog asset={asset} onClose={onClose} /> : <MaintenanceDialog asset={asset} onClose={onClose} />
}
