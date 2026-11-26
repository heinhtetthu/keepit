import { ReactNode, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/utils'

/** One line of text cut with "…"; hovering shows the full text, but only
    when it is actually cut off. The tooltip lives in a portal so table cells
    with overflow hidden never clip it. */
export default function TruncatedText({ text, children, className }: { text: string; children?: ReactNode; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; above: boolean } | null>(null)

  const show = () => {
    const el = ref.current
    if (!el || el.scrollWidth <= el.clientWidth + 1) return
    const r = el.getBoundingClientRect()
    const above = r.bottom + 120 > window.innerHeight
    setTip({ x: Math.min(r.left, window.innerWidth - 380), y: above ? r.top - 6 : r.bottom + 6, above })
  }

  return (
    <>
      <span ref={ref} className={cn('block truncate', className)} onMouseEnter={show} onMouseLeave={() => setTip(null)}>
        {children ?? text}
      </span>
      {tip && createPortal(
        <span
          role="tooltip"
          className="pointer-events-none fixed z-[100] max-w-[360px] whitespace-pre-wrap break-words rounded-md bg-gray-900 px-2.5 py-1.5 text-xs leading-relaxed text-white shadow-lg"
          style={{ left: Math.max(8, tip.x), top: tip.y, transform: tip.above ? 'translateY(-100%)' : undefined }}
        >
          {text}
        </span>,
        document.body,
      )}
    </>
  )
}
