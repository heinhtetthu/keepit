import { UserX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { initials } from '@/lib/seats'

const TONES = ['bg-sky-100 text-sky-700', 'bg-violet-100 text-violet-700', 'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800', 'bg-rose-100 text-rose-700', 'bg-teal-100 text-teal-700']

function tone(name: string) {
  let h = 0
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return TONES[h % TONES.length]
}

/** Initials avatar; a dashed placeholder when nobody holds the seat. */
export default function Avatar({ name, size = 'md' }: { name: string | null | undefined; size?: 'sm' | 'md' | 'lg' }) {
  const dims = size === 'sm' ? 'h-7 w-7 text-[11px]' : size === 'lg' ? 'h-11 w-11 text-sm' : 'h-8 w-8 text-xs'
  if (!name) {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full border border-dashed border-gray-300 text-gray-400', dims)}>
        <UserX className="h-3.5 w-3.5" />
      </span>
    )
  }
  return <span className={cn('inline-flex shrink-0 items-center justify-center rounded-full font-semibold', dims, tone(name))}>{initials(name)}</span>
}
