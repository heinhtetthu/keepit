import { ReactNode, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreHorizontal } from 'lucide-react'
import { cn } from '@/lib/utils'

export interface MenuItem {
  label: string
  icon?: ReactNode
  onSelect: () => void
  danger?: boolean
  hidden?: boolean
  divider?: boolean
}

/** "⋯" row menu rendered in a portal so table scroll containers never clip it. */
export default function RowMenu({ items, label = 'Actions' }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btn = useRef<HTMLButtonElement>(null)
  const panel = useRef<HTMLDivElement>(null)
  const visible = items.filter((i) => !i.hidden)

  useLayoutEffect(() => {
    if (!open) return
    const place = () => {
      if (!btn.current) return
      const r = btn.current.getBoundingClientRect()
      const h = panel.current?.offsetHeight ?? 200
      const top = r.bottom + 4 + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4
      setPos({ top, left: Math.max(8, Math.min(r.right - 208, window.innerWidth - 216)) })
    }
    place()
    const close = (e: Event) => {
      if (panel.current?.contains(e.target as Node) || btn.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', onKey)
    window.addEventListener('scroll', place, true)  // follow the button while lists scroll
    window.addEventListener('resize', place)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', place, true)
      window.removeEventListener('resize', place)
    }
  }, [open])

  if (!visible.length) return null
  return (
    <>
      <button
        ref={btn}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className={cn('press inline-flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-900', open && 'bg-gray-100 text-gray-900')}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && createPortal(
        <div
          ref={panel}
          role="menu"
          className="fixed z-[85] w-52 animate-pop-in rounded-xl border bg-white p-1 shadow-pop"
          style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden' }}
          onClick={(e) => e.stopPropagation()}
        >
          {visible.map((item) => (
            <div key={item.label}>
              {item.divider && <div className="my-1 h-px bg-gray-100" />}
              <button
                role="menuitem"
                onClick={() => { setOpen(false); item.onSelect() }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-left transition-colors',
                  item.danger ? 'text-red-600 hover:bg-red-50' : 'text-gray-700 hover:bg-gray-100',
                )}
              >
                <span className="h-4 w-4 shrink-0 [&>svg]:h-4 [&>svg]:w-4">{item.icon}</span>
                {item.label}
              </button>
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
