import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Database, CalendarClock, CircleAlert, RefreshCw, ArrowRight } from 'lucide-react'
import api from '@/lib/api'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '../store/auth'
import { cn } from '@/lib/utils'
import type { DashboardStats, TypeBreakdown, UpcomingRenewal } from '../types'

export default function Dashboard() {
  const navigate = useNavigate()
    const hasPermission = useAuthStore((s) => s.hasPermission)
    const isSuperuser = !!useAuthStore((s) => s.user)?.is_superuser
    const canSeeNotifications = hasPermission('notification.view')
    const canManageRecipients = isSuperuser
  const { data, isLoading } = useQuery<DashboardStats>({
    queryKey: ['dashboard'],
    queryFn: async () => {
      const res = await api.get('/dashboard')
      return res.data
    },
  })

  /* "Which record type?" chooser state - declared before any early return (hooks rule) */
  const [pickCard, setPickCard] = useState<CardDef | null>(null)
  const goWithType = (slug: string, quick?: string) => {
    setPickCard(null)
    navigate(quick ? `/records/${slug}?quick=${quick}` : `/records/${slug}`)
  }

  if (isLoading) return <div className="text-gray-500">Loading...</div>

  /* "Which record type?" chooser when clicking a stat card with several matching types */
  const openCardChooser = (card: CardDef) => {
    if ((card.breakdown?.length ?? 0) === 1) goWithType(card.breakdown![0].slug, card.quick)
    else setPickCard(card)
  }

  const stats = data || {
    total_records: 0, active_records: 0, expiring_soon: 0, expired: 0,
    expiring_by_type: [], expired_by_type: [],
    renewing_this_week: 0, renewing_this_month: 0,
    upcoming_renewals: [], recently_added: [], recently_modified: [],
  }

  interface CardDef {
    label: string
    value: number
    icon: typeof Database
    breakdown?: TypeBreakdown[]
    quick?: string
    className?: string
  }

  const cards: CardDef[] = [
    { label: 'Total Records', value: stats.total_records, icon: Database },
    { label: 'Expiring Soon', value: stats.expiring_soon, icon: CalendarClock, breakdown: stats.expiring_by_type, quick: 'expiring', className: 'text-orange-600' },
    { label: 'Expired', value: stats.expired, icon: CircleAlert, breakdown: stats.expired_by_type, quick: 'expired', className: 'text-red-600' },
    { label: 'Due This Week', value: stats.renewing_this_week, icon: RefreshCw, quick: 'expiring' },
  ]

  return (
    <div className="space-y-6">
      <h2 className="text-lg font-semibold text-gray-900">Renewals</h2>

      {/* Stat cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {cards.map((card) => {
          const clickable = !!card.quick && (card.breakdown?.length ?? 0) > 0
          return (
            <Card
              key={card.label}
              className={cn(
                'transition-all',
                clickable ? 'cursor-pointer hover:shadow-md hover:border-primary/40 group' : 'hover:shadow-sm',
              )}
              onClick={clickable ? () => openCardChooser(card) : undefined}
            >
              <CardHeader className="pb-1 p-4 sm:p-6 sm:pb-2">
                <CardTitle className="text-xs sm:text-sm font-medium text-gray-500 flex items-center gap-1.5">
                  <card.icon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                  <span className="truncate">{card.label}</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
                <div className="flex items-center justify-between gap-2">
                  <div className={cn('text-2xl sm:text-3xl font-bold', card.className)}>
                    {card.value}
                  </div>
                  {clickable && (
                    <ChevronRight className="h-4 w-4 text-gray-300 group-hover:text-primary group-hover:translate-x-0.5 transition-all shrink-0" />
                  )}
                </div>
                {card.breakdown && card.breakdown.length > 0 && (
                  <div className="mt-2.5 space-y-0.5">
                    {card.breakdown.slice(0, 3).map((b) => (
                      <Link
                        key={b.record_type_id}
                        to={`/records/${b.slug}?quick=${card.quick}`}
                        className="flex items-center justify-between text-xs text-gray-500 hover:text-primary transition-colors"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <span className="truncate">{b.name}</span>
                        <span className="font-semibold shrink-0 ml-2">{b.count}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Renewals + activity */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 sm:gap-6">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center justify-between gap-2">
              Upcoming Renewals
              <span className="text-xs font-normal text-gray-400">next 30 days</span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            {(stats.upcoming_renewals as UpcomingRenewal[]).length === 0 ? (
              <div className="text-center py-8">
                <CalendarClock className="h-8 w-8 mx-auto text-gray-300" />
                <p className="text-gray-500 text-sm mt-2">No upcoming renewals</p>
              </div>
            ) : (
              <div className="space-y-1">
                {(stats.upcoming_renewals as UpcomingRenewal[]).map((r, i) => (
                  <div
                    key={`${r.name}-${r.id}-${i}`}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-gray-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{r.name}</p>
                      <p className="text-xs text-gray-500">{r.record_type}</p>
                    </div>
                    <Badge variant={r.days_remaining <= 3 ? 'destructive' : r.days_remaining <= 14 ? 'warning' : 'secondary'} className="shrink-0">
                      {r.days_remaining === 0 ? 'today' : `${r.days_remaining}d`}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Recently Added</CardTitle>
          </CardHeader>
          <CardContent>
            {stats.recently_added.length === 0 ? (
              <div className="text-center py-8">
                <Database className="h-8 w-8 mx-auto text-gray-300" />
                <p className="text-gray-500 text-sm mt-2">No recent records</p>
              </div>
            ) : (
              <div className="space-y-1">
                {stats.recently_added.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-gray-50 transition-colors">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{r.name}</p>
                      <p className="text-xs text-gray-500">{r.record_type_name}</p>
                    </div>
                    <Link to={`/records/${r.record_type_slug}/${r.id}`} className="inline-flex items-center gap-0.5 text-xs text-primary hover:underline shrink-0" title="View record">
                      View <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {canSeeNotifications && (
        <Card className="xl:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-base">Notification Status</CardTitle>
              <Badge variant={stats.notification_status?.telegram_configured && (stats.notification_status?.failed_24h ?? 0) === 0 ? 'success' : 'warning'}>
                Telegram {stats.notification_status?.telegram_configured ? 'connected' : 'not configured'}
              </Badge>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 text-sm">
              {[
                { label: 'Active rules', value: stats.notification_status?.active_rules ?? 0, className: '' },
                { label: 'Recipients', value: stats.notification_status?.active_recipients ?? 0, className: '' },
                { label: 'Sent (24h)', value: stats.notification_status?.sent_24h ?? 0, className: 'text-green-600' },
                { label: 'Failed (24h)', value: stats.notification_status?.failed_24h ?? 0, className: 'text-red-600' },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border bg-gray-50/60 px-3.5 py-3">
                  <dt className="text-xs text-gray-400">{s.label}</dt>
                  <dd className={cn('text-xl sm:text-2xl font-semibold mt-0.5', s.className)}>{s.value}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-gray-400 mt-3">
              Last worker run:{' '}
              {stats.notification_status?.last_run_at ? new Date(stats.notification_status.last_run_at).toLocaleString() : 'never'}
              {canManageRecipients && <> - Reminders are sent by the background worker - add recipients under Notifications.</>}
            </p>
          </CardContent>
        </Card>
        )}
      </div>

      {/* Pick which record type to open with the card's filter applied */}
      {pickCard && pickCard.breakdown && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPickCard(null)}>
          <Card className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <pickCard.icon className="h-4 w-4 text-gray-400" />
                {pickCard.label} - which record type?
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {pickCard.breakdown.map((b) => (
                <button
                  key={b.record_type_id}
                  className="w-full flex items-center justify-between rounded-md border px-3.5 py-2.5 text-sm hover:border-primary/40 hover:bg-primary/5 transition-colors"
                  onClick={() => goWithType(b.slug, pickCard.quick)}
                >
                  <span className="truncate">{b.name}</span>
                  <span className="flex items-center gap-2 shrink-0 ml-2">
                    <span className="text-gray-500 font-medium">{b.count}</span>
                    <ChevronRight className="h-4 w-4 text-gray-300" />
                  </span>
                </button>
              ))}
              <div className="pt-2 flex justify-end">
                <button className="text-sm text-gray-500 hover:text-gray-800 px-2 py-1" onClick={() => setPickCard(null)}>
                  Cancel
                </button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
