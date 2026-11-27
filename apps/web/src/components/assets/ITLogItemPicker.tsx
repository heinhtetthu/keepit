import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, PackagePlus, Search } from 'lucide-react'
import { useAssets, type Asset } from '@workspace/core'
import { fieldClass } from '@/components/ui/input'
import { cn } from '@/lib/utils'

/** What the Lend item picker holds: one of our assets, "Other (not in the list)", or nothing yet. */
export type LendItem = { kind: 'asset'; id: number } | { kind: 'other' } | null

interface Option { id: number; group: string; title: string; sub: string; keywords: string }

const optionOf = (a: Pick<Asset, 'id' | 'asset_type' | 'other_type_name' | 'brand' | 'model' | 'serial_number' | 'display_name'>): Option => ({
  id: a.id,
  group: a.other_type_name || a.asset_type,
  title: [a.brand, a.model].filter(Boolean).join(' ') || a.display_name,
  sub: a.serial_number ? `S/N ${a.serial_number}` : 'No serial number',
  keywords: `${a.asset_type} ${a.other_type_name ?? ''} ${a.brand ?? ''} ${a.model ?? ''} ${a.serial_number ?? ''}`.toLowerCase(),
})

/**
 * Searchable picker of the assets that can be lent (unassigned and operational),
 * grouped by asset type. The last row, "Other (not in the list)", is for items
 * that are not tracked as assets (cables, adapters...).
 * `current` keeps the asset an existing entry already points at in the list.
 */
export default function ITLogItemPicker({ value, onChange, current, autoOpen }: {
  value: LendItem
  onChange: (v: LendItem) => void
  current?: Pick<Asset, 'id' | 'asset_type' | 'other_type_name' | 'brand' | 'model' | 'serial_number' | 'display_name'> | null
  autoOpen?: boolean
}) {
  const { data, isLoading } = useAssets({ assignment_status: 'Unassigned', condition_status: 'Operational', hide_written_off: true, page: 1, page_size: 500, sort: 'asset_type', order: 'asc' })
  const [open, setOpen] = useState(!!autoOpen)
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const btn = useRef<HTMLDivElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)

  const all = useMemo(() => {
    const list = (data?.items ?? []).map(optionOf)
    if (current && !list.some((o) => o.id === current.id)) list.push(optionOf(current))
    return list.sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title))
  }, [data, current])
  const needle = q.trim().toLowerCase()
  const shown = useMemo(() => (needle ? all.filter((o) => o.keywords.includes(needle) || o.title.toLowerCase().includes(needle)) : all).slice(0, 200), [all, needle])
  const rows = shown.length + 1 // + Other
  const selected = value?.kind === 'asset' ? all.find((o) => o.id === value.id) : null

  useLayoutEffect(() => {
    if (!open) return
    const place = () => btn.current && setRect(btn.current.getBoundingClientRect())
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  }, [open])
  useEffect(() => {
    if (!open) return
    input.current?.focus()
    const away = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('mousedown', away, true)
    return () => document.removeEventListener('mousedown', away, true)
  }, [open])
  useEffect(() => { setActive(0) }, [needle])

  const pick = (i: number) => {
    onChange(i === shown.length ? { kind: 'other' } : { kind: 'asset', id: shown[i].id })
    setOpen(false); setQ(''); btn.current?.focus()
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(rows - 1, a + 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(0, a - 1)) }
    else if (e.key === 'Enter') { e.preventDefault(); pick(active) }
    else if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); setOpen(false); btn.current?.focus() }
  }
  const below = rect ? window.innerHeight - rect.bottom > 340 || rect.top < 340 : true

  return (
    <>
      <div ref={btn} role="combobox" tabIndex={0} aria-haspopup="listbox" aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => { if (!open && (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown')) { e.preventDefault(); setOpen(true) } }}
        className={cn(fieldClass, 'cursor-pointer select-none items-center gap-2.5 pl-3 pr-2.5 text-left outline-none focus-visible:border-primary focus-visible:shadow-glow', open && 'border-primary shadow-glow')}>
        <span className="min-w-0 flex-1 truncate">
          {selected ? <>{selected.title}<span className="text-gray-400"> · {selected.group} · {selected.sub}</span></>
            : value?.kind === 'other' ? 'Other (not in the list)'
              : <span className="text-gray-400">Pick an asset or Other…</span>}
        </span>
        <ChevronDown className={cn('ml-1 h-4 w-4 shrink-0 text-gray-400 transition-transform duration-200', open && 'rotate-180 text-primary')} />
      </div>
      {open && rect && createPortal(
        <div ref={panel} data-floating="true" tabIndex={-1} onKeyDown={onKey}
          className="fixed z-[95] animate-pop-in overflow-hidden rounded-xl border bg-white shadow-pop outline-none"
          style={{ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 300) - 8)), width: Math.min(Math.max(rect.width, 300), window.innerWidth - 16), ...(below ? { top: rect.bottom + 4 } : { bottom: window.innerHeight - rect.top + 4 }) }}>
          <div className="relative border-b">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input ref={input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search type, brand, model or serial…" className="h-10 w-full bg-transparent pl-9 pr-3 text-sm text-gray-900 outline-none" />
          </div>
          <ul role="listbox" className="max-h-72 overflow-y-auto p-1">
            {isLoading && <li className="px-3 py-4 text-center text-sm text-gray-400">Loading assets…</li>}
            {!isLoading && !shown.length && <li className="px-3 py-3 text-center text-sm text-gray-400">{needle ? 'No available asset matches' : 'No assets are available to lend'}</li>}
            {shown.map((o, i) => (
              <li key={o.id} role="option" aria-selected={selected?.id === o.id}>
                {(i === 0 || shown[i - 1].group !== o.group) && <div className="px-2.5 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">{o.group}</div>}
                <button type="button" onMouseEnter={() => setActive(i)} onClick={() => pick(i)}
                  className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors', i === active && 'bg-gray-100', selected?.id === o.id && 'text-primary')}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-gray-900">{o.title}</span>
                    <span className="block truncate font-mono text-xs text-gray-500">{o.sub}</span>
                  </span>
                  {selected?.id === o.id && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              </li>
            ))}
            <li role="option" aria-selected={value?.kind === 'other'} className="mt-1 border-t pt-1">
              <button type="button" onMouseEnter={() => setActive(shown.length)} onClick={() => pick(shown.length)}
                className={cn('flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors', active === shown.length && 'bg-gray-100')}>
                <PackagePlus className="h-4 w-4 shrink-0 text-gray-400" />
                <span className="flex-1">Other (not in the list)</span>
                {value?.kind === 'other' && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            </li>
          </ul>
        </div>,
        document.body,
      )}
    </>
  )
}
