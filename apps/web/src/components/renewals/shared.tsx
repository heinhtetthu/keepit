import { cn } from '@/lib/utils'

export interface UpcomingItem {
  id: number
  name: string
  status: string
  record_type_id: number
  record_type_name: string
  record_type_slug: string
  record_type_icon: string | null
  expiry_date: string
  days_remaining: number
  auto_renew: boolean | null
  will_auto_renew: boolean
  auto_renew_date: string | null
  cost: unknown
  currency: string | null
  cycle: string | null
  next_reminder: { rule_id: number; name: string; days_before: number; date: string } | null
}

export interface UpcomingResponse {
  today: string
  days: number
  truncated: boolean
  summary: { overdue: number; week: number; month: number; window: number; auto_renew_on: number; auto_renew_off: number; no_reminder: number }
  items: UpcomingItem[]
}

export const intervalLabel = (days: number) => (days === 0 ? 'On the day' : days === 1 ? '1 day before' : `${days} days before`)

/** "in 5 days", "today", "3 days overdue". */
export function dueText(days: number) {
  if (days === 0) return 'Due today'
  if (days === 1) return 'Tomorrow'
  if (days > 0) return `In ${days} days`
  return days === -1 ? '1 day overdue' : `${-days} days overdue`
}

export function dueTone(days: number) {
  if (days < 0) return 'bg-red-50 text-red-700 ring-red-200'
  if (days <= 7) return 'bg-amber-50 text-amber-800 ring-amber-200'
  if (days <= 30) return 'bg-sky-50 text-sky-700 ring-sky-200'
  return 'bg-gray-50 text-gray-600 ring-gray-200'
}

export function DuePill({ days, className }: { days: number; className?: string }) {
  return (
    <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ring-1 ring-inset', dueTone(days), className)}>
      {dueText(days)}
    </span>
  )
}

/** On/off switch used for rule toggles. */
export function Toggle({ checked, onChange, disabled, label }: { checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onChange(!checked) }}
      className={cn(
        'press relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60',
        checked ? 'bg-primary' : 'bg-gray-300',
      )}
    >
      <span className={cn('inline-block h-4 w-4 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[18px]' : 'translate-x-0.5')} />
    </button>
  )
}

export function money(value: unknown, currency?: string | null) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  if (Number.isNaN(n)) return null
  return `${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ''}`
}
