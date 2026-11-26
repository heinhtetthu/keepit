import { ReactNode, useState } from 'react'
import { useEmployees, errorMessage } from '@workspace/core'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import Combobox from '@/components/ui/combobox'
import Modal from '@/components/ui/modal'
import { toast } from '@/components/ui/toaster'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'

export function Field({ label, children, hint, className, required }: { label: string; children: ReactNode; hint?: string; className?: string; required?: boolean }) {
  return (
    <label className={cn('block space-y-1', className)}>
      <span className="text-xs font-medium text-gray-600">{label}{required && <span className="text-red-500"> *</span>}</span>
      {children}
      {hint && <span className="block text-[11px] text-gray-400">{hint}</span>}
    </label>
  )
}

const ASSIGN_STYLE: Record<string, string> = {
  Assigned: 'bg-blue-50 text-blue-700 border-blue-200',
  Unassigned: 'bg-gray-50 text-gray-600 border-gray-200',
  Borrowed: 'bg-violet-50 text-violet-700 border-violet-200',
}
const CONDITION_STYLE: Record<string, string> = {
  Operational: 'bg-green-50 text-green-700 border-green-200',
  'In Repair': 'bg-amber-50 text-amber-700 border-amber-200',
  'Written-Off': 'bg-red-50 text-red-700 border-red-200',
}

export function AssignmentBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn('font-medium', ASSIGN_STYLE[status])}>{status}</Badge>
}
export function ConditionBadge({ status }: { status: string }) {
  return <Badge variant="outline" className={cn('font-medium', CONDITION_STYLE[status])}>{status}</Badge>
}

export function useCan() {
  return useAuthStore((s) => s.hasPermission)
}

/** Searchable active-employee picker. */
export function EmployeePicker({ value, onChange, includeInactive, placeholder = 'Pick an employee…', autoOpen }: {
  value: number | null; onChange: (id: number | null) => void; includeInactive?: boolean; placeholder?: string; autoOpen?: boolean
}) {
  const { data = [] } = useEmployees(includeInactive)
  return (
    <Combobox
      autoOpen={autoOpen}
      value={value ? String(value) : null}
      onChange={(v) => onChange(v ? Number(v) : null)}
      placeholder={placeholder}
      searchPlaceholder="Search by name, email or unit…"
      options={data.map((e) => ({
        value: String(e.id), label: e.name,
        sublabel: [e.title, (e.business_units ?? []).join(', '), e.active ? null : 'Inactive'].filter(Boolean).join(' · ') || undefined,
        keywords: `${e.email ?? ''} ${(e.business_units ?? []).join(' ')}`,
      }))}
    />
  )
}

/** Small confirm dialog for destructive actions. */
export function useConfirm() {
  const [state, setState] = useState<{ title: string; body: ReactNode; action: () => Promise<unknown>; label: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const dialog = state && (
    <Modal title={state.title} size="sm" onClose={() => setState(null)} footer={<>
      <Button variant="outline" onClick={() => setState(null)}>Cancel</Button>
      <Button variant="destructive" disabled={busy} onClick={async () => {
        setBusy(true)
        try { await state.action(); setState(null) } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
      }}>{busy ? 'Working…' : state.label}</Button>
    </>}>
      <div className="text-sm text-gray-600">{state.body}</div>
    </Modal>
  )
  return { confirm: (title: string, body: ReactNode, action: () => Promise<unknown>, label = 'Confirm') => setState({ title, body, action, label }), dialog }
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      {icon && <div className="text-gray-300">{icon}</div>}
      <p className="text-sm font-medium text-gray-700">{title}</p>
      {children && <div className="text-sm text-gray-500 max-w-sm">{children}</div>}
    </div>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (t: T) => void }) {
  return (
    <div role="tablist" className="flex gap-1 overflow-x-auto border-b">
      {tabs.map((t) => (
        <button key={t.key} role="tab" aria-selected={value === t.key} onClick={() => onChange(t.key)}
          className={cn('whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors -mb-px',
            value === t.key ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
          {t.label}{t.count !== undefined && <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 text-[11px] text-gray-500">{t.count}</span>}
        </button>
      ))}
    </div>
  )
}

export const inputCls = 'flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
