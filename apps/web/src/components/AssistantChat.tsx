import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'react-router-dom'
import { ArrowUp, CalendarClock, Clock, HelpCircle, Laptop, RotateCcw, ShieldCheck, Sparkles, X } from 'lucide-react'
import { useBrandName } from '@/lib/branding'
import api from '@/lib/api'
import { useAuthStore } from '../store/auth'
import AssistantAnswer, { type AnswerTable } from './AssistantAnswer'
import { shuffledQuestions } from '@/lib/assistant-suggestions'
import { cn } from '@/lib/utils'

type Message = { role: 'user' | 'assistant'; content: string; source?: 'guide' | 'records' | 'builtin' | 'ai'; notice?: string; table?: AnswerTable }

const STARTERS = [
  { q: 'Which borrowed items are overdue?', label: 'Overdue borrows', icon: Clock, permission: 'itlog.view' },
  { q: 'Which warranties expire soon?', label: 'Warranties ending', icon: ShieldCheck, permission: 'asset.view' },
  { q: 'How many assets do we have?', label: 'Asset count', icon: Laptop, permission: 'asset.view' },
  { q: 'What expires in the next 30 days?', label: 'Renewals due', icon: CalendarClock, permission: 'record.view' },
  { q: 'How do I offboard an employee?', label: 'Offboarding', icon: HelpCircle, permission: 'asset.edit' },
  { q: 'What can you do?', label: 'What can you do?', icon: Sparkles, permission: null },
] as const

/** A simple, friendly chat: tap a suggestion or type a question. */
export default function AssistantChat() {
  const user = useAuthStore((s) => s.user)
  const has = useAuthStore((s) => s.hasPermission)
  const brand = useBrandName()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [followUps, setFollowUps] = useState<string[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const controller = useRef<AbortController | null>(null)
  const container = useRef<HTMLDivElement>(null)
  const { data: status } = useQuery<{ available: boolean; ai_configured: boolean }>({
    queryKey: ['assistant-status', user?.id], queryFn: async () => (await api.get('/help/chat/status')).data, enabled: open, retry: false,
  })
  const starters = useMemo(() => STARTERS.filter((s) => !s.permission || has(s.permission)).slice(0, 4), [has])
  const firstName = user?.name?.split(' ')[0]

  useEffect(() => () => controller.current?.abort(), [])
  useEffect(() => { if (open) setTimeout(() => input.current?.focus(), 50) }, [open])
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [messages, busy])
  useEffect(() => { setOpen(false) }, [location.pathname])
  useEffect(() => {
    if (!open) return
    const outside = (e: PointerEvent) => { if (e.target instanceof Node && !container.current?.contains(e.target)) setOpen(false) }
    const escape = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape) }
  }, [open])
  useEffect(() => {  // grow the box with the text (1–4 lines)
    const el = input.current
    if (el) { el.style.height = 'auto'; el.style.height = `${Math.min(el.scrollHeight, 112)}px` }
  }, [draft])

  const ask = async (question: string) => {
    const text = question.trim()
    if (!text || busy) return
    const next: Message[] = [...messages, { role: 'user', content: text }]
    setMessages(next); setDraft(''); setBusy(true); setError(''); setFollowUps([])
    const request = new AbortController(); controller.current = request
    try {
      // Only the user's words and earlier AI replies are sent back as history.
      const history = next.filter((m) => m.role === 'user' || m.source === 'ai').slice(-9)
      const { data } = await api.post('/help/chat', { messages: history.map((m) => ({ role: m.role, content: m.content.slice(0, 4000) })) },
        { signal: request.signal, timeout: 55000 })
      setMessages([...next, { role: 'assistant', content: data.answer, source: data.source, notice: data.notice, table: data.table }])
      setFollowUps((prev) => shuffledQuestions(useAuthStore.getState().hasPermission, !!user?.is_superuser, prev, text.toLowerCase(), text))
    } catch (e: any) {
      if (!request.signal.aborted) { setMessages(messages); setDraft(text); setError(e.response?.data?.error?.message || 'I couldn’t reply just now. Please try again.') }
    } finally { if (!request.signal.aborted) setBusy(false) }
  }

  const reset = () => { controller.current?.abort(); setMessages([]); setFollowUps([]); setError(''); setDraft(''); setBusy(false) }

  return (
    <div ref={container} data-testid="assistant-widget" className="fixed bottom-24 right-4 z-40 flex flex-col items-end lg:bottom-5 lg:right-5">
      {open && (
        <section role="dialog" aria-label={`Ask ${brand}`}
          className="mb-3 flex h-[min(38rem,calc(100dvh-12rem))] w-[calc(100vw-2rem)] max-w-[25rem] origin-bottom-right animate-scale-in flex-col overflow-hidden rounded-3xl border bg-white shadow-pop lg:h-[min(38rem,calc(100dvh-7rem))]">
          <header className="flex items-center gap-3 px-4 py-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-2xl bg-brand-gradient text-primary-foreground"><Sparkles className="h-[18px] w-[18px]" /></span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold text-gray-900">Ask {brand}</h2>
              <p className="flex items-center gap-1.5 text-xs text-gray-500"><span className="h-1.5 w-1.5 rounded-full bg-green-500" />Here to help</p>
            </div>
            {messages.length > 0 && <button title="New chat" aria-label="New chat" onClick={reset} className="press rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><RotateCcw className="h-4 w-4" /></button>}
            <button aria-label="Close" onClick={() => setOpen(false)} className="press rounded-xl p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"><X className="h-[18px] w-[18px]" /></button>
          </header>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 pb-2" aria-live="polite">
            {!messages.length && (
              <div className="animate-page-in pt-4">
                <p className="text-2xl font-semibold tracking-tight text-gray-900">Hi{firstName ? ` ${firstName}` : ''}!</p>
                <p className="mt-1 text-sm text-gray-500">What would you like to know? Tap a question or type your own.</p>
                <div className="mt-5 grid grid-cols-2 gap-2">
                  {starters.map((s, i) => (
                    <button key={s.q} onClick={() => ask(s.q)} style={{ animationDelay: `${i * 40}ms` }}
                      className="press group flex animate-page-in flex-col items-start gap-2 rounded-2xl border bg-gray-50/60 p-3 text-left [animation-fill-mode:both] hover:border-primary/40 hover:bg-primary-soft">
                      <s.icon className="h-5 w-5 text-primary transition-transform group-hover:scale-110" />
                      <span className="text-sm font-medium leading-snug text-gray-800">{s.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => m.role === 'user' ? (
              <div key={i} className="flex animate-pop-in justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">{m.content}</p>
              </div>
            ) : (
              <div key={i} className="flex animate-pop-in gap-2">
                <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
                <div className="min-w-0 max-w-[85%] rounded-2xl rounded-tl-md bg-gray-100 px-3.5 py-2.5 text-sm text-gray-800">
                  <AssistantAnswer text={m.content} table={m.table} />
                  {m.notice && <p className="mt-2 text-xs text-gray-500">{m.notice}</p>}
                  {m.source === 'ai' && <p className="mt-2 text-[11px] text-gray-400">Answered with AI</p>}
                </div>
              </div>
            ))}

            {busy && (
              <div className="flex gap-2" role="status" aria-label="Thinking">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-primary-soft text-primary"><Sparkles className="h-3.5 w-3.5" /></span>
                <div className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-gray-100 px-4 py-3">
                  {[0, 1, 2].map((d) => <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-gray-400" style={{ animationDelay: `${d * 120}ms` }} />)}
                </div>
              </div>
            )}
            {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
            {!busy && followUps.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {followUps.map((q) => (
                  <button key={q} onClick={() => ask(q)} className="press rounded-full border bg-white px-3 py-1.5 text-xs text-gray-700 hover:border-primary/40 hover:text-primary">{q}</button>
                ))}
              </div>
            )}
            <div ref={end} />
          </div>

          <form onSubmit={(e) => { e.preventDefault(); void ask(draft) }} className="p-3 pt-2">
            <div className="flex items-end gap-2 rounded-2xl border bg-gray-50 p-1.5 pl-3.5 transition focus-within:border-primary focus-within:bg-white focus-within:shadow-glow">
              <textarea ref={input} rows={1} aria-label="Your question" placeholder="Ask anything…" value={draft} maxLength={4000} disabled={busy || status?.available === false}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void ask(draft) } }}
                className="max-h-28 flex-1 resize-none bg-transparent py-1.5 text-sm text-gray-900 outline-none placeholder:text-gray-400" />
              <button aria-label="Send" disabled={busy || !draft.trim()}
                className="press flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-30"><ArrowUp className="h-4 w-4" /></button>
            </div>
            <p className="mt-1.5 px-1 text-center text-[11px] text-gray-400">Uses only what you can access. Never share passwords.</p>
          </form>
        </section>
      )}

      <button onClick={() => setOpen(!open)} aria-label={open ? 'Close assistant' : 'Open assistant'} aria-expanded={open}
        className="press flex h-12 items-center gap-2 rounded-2xl bg-brand-gradient px-3.5 text-sm font-medium text-primary-foreground shadow-[0_10px_24px_-6px_hsl(var(--primary)/0.6)] hover:scale-[1.03]">
        {open ? <X className="h-5 w-5" /> : <Sparkles className="h-5 w-5" />}
        <span className={cn('hidden sm:inline', open && 'sm:hidden')}>Ask {brand}</span>
      </button>
    </div>
  )
}
