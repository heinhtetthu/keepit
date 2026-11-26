import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import axios from 'axios'
import { cn } from '@/lib/utils'

export interface Branding { app_name: string; primary_color: string; logo_url: string | null; favicon_url: string | null }
export const DEFAULT_PRIMARY = '#3287f0'
const CACHE_KEY = 'brand-css'

/** Public (no sign-in needed) so the login page is branded too. */
export function useBranding() {
  return useQuery<Branding>({
    queryKey: ['branding'],
    queryFn: async () => (await axios.get('/api/v1/branding')).data,
    staleTime: 5 * 60_000,
    retry: 1,
  })
}

function hexToHsl(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2
  if (max === min) return [0, 0, Math.round(l * 100)]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return [Math.round(h * 60), Math.round(s * 100), Math.round(l * 100)]
}

function luminance(hex: string) {
  const n = parseInt(hex.slice(1), 16)
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 })
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
}

/** CSS variables for a primary colour in light and dark themes. */
export function brandCss(hex: string): string {
  const [h, s, l] = hexToHsl(hex)
  const lightFg = luminance(hex) > 0.45 ? '222 47% 11%' : '0 0% 100%'
  const dl = Math.min(Math.max(l + 7, 55), 70)
  return `html:root{--primary:${h} ${s}% ${l}%;--ring:${h} ${s}% ${l}%;--primary-foreground:${lightFg};--primary-soft:${h} ${Math.min(s, 90)}% 96%}`
    + `html.dark{--primary:${h} ${s}% ${dl}%;--ring:${h} ${s}% ${dl}%;--primary-foreground:222 47% 8%;--primary-soft:${h} 40% 16%}`
}

function applyCss(css: string) {
  let tag = document.getElementById('brand-vars') as HTMLStyleElement | null
  if (!tag) { tag = document.createElement('style'); tag.id = 'brand-vars'; document.head.appendChild(tag) }
  tag.textContent = css
}

/** Applies the workspace colour and favicon; caches the colour to avoid a flash on next load. */
export function BrandingEffect() {
  const { data } = useBranding()
  useEffect(() => {
    if (!data) return
    const css = brandCss(data.primary_color || DEFAULT_PRIMARY)
    applyCss(css)
    try { localStorage.setItem(CACHE_KEY, css) } catch { /* ignore */ }
    const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
    if (link) {
      link.href = data.favicon_url || '/favicon.svg'
      link.type = data.favicon_url ? '' : 'image/svg+xml'
    }
  }, [data])
  return null
}

/** Workspace logo, or the default mark drawn in the current primary colour. */
export function BrandLogo({ className }: { className?: string }) {
  const { data } = useBranding()
  if (data?.logo_url) return <img src={data.logo_url} alt="" className={cn('object-contain', className)} />
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden>
      <rect x="4" y="4" width="56" height="56" rx="16" fill="hsl(var(--primary))" />
      <rect x="4" y="4" width="56" height="28" rx="16" fill="#fff" opacity="0.08" />
      <path d="M22 18v28" stroke="hsl(var(--primary-foreground))" strokeWidth="5.5" strokeLinecap="round" />
      <path d="M42 18 29.5 32 42 46" stroke="hsl(var(--primary-foreground))" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <circle cx="45" cy="32" r="3.2" fill="hsl(var(--primary-foreground))" opacity="0.75" />
    </svg>
  )
}

export function useBrandName() {
  return useBranding().data?.app_name || 'Keepit'
}
