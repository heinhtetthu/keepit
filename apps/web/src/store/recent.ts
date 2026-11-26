import { useEffect, useState } from 'react'
import { useAuthStore } from './auth'

export interface RecentItem {
  url: string
  /** Primary label (e.g. record name or page name). */
  label: string
  /** Context line (e.g. "Office 365 Licenses · record"). */
  sublabel?: string
  kind: 'record' | 'record-type' | 'page'
  /** Record-type icon name (for module colouring). */
  icon?: string | null
  at: number
}

const MAX_ITEMS = 12
const EVENT = 'recently-viewed-changed'

/**
 * Per-user storage key: each account keeps its own navigation history, and a
 * shared browser never mixes users' activity. The userId is resolved live from
 * the auth store on every read/write.
 */
function currentKey(): string {
  const uid = useAuthStore.getState().user?.id
  return uid ? `recently-viewed:${uid}` : 'recently-viewed:none'
}

function read(): RecentItem[] {
  try {
    const raw = localStorage.getItem(currentKey())
    const list = raw ? (JSON.parse(raw) as RecentItem[]) : []
    return Array.isArray(list) ? list.filter((i) => i && i.url && i.label) : []
  } catch {
    return []
  }
}

function write(list: RecentItem[]) {
  try {
    localStorage.setItem(currentKey(), JSON.stringify(list.slice(0, MAX_ITEMS)))
  } catch {
    /* storage unavailable */
  }
  window.dispatchEvent(new Event(EVENT))
}

export function pushRecent(item: Omit<RecentItem, 'at'>) {
  if (!item.url || !item.label) return
  if (!useAuthStore.getState().user) return  // nothing to record while signed out
  const list = read().filter((i) => i.url !== item.url)
  list.unshift({ ...item, at: Date.now() })
  write(list)
}

export function removeRecent(url: string) {
  write(read().filter((i) => i.url !== url))
}

export function clearRecent() {
  write([])
}

/** Relative-time helper, e.g. "4m ago". */
export function timeAgo(ts: number): string {
  const s = Math.max(1, Math.round((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 30) return `${d}d ago`
  return new Date(ts).toLocaleDateString()
}

/** Live recently-viewed list for the signed-in user (same-tab + cross-tab reactive). */
export function useRecent(): RecentItem[] {
  const userKey = useAuthStore((s) => s.user?.id)
  const [items, setItems] = useState<RecentItem[]>(() => read())
  useEffect(() => {
    setItems(read())
    const refresh = () => setItems(read())
    window.addEventListener(EVENT, refresh)
    window.addEventListener('storage', refresh)
    return () => {
      window.removeEventListener(EVENT, refresh)
      window.removeEventListener('storage', refresh)
    }
  }, [userKey])
  return items
}
