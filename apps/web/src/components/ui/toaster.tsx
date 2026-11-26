import { create } from 'zustand'
import { useEffect } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastKind = 'success' | 'error' | 'info'

interface ToastItem {
  id: number
  kind: ToastKind
  message: string
}

interface ToastState {
  toasts: ToastItem[]
  push: (kind: ToastKind, message: string) => void
  dismiss: (id: number) => void
}

let nextId = 1

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, message) => {
    const id = nextId++
    set((state) => ({ toasts: [...state.toasts, { id, kind, message }].slice(-4) }))
    if (kind === 'error') setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 7000)
    else setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 3500)
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

export const toast = {
  success: (message: string) => useToastStore.getState().push('success', message),
  error: (message: string) => useToastStore.getState().push('error', message),
  info: (message: string) => useToastStore.getState().push('info', message),
}

const ICONS: { [k in ToastKind]: typeof CheckCircle2 } = {
  success: CheckCircle2,
  error: AlertCircle,
  info: Info,
}

const STYLES: { [k in ToastKind]: string } = {
  success: 'border-emerald-200 bg-white text-gray-800 [&>svg:first-child]:text-emerald-600',
  error: 'border-red-200 bg-white text-gray-800 [&>svg:first-child]:text-red-600',
  info: 'border-gray-200 bg-white text-gray-800 [&>svg:first-child]:text-primary',
}

export function Toaster() {
  const { toasts, dismiss } = useToastStore()
  useEffect(() => {}, [toasts])

  return (
    <div className="fixed bottom-20 right-4 left-4 sm:bottom-4 sm:left-auto z-[100] flex flex-col gap-2 items-stretch sm:items-end pointer-events-none">
      {toasts.map((t) => {
        const Icon = ICONS[t.kind]
        return (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto flex max-w-full animate-slide-in-right items-center gap-2.5 rounded-xl border px-3.5 py-3 shadow-pop sm:max-w-sm',
              STYLES[t.kind],
            )}
            role="status"
          >
            <Icon className="h-4.5 w-4.5 shrink-0 h-5 w-5" />
            <span className="text-sm flex-1">{t.message}</span>
            <button
              className="shrink-0 rounded p-0.5 opacity-60 hover:opacity-100"
              onClick={() => dismiss(t.id)}
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

/** One-shot error+success helpers for mutations */
export function useMutationToasts() {
  void useEffect
  return toast
}
