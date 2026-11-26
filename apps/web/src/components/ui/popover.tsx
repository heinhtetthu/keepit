import { CSSProperties, ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

interface PopoverProps {
  trigger: ReactNode
  children: ReactNode | ((close: () => void) => ReactNode)
  align?: 'left' | 'right'
  panelClassName?: string
  className?: string
}

export default function Popover({ trigger, children, align = 'left', panelClassName, className }: PopoverProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // Room left below the trigger, so tall panels can cap their height and keep their buttons on screen.
  const [room, setRoom] = useState<number>()
  useLayoutEffect(() => {
    if (!open || !rootRef.current) return
    const measure = () => {
      // Stop above the phone/tablet bottom bar when it is showing.
      const bar = document.querySelector('[data-bottom-nav]')?.getBoundingClientRect()
      const floor = bar && bar.height > 0 ? bar.top : window.innerHeight
      setRoom(Math.max(240, floor - rootRef.current!.getBoundingClientRect().bottom - 16))
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onClick = (e: MouseEvent) => {
      const target = e.target as Element
      // Dropdowns render their lists in a portal; clicks there belong to this popover.
      if (target.closest?.('[data-floating="true"]')) return
      if (rootRef.current && !rootRef.current.contains(target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      // Let an open dropdown inside the panel handle Escape first.
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('[data-floating="true"]')) return
      setOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <div onClick={() => setOpen((o) => !o)} className="cursor-pointer">{trigger}</div>
      {open && (
        <div style={room ? ({ '--popover-room': `${room}px` } as CSSProperties) : undefined} className={cn('absolute z-40 mt-1.5 animate-pop-in rounded-xl border bg-white shadow-pop', align === 'right' ? 'right-0 origin-top-right' : 'left-0 origin-top-left', panelClassName)}>
          {typeof children === 'function' ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  )
}
