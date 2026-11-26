import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Trash2, Plus, Power, Pencil, X } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '../store/auth'
import TypeIcon from '../components/TypeIcon'
import type { ReminderRule, RecordType } from '../types'
import ReminderMessageEditor from '@/components/ReminderMessageEditor'

const intervalLabel = (days: number) => (days === 0 ? 'On the day' : `${days} days before`)

export default function Renewals() {
  const queryClient = useQueryClient()
  const { hasPermission, user } = useAuthStore()
  const [editRule, setEditRule] = useState<ReminderRule | null>(null)
  const [error, setError] = useState('')
  const [activeType, setActiveType] = useState<number | null>(null)

  const { data: rules, isLoading, error: loadError } = useQuery<ReminderRule[]>({
    queryKey: ['reminder-rules', user?.id],
    queryFn: async () => (await api.get('/reminders/rules')).data,
    retry: 1,
  })

  const { data: recordTypes } = useQuery<RecordType[]>({
    queryKey: ['record-types', user?.id],
    queryFn: async () => (await api.get('/record-types')).data,
  })

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['reminder-rules'] })
    queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const createRule = useMutation({
    mutationFn: async (payload: unknown) => api.post('/reminders/rules', payload),
    onSuccess: invalidate,
    onError: (err: any) => setError(err.response?.data?.error?.message || 'Failed to create rule'),
  })

  const toggleRule = useMutation({
    mutationFn: async (rule: ReminderRule) => api.put(`/reminders/rules/${rule.id}`, { active: !rule.active }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to update rule'),
  })

  const saveRule = useMutation({
    mutationFn: async (arg: { id: number; payload: unknown }) => api.put(`/reminders/rules/${arg.id}`, arg.payload),
    onSuccess: () => { invalidate(); setEditRule(null) },
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to save rule'),
  })

  const deleteRule = useMutation({
    mutationFn: async (id: number) => api.delete(`/reminders/rules/${id}`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to delete rule'),
  })

  const canManage = hasPermission('reminder.create')
  const canEdit = hasPermission('reminder.edit')
  const canDelete = hasPermission('reminder.delete')

  const grouped = new Map<number, ReminderRule[]>()
  for (const rule of rules || []) {
    const list = grouped.get(rule.record_type_id) || []
    list.push(rule)
    grouped.set(rule.record_type_id, list)
  }

  if (isLoading) return <div className="text-gray-500">Loading...</div>
  if (loadError) {
    return <div className="p-4 rounded-md bg-red-50 text-red-700 text-sm">Failed to load reminder rules.</div>
  }

  /* One tab per record type; the selected type shows its rule set */
  // Types with an expiry field first; open on the first one that can have reminders.
  const allTypes = [...(recordTypes || [])].sort((a, b) => Number(!a.reminder_field_id) - Number(!b.reminder_field_id))
  const selectedId = activeType != null && allTypes.some((t) => t.id === activeType)
    ? activeType
    : allTypes[0]?.id ?? null
  const selectedType = allTypes.find((t) => t.id === selectedId)
  const selectedRules = (grouped.get(selectedId ?? -1) || [])
    .slice()
    .sort((a, b) => b.days_before - a.days_before)
  const selectedReminderField = selectedType?.reminder_field_id
    ? (selectedType.fields || []).find((f) => f.id === selectedType.reminder_field_id)?.name
    : null

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Renewals &amp; Reminders</h1>
        <p className="text-sm text-gray-500">
          When a record's renewal/expiry date is within an interval below, the worker notifies all
          active recipients via Telegram.
        </p>
      </div>

      {error && <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">{error}</div>}

      {allTypes.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center text-gray-500">No record types configured yet.</CardContent>
        </Card>
      ) : (
        <>
          {/* Record-type tabs */}
          <div className="flex gap-1 overflow-x-auto border-b border-gray-200 -mb-px [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            {allTypes.map((rt) => {
              const count = (grouped.get(rt.id) || []).length
              const active = rt.id === selectedId
              return (
                <button
                  key={rt.id}
                  onClick={() => setActiveType(rt.id)}
                  aria-pressed={active}
                  title={rt.name}
                  className={`flex items-center gap-2 px-3 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
                    active ? 'border-primary text-primary' : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                  }`}
                >
                  <TypeIcon icon={rt.icon} className={active ? 'h-4 w-4 text-primary' : 'h-4 w-4 text-gray-400'} />
                  {rt.name}
                  {grouped.size > 0 && (
                    <span
                      className={`inline-flex items-center justify-center rounded-full px-1 text-[10px] font-bold h-[18px] min-w-[18px] ${
                        active ? 'bg-primary text-primary-foreground' : 'bg-gray-200 text-gray-600'
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {/* Selected type's rule set */}
          {selectedType && (
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <div className="flex items-center gap-2.5">
                    <div className="h-9 w-9 rounded-md bg-gray-50 border flex items-center justify-center shrink-0">
                      <TypeIcon icon={selectedType.icon} className="h-4 w-4 text-gray-600" />
                    </div>
                    <div>
                      <CardTitle className="text-base">{selectedType.name}</CardTitle>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {selectedReminderField
                          ? <>Reminder field: <span className="text-gray-600">{selectedReminderField}</span></>
                          : <span className="text-amber-600">No renewal/expiry field set - set one in Record Types → Manage fields</span>}
                      </p>
                    </div>
                  </div>
                  <a href={`/records/${selectedType.slug}`} className="text-xs text-primary hover:underline">View records →</a>
                </div>
              </CardHeader>
              <CardContent>
                {selectedRules.length === 0 ? (
                  <div className="py-6 text-center text-gray-500 text-sm border border-dashed rounded-md mb-2">
                    No reminder rules for this type yet.
                  </div>
                ) : (
                  <div className="border rounded-md divide-y">
                    {selectedRules.map((rule) => (
                      <div key={rule.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
                        <div className="w-32 shrink-0">
                          <span className="text-sm font-medium text-gray-800">{intervalLabel(rule.days_before)}</span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <span className="text-xs text-gray-500">{rule.name}</span>
                          {rule.template && <p className="text-[10px] text-gray-400 truncate">custom template</p>}
                        </div>
                        <Badge variant={rule.active ? 'success' : 'secondary'}>{rule.active ? 'Active' : 'Paused'}</Badge>
                        {canEdit && (
                          <button
                            className="p-1.5 rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100"
                            title={rule.active ? 'Pause rule' : 'Resume rule'}
                            onClick={() => toggleRule.mutate(rule)}
                          >
                            <Power className="h-4 w-4" />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            className="p-1.5 rounded text-gray-400 hover:text-gray-800 hover:bg-gray-100"
                            title="Edit rule"
                            onClick={() => setEditRule(rule)}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="p-1.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50"
                            title="Delete rule"
                            onClick={() => { if (confirm(`Delete "${intervalLabel(rule.days_before)}"?`)) deleteRule.mutate(rule.id) }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {canManage && selectedReminderField && (
                  <AddRuleRow
                    onAdd={(days, name) => {
                      setError('')
                      createRule.mutate({ record_type_id: selectedType.id, name: name || intervalLabel(days), days_before: days, active: true })
                    }}
                    existingDays={selectedRules.map((r) => r.days_before)}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Edit rule modal */}
      {selectedType && <ReminderMessageEditor key={selectedType.id} recordType={selectedType} />}
      {editRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setEditRule(null)}>
          <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-lg">Edit reminder rule</CardTitle>
                <button onClick={() => setEditRule(null)} className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  const fd = new FormData(e.target as HTMLFormElement)
                  const days = Number(fd.get('days_before'))
                  const name = String(fd.get('name') || '').trim()
                  const template = String(fd.get('template') || '').trim()
                  const active = fd.get('active') === 'on'
                  saveRule.mutate({
                    id: editRule.id,
                    payload: {
                      name: name || intervalLabel(days),
                      days_before: days,
                      active,
                      template: template || null,
                    },
                  })
                }}
              >
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Days before</label>
                    <Input name="days_before" type="number" min={0} max={365} defaultValue={editRule.days_before} required />
                  </div>
                  <div className="space-y-1">
                    <label className="text-sm font-medium">Name</label>
                    <Input name="name" defaultValue={editRule.name} placeholder={intervalLabel(editRule.days_before)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Rule-specific message (optional)</label>
                  <textarea
                    name="template"
                    defaultValue={editRule.template || ''}
                    placeholder={'🔔 {record_type} Renewal Reminder\n\n{record_name}\n\nRenewal Date: {renewal_date}\nDays Remaining: {days_remaining}\n\nView: {record_url}'}
                    className="flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring font-mono text-xs"
                  />
                  <p className="text-xs text-gray-400">
                    Leave empty to use this record type's shared message. Core variables and this type's field tokens from the message editor below are supported.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input type="checkbox" name="active" defaultChecked={editRule.active} />
                  Rule active
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={() => setEditRule(null)}>Cancel</Button>
                  <Button type="submit" disabled={saveRule.isPending}>
                    {saveRule.isPending ? 'Saving...' : 'Save rule'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}

function AddRuleRow({ onAdd, existingDays }: { onAdd: (days: number, name: string) => void; existingDays: number[] }) {
  const [days, setDays] = useState('')
  const [name, setName] = useState('')
  const dupe = days !== '' && existingDays.includes(Number(days))

  return (
    <form
      className="flex flex-wrap gap-2 items-center pt-3 mt-3 border-t"
      onSubmit={(e) => {
        e.preventDefault()
        const d = Number(days)
        if (isNaN(d) || d < 0 || d > 365 || dupe) return
        onAdd(d, name.trim())
        setDays('')
        setName('')
      }}
    >
      <Input
        type="number"
        min={0}
        max={365}
        placeholder="Days before (0 = on the day)"
        value={days}
        onChange={(e) => setDays(e.target.value)}
        className="w-52 h-9"
      />
      <Input
        placeholder="Custom name (optional)"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-52 h-9"
      />
      <Button type="submit" size="sm" className="h-9" disabled={days === '' || dupe}>
        <Plus className="h-4 w-4 mr-1" /> Add reminder
      </Button>
      {dupe && <span className="text-xs text-red-500">That interval already exists</span>}
    </form>
  )
}
