import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Mail } from 'lucide-react'
import { formatDate, useEmployeeOverview } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import Avatar from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { pushRecent } from '@/store/recent'
import { AssignmentBadge, EmptyState, Tabs, useCan } from '@/components/assets/shared'
import { LinkedDocuments } from '@/components/documents/DocumentDialogs'

type Tab = 'assets' | 'seats' | 'history' | 'borrows' | 'documents'

/** Employee 360: everything a person holds across assets and license seats. */
export default function EmployeeDetail() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const can = useCan()
  const { data, isLoading } = useEmployeeOverview(id)
  const [tab, setTab] = useState<Tab>('assets')
  useEffect(() => { if (data) pushRecent({ url: `/employees/${id}`, label: data.employee.name, sublabel: 'Employee', kind: 'page', icon: null }) }, [data, id])
  if (isLoading) return <p className="p-8 text-center text-sm text-gray-400">Loading…</p>
  if (!data) return <EmptyState title="Employee not found" />
  const e = data.employee
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-800"><ArrowLeft className="h-4 w-4" />Back</button>
      <Card><CardContent className="flex flex-wrap items-center gap-4 p-4">
        <Avatar name={e.name} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">{e.name}</h1>
          <p className="text-sm text-gray-500">{[e.title, (e.business_units ?? []).join(', ')].filter(Boolean).join(' · ') || '—'}</p>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-500">
            {e.email && <a className="inline-flex items-center gap-1 hover:underline" href={`mailto:${e.email}`}><Mail className="h-3 w-3" />{e.email}</a>}
            {e.join_date && <span>Joined {formatDate(e.join_date)}</span>}
            {e.resignation_date && <span>Left {formatDate(e.resignation_date)}</span>}
            {(e.regions ?? []).length > 0 && <span>{(e.regions ?? []).join(', ')}</span>}
          </div>
        </div>
        {e.active ? <Badge variant="success">Active</Badge> : <Badge variant="secondary">Inactive</Badge>}
        {e.active && (can('asset.edit') || can('record.edit')) && <Button variant="outline" size="sm" onClick={() => navigate('/quick-actions?tab=offboard')}>Offboard…</Button>}
      </CardContent></Card>

      <Tabs value={tab} onChange={setTab} tabs={[
        ...(can('asset.view') ? [{ key: 'assets' as const, label: 'Assets', count: data.assets.length }, { key: 'history' as const, label: 'Asset history', count: data.asset_history.length }, { key: 'borrows' as const, label: 'Borrows', count: data.borrows.length }] : []),
        ...(can('record.view') ? [{ key: 'seats' as const, label: 'License seats', count: data.seats.length }] : []),
        ...(can('document.view') ? [{ key: 'documents' as const, label: 'Documents' }] : []),
      ]} />
      {tab === 'assets' && (data.assets.length ? <ul className="divide-y rounded-lg border bg-white">{data.assets.map((a) => (
        <li key={a.id} className="flex items-center gap-3 px-4 py-2.5"><Link className="flex-1 text-sm font-medium hover:underline" to={`/assets/${a.id}`}>{a.display_name}</Link><span className="text-xs text-gray-500">{a.asset_type}</span><AssignmentBadge status={a.assignment_status} /></li>
      ))}</ul> : <EmptyState title="Holds no assets" />)}
      {tab === 'history' && (data.asset_history.length ? <ul className="divide-y rounded-lg border bg-white">{data.asset_history.map((h) => (
        <li key={h.id} className="px-4 py-2.5 text-sm"><Link className="font-medium hover:underline" to={`/assets/${h.asset_id}`}>{h.asset_name}</Link><p className="text-xs text-gray-500">{formatDate(h.assigned_from)} → {h.assigned_to ? formatDate(h.assigned_to) : 'now'}</p></li>
      ))}</ul> : <EmptyState title="No asset history" />)}
      {tab === 'borrows' && (data.borrows.length ? <ul className="divide-y rounded-lg border bg-white">{data.borrows.map((b) => (
        <li key={b.id} className="flex items-center px-4 py-2.5 text-sm"><span className="flex-1">{b.item_name}<span className="block text-xs text-gray-500">{formatDate(b.borrowed_date)} → {b.returned_date ? formatDate(b.returned_date) : `due ${formatDate(b.expected_return_date)}`}</span></span>{b.overdue && <span className="text-xs font-medium text-red-600">Overdue</span>}</li>
      ))}</ul> : <EmptyState title="No borrows" />)}
      {tab === 'seats' && (data.seats.length ? <ul className="divide-y rounded-lg border bg-white">{data.seats.map((s) => (
        <li key={s.record_id} className="px-4 py-2.5 text-sm"><Link className="font-medium hover:underline" to={`/records/${s.record_type_slug}/${s.record_id}`}>{s.name}</Link>
          <span className="ml-2 text-xs text-gray-500">{s.record_type_name}{s.product && ` · ${s.product}`}{s.since && ` · since ${formatDate(s.since)}`}</span></li>
      ))}</ul> : <EmptyState title="Holds no license seats" />)}
      {tab === 'documents' && <LinkedDocuments link={{ entity_type: 'employee', entity_id: id }} />}
    </div>
  )
}
