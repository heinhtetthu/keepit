import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import {
  RefreshCw, Globe, Key, Shield, FileText, Briefcase, Wrench, Package, Tag,
  Users, Building2, CreditCard, Laptop, Cloud, Server, Database, Receipt,
  Calendar, Lock, Star, Car, Home, HeartPulse, Award, Scroll, type LucideIcon,
} from 'lucide-react'
import { AVAILABLE_ICONS } from './TypeIcon'

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  'refresh-cw': RefreshCw, 'globe': Globe, 'key': Key, 'shield': Shield,
  'file-text': FileText, 'briefcase': Briefcase, 'wrench': Wrench, 'package': Package,
  'tag': Tag, 'users': Users, 'building': Building2, 'credit-card': CreditCard,
  'laptop': Laptop, 'cloud': Cloud, 'server': Server, 'database': Database,
  'receipt': Receipt, 'calendar': Calendar, 'lock': Lock, 'star': Star,
  'car': Car, 'home': Home, 'heart-pulse': HeartPulse, 'award': Award, 'scroll': Scroll,
}

interface Props {
  value?: string | null
  onChange: (value: string) => void
  disabled?: boolean
}

export default function IconPicker({ value, onChange, disabled }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = query.trim()
    ? AVAILABLE_ICONS.filter((name) => name.includes(query.trim().toLowerCase()))
    : AVAILABLE_ICONS

  const SelectedIcon = (value && ICON_COMPONENTS[value]) || null

  return (
    <div className="relative">
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className="flex h-10 w-full items-center gap-2 rounded-md border border-input bg-background px-3 text-sm hover:bg-gray-50 disabled:opacity-50"
      >
        {SelectedIcon ? (
          <>
            <SelectedIcon className="h-4 w-4 text-gray-600" />
            <span className="text-gray-700">{value}</span>
          </>
        ) : (
          <span className="text-gray-400">Choose an icon...</span>
        )}
      </button>

      {open && (
        <div className="absolute z-40 mt-1 w-full rounded-md border bg-white shadow-lg">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 text-gray-400" />
            <input
              autoFocus
              className="w-full text-sm outline-none"
              placeholder="Search icons..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="grid max-h-56 grid-cols-6 gap-1 overflow-y-auto p-2">
            {filtered.map((name) => {
              const Icon = ICON_COMPONENTS[name]
              const isSel = value === name
              return (
                <button
                  key={name}
                  type="button"
                  title={name}
                  onClick={() => { onChange(name); setOpen(false); setQuery('') }}
                  className={`flex h-9 w-9 items-center justify-center rounded hover:bg-gray-100 ${isSel ? 'bg-gray-100 ring-1 ring-primary' : ''}`}
                >
                  {Icon && <Icon className="h-4 w-4 text-gray-600" />}
                  {isSel && <Check className="absolute h-3 w-3 text-green-600" />}
                </button>
              )
            })}
            {filtered.length === 0 && (
              <p className="col-span-6 px-2 py-3 text-center text-sm text-gray-400">No icons match</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
