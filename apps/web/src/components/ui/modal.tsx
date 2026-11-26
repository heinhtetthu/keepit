import { ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Dialog: bottom sheet on phones, centred card on larger screens.
    Fades/scales in and out; Escape, backdrop and × close it. */
export default function Modal({ title, subtitle, onClose, children, footer, size = 'md' }: {
  title: ReactNode
  subtitle?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
}) {
  const [closing, setClosing] = useState(false)
  const panel = useRef<HTMLDivElement>(null)
  const close = useCallback(() => {
    setClosing(true)
    window.setTimeout(onClose, 140)
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    panel.current?.querySelector<HTMLElement>('input,textarea,button:not([aria-label="Close"])')?.focus({ preventScroll: true })
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [close])

  return createPortal(
    <div
      className={cn('fixed inset-0 z-[90] flex items-end justify-center bg-gray-950/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4 dark:bg-black/60',
        closing ? 'opacity-0 transition-opacity duration-150' : 'animate-fade-in')}
      onMouseDown={close}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        className={cn(
          'flex max-h-[92dvh] w-full flex-col rounded-t-2xl border bg-white shadow-pop sm:rounded-2xl',
          closing ? 'translate-y-2 scale-[0.98] opacity-0 transition duration-150' : 'animate-sheet-up sm:animate-scale-in',
          size === 'sm' ? 'sm:max-w-sm' : size === 'lg' ? 'sm:max-w-2xl' : size === 'xl' ? 'sm:max-w-4xl' : 'sm:max-w-lg',
        )}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-gray-200 sm:hidden" aria-hidden />
        <div className="flex items-start justify-between gap-3 px-5 pb-3 pt-4 sm:pt-5">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-gray-900">{title}</h2>
            {subtitle && <p className="mt-0.5 truncate text-sm text-gray-500">{subtitle}</p>}
          </div>
          <button onClick={close} className="press -m-1 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="overflow-y-auto px-5 pb-5">{children}</div>
        {footer && <div className="flex flex-wrap justify-end gap-2 rounded-b-2xl border-t bg-gray-50/80 px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  )
}
