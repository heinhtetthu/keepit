import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, ArrowLeftRight, ArrowRight, BarChart3, BellRing, BookOpen, Compass, Database, Download, ExternalLink, FileText, IdCard,
  KeyRound, Laptop, LayoutDashboard, PlusCircle, RefreshCw, ScrollText, Search, Send, Settings, Shapes, Shield, Sparkles, Trash2, User, Users, Wrench,
} from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { useAuthStore } from '../store/auth'
import { cn } from '@/lib/utils'

interface Section { id: string; title: string; path: string; steps: string[]; group?: string; icon?: string }

const ICONS: Record<string, typeof BookOpen> = {
  compass: Compass, 'layout-dashboard': LayoutDashboard, sparkles: Sparkles, user: User, shield: Shield, database: Database,
  'plus-circle': PlusCircle, 'refresh-cw': RefreshCw, 'bell-ring': BellRing, send: Send, shapes: Shapes, 'bar-chart': BarChart3,
  download: Download, 'scroll-text': ScrollText, trash: Trash2, settings: Settings, users: Users, laptop: Laptop,
  'arrow-left-right': ArrowLeftRight, wrench: Wrench, 'file-text': FileText, 'id-card': IdCard, 'key-round': KeyRound,
}
const GROUP_ORDER = ['Getting started', 'Assets', 'Renewals', 'Insights', 'Your account', 'Administration']

function Highlight({ text, q }: { text: string; q: string }) {
  if (!q) return <>{text}</>
  const i = text.toLowerCase().indexOf(q.toLowerCase())
  if (i < 0) return <>{text}</>
  return <>{text.slice(0, i)}<mark className="rounded bg-amber-100 px-0.5 text-gray-900">{text.slice(i, i + q.length)}</mark>{text.slice(i + q.length)}</>
}

/** Two-pane guide: pick a topic, read it as step cards. No endless scrolling. */
export default function SystemGuide() {
  const user = useAuthStore((s) => s.user)
  const [sp, setSp] = useSearchParams()
  const [search, setSearch] = useState('')
  const { data = [], isLoading, error } = useQuery<Section[]>({ queryKey: ['system-guide', user?.id], queryFn: async () => (await api.get('/help/guide')).data })
  const q = search.trim()
  const sections = useMemo(() => data
    .filter((s) => !q || `${s.title} ${s.steps.join(' ')}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group ?? '') - GROUP_ORDER.indexOf(b.group ?? '')), [data, q])
  const currentId = sp.get('topic')
  const current = sections.find((s) => s.id === currentId) ?? sections[0]
  const idx = current ? sections.indexOf(current) : -1
  const go = (s?: Section) => s && setSp({ topic: s.id }, { replace: true })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input,textarea')) return
      if (e.key === 'ArrowRight') go(sections[idx + 1])
      if (e.key === 'ArrowLeft') go(sections[idx - 1])
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  })

  const groups = GROUP_ORDER.map((g) => ({ g, items: sections.filter((s) => (s.group ?? 'Getting started') === g) })).filter((x) => x.items.length)
  const Icon = current ? ICONS[current.icon ?? ''] ?? BookOpen : BookOpen

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Guide</h1>
          <p className="mt-1 text-sm text-gray-500">Short, practical answers. Topics follow your permissions.</p>
        </div>
        <div className="relative ml-auto w-full sm:w-80">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input aria-label="Search the guide" placeholder="Search: borrow, reminders, passkey…" value={search} onChange={(e) => setSearch(e.target.value)}
            className="h-10 w-full rounded-xl border border-input bg-white pl-9 pr-3 text-sm text-gray-900 shadow-soft outline-none transition focus:border-primary focus:shadow-glow" />
        </div>
      </div>

      {isLoading && <div className="grid gap-4 lg:grid-cols-[260px_1fr]"><div className="skeleton h-80" /><div className="skeleton h-80" /></div>}
      {error && <p role="alert" className="text-sm text-red-600">The guide could not load. Please refresh to try again.</p>}
      {!isLoading && !error && !sections.length && <p className="rounded-xl border bg-white p-8 text-center text-sm text-gray-500">No topics match “{q}”.</p>}

      {current && (
        <div className="grid gap-5 lg:h-[calc(100dvh-12.5rem)] lg:grid-cols-[260px_1fr]">
          {/* Topic list: chips on phones, grouped list on desktop */}
          <nav aria-label="Guide topics" className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:block lg:space-y-4 lg:overflow-y-auto lg:px-0 lg:pr-1">
            {groups.map(({ g, items }) => (
              <div key={g} className="contents lg:block">
                <p className="hidden px-2 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 lg:block">{g}</p>
                {items.map((s) => {
                  const I = ICONS[s.icon ?? ''] ?? BookOpen
                  const active = s.id === current.id
                  return (
                    <button key={s.id} onClick={() => go(s)} aria-current={active ? 'page' : undefined}
                      className={cn('press flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-xl border px-3 py-2 text-left text-sm lg:w-full lg:whitespace-normal lg:border-transparent',
                        active ? 'border-primary/30 bg-primary-soft font-medium text-primary' : 'bg-white text-gray-700 hover:bg-gray-100 lg:bg-transparent')}>
                      <I className={cn('h-4 w-4 shrink-0', active ? 'text-primary' : 'text-gray-400')} />
                      <span className="truncate"><Highlight text={s.title} q={q} /></span>
                    </button>
                  )
                })}
              </div>
            ))}
          </nav>

          <article key={current.id} className="flex animate-slide-in-right flex-col rounded-2xl border bg-white p-5 shadow-soft sm:p-7 lg:min-h-0">
            <div className="flex flex-wrap items-start gap-4">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground shadow-lift"><Icon className="h-6 w-6" /></span>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium uppercase tracking-wider text-primary">{current.group ?? 'Guide'} · {current.steps.length} steps</p>
                <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">{current.title}</h2>
              </div>
              {current.path !== '/system-guide' && (
                <Link to={current.path} className="press inline-flex items-center gap-1.5 rounded-lg border bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-soft hover:bg-gray-50">
                  Open page <ExternalLink className="h-3.5 w-3.5" />
                </Link>
              )}
            </div>
            <ol className="mt-6 grid content-start gap-3 lg:min-h-0 lg:flex-1 lg:overflow-y-auto xl:grid-cols-2">
              {current.steps.map((step, i) => (
                <li key={i} style={{ animationDelay: `${i * 50}ms` }} className="flex animate-page-in gap-3 rounded-xl border bg-gray-50/60 p-4 [animation-fill-mode:both]">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">{i + 1}</span>
                  <p className="text-sm leading-relaxed text-gray-700"><Highlight text={step} q={q} /></p>
                </li>
              ))}
            </ol>
            <div className="mt-6 flex items-center justify-between gap-2 border-t pt-4">
              <Button variant="ghost" size="sm" disabled={idx <= 0} onClick={() => go(sections[idx - 1])}><ArrowLeft className="h-4 w-4" /><span className="hidden sm:inline">{sections[idx - 1]?.title ?? 'Previous'}</span></Button>
              <span className="text-xs text-gray-400">{idx + 1} / {sections.length} · use ← →</span>
              <Button variant="ghost" size="sm" disabled={idx >= sections.length - 1} onClick={() => go(sections[idx + 1])}><span className="hidden sm:inline">{sections[idx + 1]?.title ?? 'Next'}</span><ArrowRight className="h-4 w-4" /></Button>
            </div>
          </article>
        </div>
      )}
    </div>
  )
}
