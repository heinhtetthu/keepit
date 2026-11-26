import {
  RefreshCw, Globe, Key, Shield, FileText, Briefcase, Wrench, Package, Tag,
  Users, Building2, CreditCard, Laptop, Cloud, Server, Database, Receipt,
  Calendar, Lock, Star, Car, Home, HeartPulse, Award, Scroll,
  type LucideIcon,
} from 'lucide-react'

export const AVAILABLE_ICONS = [
  'refresh-cw', 'globe', 'key', 'shield', 'file-text', 'briefcase', 'wrench',
  'package', 'tag', 'users', 'building', 'credit-card', 'laptop', 'cloud',
  'server', 'database', 'receipt', 'calendar', 'lock', 'star', 'car',
  'home', 'heart-pulse', 'award', 'scroll',
]

const ICON_MAP: Record<string, LucideIcon> = {
  'refresh-cw': RefreshCw,
  'globe': Globe,
  'key': Key,
  'shield': Shield,
  'file-text': FileText,
  'briefcase': Briefcase,
  'wrench': Wrench,
  'package': Package,
  'tag': Tag,
  'users': Users,
  'building': Building2,
  'credit-card': CreditCard,
  'laptop': Laptop,
  'cloud': Cloud,
  'server': Server,
  'database': Database,
  'receipt': Receipt,
  'calendar': Calendar,
  'lock': Lock,
  'star': Star,
  'car': Car,
  'home': Home,
  'heart-pulse': HeartPulse,
  'award': Award,
  'scroll': Scroll,
}

const FALLBACK: LucideIcon = FileText

export default function TypeIcon({ icon, className = 'h-4 w-4' }: { icon?: string | null; className?: string }) {
  const Icon = (icon && ICON_MAP[icon]) || FALLBACK
  return <Icon className={className} />
}
