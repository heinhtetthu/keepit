import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlarmClock, BellRing, CalendarRange, ListChecks, Repeat, TriangleAlert, type LucideIcon } from 'lucide-react'
import api from '@/lib/api'
import { apiError } from '@/lib/seats'
import { useAuthStore } from '../store/auth'
import TypeIcon from '../components/TypeIcon'
import { EmptyRows, useTableState } from '@/components/data-table'
import UpcomingRenewals, { type UpcomingTab } from '@/components/renewals/UpcomingRenewals'
import RuleBuilder from '@/components/renewals/RuleBuilder'
import type { UpcomingResponse } from '@/components/renewals/shared'
import { cn } from '@/lib/utils'
import type { ReminderRule, RecordType } from '../types'

type Section = 'upcoming' | 'rules'
const readWindow = () => { try { return Number(localStorage.getItem('renewals-window')) || 90 } catch { return 90 } }

export default function Renewals() {
  const qc = useQueryClient()
  const { hasPermission, user } = useAuthStore()
  const [sp, setSp] = useSearchParams()
  const canSeeRecords = hasPermission('record.view')
  const section: Section = sp.get('tab') === 'rules' || !canSeeRecords ? 'rules' : 'upcoming'
  const typeParam = Number(sp.get('type')) || null
  const [windowDays, setWindowState] = useState(readWindow)
  const t = useTableState({ key: 'renewals', defaultSort: 'expiry_date', defaultOrder: 'asc', defaultColumns: ['due', 'expiry', 'reminder', 'auto_renew', 'cost'] })

  const { data: rules, isLoading: rulesLoading, error: rulesError } = useQuery<ReminderRule[]>({
    queryKey: ['reminder-rules', user?.id], queryFn: async () => (await api.get('/reminders/rules')).data, retry: 1,
  })
  const { data: recordTypes, isLoading: typesLoading } = useQuery<RecordType[]>({
    queryKey: ['record-types', user?.id], queryFn: async () => (await api.get('/record-types')).data,
  })
  const upcoming = useQuery<UpcomingResponse>({
    queryKey: ['renewals-upcoming', user?.id, windowDays],
    queryFn: async () => (await api.get('/reminders/upcoming', { params: { days: windowDays } })).data,
    enabled: canSeeRecords, retry: 1, placeholderData: (prev) => prev,
  })

  // Types with an expiry field first, then by name.
  const types = useMemo(() => [...(recordTypes || [])].sort((a, b) => Number(!a.reminder_field_id) - Number(!b.reminder_field_id) || a.name.localeCompare(b.name)), [recordTypes])
  const rulesByType = useMemo(() => {
    const m = new Map<number, ReminderRule[]>()
    for (const r of rules || []) m.set(r.record_type_id, [...(m.get(r.record_type_id) || []), r])
    return m
  }, [rules])
  const selected = types.find((x) => x.id === typeParam) ?? types[0]

  const go = (next: Partial<{ tab: Section; type: number | null }>) => {
    const p = new URLSearchParams(sp)
    if (next.tab) { if (next.tab === 'rules') p.set('tab', 'rules'); else p.delete('tab') }
    if (next.type !== undefined) { if (next.type) p.set('type', String(next.type)); else p.delete('type') }
    setSp(p, { replace: true })
  }
  const setWindow = (n: number) => { setWindowState(n); try { localStorage.setItem('renewals-window', String(n)) } catch { /* storage unavailable */ } }
  const pickTab = (tab: UpcomingTab) => { go({ tab: 'upcoming' }); t.setTab(tab) }
  const s = upcoming.data?.summary
  const activeRules = (rules || []).filter((r) => r.active).length

  return (
    <div className="flex min-h-0 flex-col gap-4 animate-page-in">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><BellRing className="h-5 w-5 text-gray-600" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">Renewals &amp; Reminders</h1>
            <p className="truncate text-sm text-gray-500">See what renews next and choose when Telegram reminds your team.</p>
          </div>
        </div>
      </div>

      {canSeeRecords && (
        <div className="grid grid-cols-2 gap-2 sm:gap-3 lg:grid-cols-4">
          <Stat icon={TriangleAlert} label="Overdue" value={s?.overdue} tone="red" hint="Past the renewal date" onClick={() => pickTab('overdue')} active={section === 'upcoming' && t.tab === 'overdue'} />
          <Stat icon={AlarmClock} label="Due this week" value={s?.week} tone="amber" hint="Next 7 days" onClick={() => pickTab('week')} active={section === 'upcoming' && t.tab === 'week'} />
          <Stat icon={CalendarRange} label="Due in 30 days" value={s?.month} tone="sky" hint="Including this week" onClick={() => pickTab('month')} active={section === 'upcoming' && t.tab === 'month'} />
          <Stat icon={Repeat} label="Auto-renew on" value={s?.auto_renew_on} tone="emerald" hint={`Of ${(upcoming.data?.items.length ?? 0)} listed`} onClick={() => pickTab('auto')} active={section === 'upcoming' && t.tab === 'auto'} />
        </div>
      )}

      <div className="-mx-1 flex gap-1 border-b px-1" role="tablist">
        {canSeeRecords && <SectionTab active={section === 'upcoming'} onClick={() => go({ tab: 'upcoming' })} icon={CalendarRange} label="Upcoming" count={upcoming.data ? upcoming.data.summary.window + upcoming.data.summary.overdue : undefined} />}
        <SectionTab active={section === 'rules'} onClick={() => go({ tab: 'rules' })} icon={ListChecks} label="Rules & messages" count={rules ? activeRules : undefined} />
      </div>

      {section === 'upcoming' ? (
        <UpcomingRenewals state={t} data={upcoming.data} loading={upcoming.isLoading} fetching={upcoming.isFetching}
          error={upcoming.error ? apiError(upcoming.error, 'Could not load upcoming renewals.') : null}
          windowDays={windowDays} onWindow={setWindow} recordTypes={types} canRenew={hasPermission('record.edit')}
          onRules={(id) => go({ tab: 'rules', type: id })}
          onRenewed={() => { qc.invalidateQueries({ queryKey: ['renewals-upcoming'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }} />
      ) : rulesLoading || typesLoading ? (
        <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-xl bg-gray-100" />)}</div>
      ) : rulesError ? (
        <div role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">Could not load reminder rules.</div>
      ) : !selected ? (
        <div className="rounded-xl border bg-white"><EmptyRows icon={<ListChecks className="h-9 w-9" />} title="No record types yet" hint="Create a record type with a renewal or expiry date, then set up its reminders here." /></div>
      ) : (
        <div className="grid min-w-0 gap-4 lg:grid-cols-[15rem_minmax(0,1fr)]">
          {/* Type picker: chips on phones, a list on wide screens */}
          <nav aria-label="Record types" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {types.map((rt) => {
              const list = rulesByType.get(rt.id) || []
              const on = list.filter((r) => r.active).length
              const active = rt.id === selected.id
              return (
                <button key={rt.id} onClick={() => go({ type: rt.id })} aria-current={active ? 'true' : undefined}
                  className={cn('press flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2 text-left text-sm lg:w-full',
                    active ? 'border-primary/40 bg-primary/5 text-gray-900' : 'border-transparent bg-white text-gray-600 hover:border-gray-200 hover:bg-gray-50 lg:bg-transparent')}>
                  <TypeIcon icon={rt.icon} className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-gray-400')} />
                  <span className="min-w-0 flex-1 truncate font-medium">{rt.name}</span>
                  {!rt.reminder_field_id
                    ? <span className="rounded-full bg-amber-50 px-1.5 text-[10px] font-medium text-amber-700">Set up</span>
                    : <span className={cn('rounded-full px-1.5 text-[11px] font-semibold tabular-nums', on ? 'bg-primary/10 text-primary' : 'bg-gray-100 text-gray-400')} title={`${on} active of ${list.length}`}>{on}</span>}
                </button>
              )
            })}
          </nav>
          <RuleBuilder key={selected.id} recordType={selected} rules={rulesByType.get(selected.id) || []} />
        </div>
      )}
    </div>
  )
}

const TONES = {
  red: 'bg-red-50 text-red-600', amber: 'bg-amber-50 text-amber-600', sky: 'bg-sky-50 text-sky-600', emerald: 'bg-emerald-50 text-emerald-600',
} as const

function Stat({ icon: Icon, label, value, hint, tone, onClick, active }: {
  icon: LucideIcon; label: string; value?: number; hint: string; tone: keyof typeof TONES; onClick: () => void; active: boolean
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active}
      className={cn('card-hover press flex min-w-0 items-center gap-3 rounded-xl border bg-white p-3 text-left sm:p-4', active && 'border-primary/50 ring-2 ring-primary/15')}>
      <span className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10', TONES[tone])}><Icon className="h-4 w-4 sm:h-5 sm:w-5" /></span>
      <span className="min-w-0">
        <span className="block truncate text-xs font-medium text-gray-500">{label}</span>
        <span className="block text-xl font-semibold tabular-nums text-gray-900 animate-pop-in sm:text-2xl" key={value ?? 'x'}>{value ?? '-'}</span>
        <span className="hidden truncate text-[11px] text-gray-400 sm:block">{hint}</span>
      </span>
    </button>
  )
}

function SectionTab({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick: () => void; icon: LucideIcon; label: string; count?: number }) {
  return (
    <button role="tab" aria-selected={active} onClick={onClick}
      className={cn('-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
        active ? 'border-primary text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-800')}>
      <Icon className={cn('h-4 w-4', active ? 'text-primary' : 'text-gray-400')} />{label}
      {count !== undefined && <span className={cn('rounded-full px-1.5 py-0.5 text-xs tabular-nums', active ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-500')}>{count}</span>}
    </button>
  )
}
