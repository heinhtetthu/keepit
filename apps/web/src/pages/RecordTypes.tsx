import { useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { Settings2, Trash2, X, Plus, CalendarClock, ChevronUp, ChevronDown, Bot, Pencil, TriangleAlert } from 'lucide-react'
import api from '@/lib/api'
import TypeIcon from '../components/TypeIcon'
import IconPicker from '../components/IconPicker'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '../store/auth'
import { cn } from '@/lib/utils'
import { toast } from '@/components/ui/toaster'
import { useViewMode, ViewSwitcher, Pager, VIEW_PAGE_SIZE } from '../components/ViewSwitcher'
import type { RecordType, RecordField, TelegramBot } from '../types'

/* Class for a record-type name that opens its records when permitted */
const nameLinkCls = (can: boolean) =>
  cn('text-left font-medium truncate max-w-[200px] min-w-0', can ? 'text-primary hover:underline cursor-pointer' : 'text-gray-700 cursor-default')

interface FieldDraft {
  name: string
  field_type: string
  required: boolean
  options: string
  help_text: string
}

const FIELD_TYPES = [
  { value: 'text', label: 'Text' },
  { value: 'secret', label: 'Protected text (encrypted, masked, excluded from exports)' },
  { value: 'long_text', label: 'Long Text' },
  { value: 'integer', label: 'Integer' },
  { value: 'decimal', label: 'Decimal' },
  { value: 'currency', label: 'Currency' },
  { value: 'percentage', label: 'Percentage' },
  { value: 'date', label: 'Date' },
  { value: 'datetime', label: 'Date & Time' },
  { value: 'boolean', label: 'Boolean (Yes/No)' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'url', label: 'URL' },
  { value: 'select', label: 'Dropdown (select one)' },
  { value: 'multi_select', label: 'Multi Select' },
  { value: 'employee', label: 'Employee (from employee list)' },
  { value: 'business_unit', label: 'Business Unit (from BU list)' },
]

const emptyField = (): FieldDraft => ({ name: '', field_type: 'text', required: false, options: '', help_text: '' })

const draftToPayload = (draft: FieldDraft, order: number) => ({
  name: draft.name.trim(),
  field_type: draft.field_type,
  required: draft.required,
  show_in_list: true,
  show_in_details: true,
  show_in_reports: true,
  display_order: order,
  help_text: draft.help_text.trim() || null,
  options:
    draft.field_type === 'select' || draft.field_type === 'multi_select'
      ? draft.options
          .split(',')
          .map((o) => o.trim())
          .filter(Boolean)
          .map((o, i) => ({ value: o, label: o, display_order: i }))
      : [],
})

const TYPE_LABELS: Record<string, string> = Object.fromEntries(FIELD_TYPES.map((t) => [t.value, t.label]))

/* ---------------- Field Manager Modal ---------------- */

interface FieldManagerProps {
  recordType: RecordType
  onClose: () => void
  onAddField: (typeId: number, payload: unknown) => void
  onDeleteField: (field: RecordField) => void
  onEditField: (field: RecordField, payload: unknown) => void
  onSetReminder: (typeId: number, fieldId: number | null) => void
  onSetOwnership: (typeId: number, value: boolean) => void
  onReorder: (typeId: number, orderedIds: number[]) => void
  onAddOption: (fieldId: number, value: string) => void
  onDeleteOption: (fieldId: number, optionId: number) => void
  onSetBot: (typeId: number, botId: number | null) => void
  busy: boolean
}

function FieldManagerModal({ recordType, onClose, onAddField, onDeleteField, onEditField, onSetReminder, onSetOwnership, onReorder, onAddOption, onDeleteOption, onSetBot, busy }: FieldManagerProps) {
  const { hasPermission } = useAuthStore()
  const canEditType = hasPermission('record_type.edit')
  const canViewBots = hasPermission('notification.view')
  const canCreateField = hasPermission('field.create')
  const canEditField = hasPermission('field.edit')
  const canDeleteField = hasPermission('field.delete')
  const [draft, setDraft] = useState<FieldDraft>(emptyField())
  const [error, setError] = useState('')
  const [editingField, setEditingField] = useState<RecordField | null>(null)
  const fields = [...(recordType.fields || [])].sort((a, b) => a.display_order - b.display_order)
  const dateFields = fields.filter((f) => f.field_type === 'date' || f.field_type === 'datetime')
  const needsOptions = draft.field_type === 'select' || draft.field_type === 'multi_select'

  const { data: bots } = useQuery<TelegramBot[]>({
    queryKey: ['telegram-bots'],
    queryFn: async () => (await api.get('/reminders/bots')).data,
    enabled: canViewBots,
  })

  const submitField = (e: React.FormEvent) => {
    e.preventDefault()
    if (!draft.name.trim()) return
    onAddField(recordType.id, draftToPayload(draft, fields.length))
    setDraft(emptyField())
  }

  const moveField = (index: number, dir: -1 | 1) => {
    const target = index + dir
    if (target < 0 || target >= fields.length) return
    const ordered = [...fields]
    const [moved] = ordered.splice(index, 1)
    ordered.splice(target, 0, moved)
    try {
      onReorder(recordType.id, ordered.map((f) => f.id))
    } catch (e) {
      setError('Failed to reorder fields')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-white rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <TypeIcon icon={recordType.icon} className="h-5 w-5 text-gray-400" />
              Manage fields
            </h2>
            <p className="text-sm text-gray-500">{recordType.name}</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {error && <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">{error}</div>}

          {/* Reminder field */}
          {canEditType && (
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              <CalendarClock className="h-4 w-4 text-gray-400" />
              Renewal / Expiry field (used for reminders)
            </label>
            <Select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={recordType.reminder_field_id ?? ''}
              onChange={(e) => onSetReminder(recordType.id, e.target.value ? Number(e.target.value) : null)}
            >
              <option value="">None</option>
              {dateFields.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </Select>
            {dateFields.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">Add a Date field below to enable renewal reminders.</p>
            )}
          </div>
          )}
          {canEditType && !!recordType.reminder_field_id && <RenewEarlySetting recordType={recordType} />}

          {/* Telegram recipients are resolved from the users' record-type access - nothing to configure here. */}

          {/* Ownership tracking (opt-in) */}
          {canEditType && (
          <div>
            <label className="flex items-center justify-between cursor-pointer">
              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-700">
                Ownership tracking (reassign + history)
              </span>
              <input
                type="checkbox"
                className="h-4 w-4"
                checked={!!recordType.track_ownership}
                disabled={busy}
                onChange={(e) => onSetOwnership(recordType.id, e.target.checked)}
              />
            </label>
            <p className="text-xs text-gray-400 mt-1">
              {recordType.track_ownership
                ? 'Records of this type have a Reassign button and an ownership history; they appear in the License allocation report.'
                : 'Enable for asset-type records (e.g. license seats) whose holder changes over time. Requires Assigned To / Business Unit / Cost fields by name.'}
            </p>
          </div>
          )}

          {/* Reminder bot for this record type */}
          {canEditType && canViewBots && (
          <div>
            <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
              <Bot className="h-4 w-4 text-gray-400" />
              Reminder bot for this type
            </label>
            <Select
              className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
              value={recordType.telegram_bot_id ?? ''}
              onChange={(e) => onSetBot(recordType.id, e.target.value ? Number(e.target.value) : null)}
              disabled={busy}
            >
              <option value="">Each recipient's own bot</option>
              {(bots || []).map((b) => (
                <option key={b.id} value={b.id}>{b.name}{b.active ? '' : ' (inactive)'}</option>
              ))}
            </Select>
            <p className="text-xs text-gray-400 mt-1">
              {recordType.telegram_bot_id
                ? 'Reminders for this type are sent with this bot only.'
                : 'Reminders are sent with the bot configured for each recipient.'}
            </p>
          </div>
          )}

          {/* Existing fields (reorderable) */}
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">
              Fields <span className="text-gray-400 font-normal">({fields.length})</span>
              {canEditField && ' - drag order with arrows'}
            </h3>
            {fields.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center border border-dashed rounded-md">No fields yet</p>
            ) : (
              <div className="border rounded-md divide-y">
                {fields.map((f, i) => (
                  <div key={f.id}>
                    <div className="flex items-center gap-2 px-3 py-2.5 hover:bg-gray-50">
                      {/* reorder controls */}
                      {canEditField && (
                      <div className="flex flex-col gap-0.5 shrink-0">
                        <button
                          className="p-0.5 text-gray-300 hover:text-gray-700 disabled:invisible"
                          disabled={busy}
                          aria-label={`Move ${f.name} up`}
                          onClick={() => moveField(i, -1)}
                        >
                          <ChevronUp className="h-3.5 w-3.5" />
                        </button>
                        <button
                          className="p-0.5 text-gray-300 hover:text-gray-700 disabled:invisible"
                          disabled={busy}
                          aria-label={`Move ${f.name} down`}
                          onClick={() => moveField(i, 1)}
                        >
                          <ChevronDown className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      )}
                      {canEditField && <span className="text-xs text-gray-400 w-5 shrink-0">{i + 1}</span>}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium text-gray-800">{f.name}</span>
                        {f.required && <span className="text-red-500 ml-0.5">*</span>}
                      </div>
                      <span className="text-xs text-gray-500 whitespace-nowrap">{TYPE_LABELS[f.field_type] || f.field_type}</span>
                      {recordType.reminder_field_id === f.id && (
                        <Badge variant="warning" className="shrink-0">reminder</Badge>
                      )}
                      {canEditField && (
                      <button
                        className="p-1 rounded text-gray-300 hover:text-primary hover:bg-primary/5 shrink-0"
                        disabled={busy}
                        title={`Edit "${f.name}"`}
                        aria-label={`Edit ${f.name}`}
                        onClick={() => setEditingField(f)}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      )}
                      {canDeleteField && (
                      <button
                        className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 shrink-0 disabled:opacity-30"
                        disabled={busy}
                        title={`Delete "${f.name}"`}
                        aria-label={`Delete ${f.name}`}
                        onClick={() => {
                          if (confirm(`Delete field "${f.name}"? Values stored for this field will be removed.`)) {
                            onDeleteField(f)
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                      )}
                    </div>
                    {(f.field_type === 'select' || f.field_type === 'multi_select') && (
                      <div className="px-3 pb-2.5 pl-12 bg-gray-50/50 border-t border-dashed">
                        <div className="pt-2 pb-1 flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-500">
                            Dropdown options ({(f.options || []).length})
                          </span>
                          {canEditField && (
                            <OptionAddForm busy={busy} onAdd={(value) => onAddOption(f.id, value)} />
                          )}
                        </div>
                        <div className="space-y-1.5">
                          {(f.options || []).map((opt) => (
                            <div key={opt.id} className="flex items-center justify-between gap-2 rounded border bg-white px-2.5 py-1.5">
                              <span className="text-xs text-gray-700">{opt.label}</span>
                              {canDeleteField && (
                              <button
                                className="p-0.5 rounded text-gray-300 hover:text-red-600 disabled:opacity-30"
                                disabled={busy}
                                title={`Remove "${opt.label}"`}
                                onClick={() => onDeleteOption(f.id, opt.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </button>
                              )}
                            </div>
                          ))}
                          {(!f.options || f.options.length === 0) && canEditField && (
                            <p className="text-xs text-gray-400">No options yet - add the choices that should appear in forms.</p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Edit an existing field */}
          {editingField && canEditField && (
            <EditFieldModal
              field={editingField}
              onClose={() => setEditingField(null)}
              onSave={(payload) => { onEditField(editingField, payload); setEditingField(null) }}
              busy={busy}
            />
          )}

          {/* Add field */}
          {canCreateField && (
          <div className="border rounded-md p-4 bg-gray-50 space-y-3">
            <h3 className="text-sm font-medium text-gray-700">Add a field</h3>
            <form onSubmit={submitField} className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Field name</label>
                  <Input
                    className="h-9"
                    placeholder="e.g. Account Manager"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Type</label>
                  <Select
                    className="h-9"
                    value={draft.field_type}
                    onChange={(e) => setDraft({ ...draft, field_type: e.target.value })}
                  >
                    {FIELD_TYPES.map((ft) => (
                      <option key={ft.value} value={ft.value}>{ft.label}</option>
                    ))}
                  </Select>
                </div>
              </div>
              {needsOptions && (
                <div className="space-y-1">
                  <label className="text-xs font-medium text-gray-500">Dropdown options (comma-separated)</label>
                  <Input
                    className="h-9"
                    placeholder="e.g. Active, Pending, Closed"
                    value={draft.options}
                    onChange={(e) => setDraft({ ...draft, options: e.target.value })}
                  />
                </div>
              )}
              <div className="flex items-center justify-between gap-3">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4"
                    checked={draft.required}
                    onChange={(e) => setDraft({ ...draft, required: e.target.checked })}
                  />
                  Required
                </label>
                <Button type="submit" size="sm" className="h-9" disabled={busy || !draft.name.trim()}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add field
                </Button>
              </div>
            </form>
            <p className="text-xs text-gray-400">Changes apply immediately - no migrations, existing records are unaffected.</p>
          </div>
          )}
        </div>

        <div className="flex justify-end px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose}>Done</Button>
        </div>
      </div>
    </div>
  )
}

/* ---------------- Page ---------------- */

export default function RecordTypes() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const { hasPermission } = useAuthStore()

  const canCreateType = hasPermission('record_type.create')
  const canEditType = hasPermission('record_type.edit')
  const canCreateField = hasPermission('field.create')
  const canEditField = hasPermission('field.edit')
  const canDeleteField = hasPermission('field.delete')
  const canManageFields = canEditType || canCreateField || canEditField || canDeleteField
  const canDeleteType = hasPermission('record_type.delete')
  const canViewRecords = hasPermission('record.view')
  const canViewBots = hasPermission('notification.view')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ name: '', description: '', icon: '', telegram_bot_id: '' })
  const [fieldDrafts, setFieldDrafts] = useState<FieldDraft[]>([emptyField()])
  const [formError, setFormError] = useState('')
  const [managing, setManaging] = useState<RecordType | null>(null)
  const [editingType, setEditingType] = useState<RecordType | null>(null)
  const [deletingType, setDeletingType] = useState<RecordType | null>(null)
  const [viewMode, setViewMode] = useViewMode('record-types')
  const [page, setPage] = useState(1)
  const changeViewMode = (m: typeof viewMode) => { setViewMode(m); setPage(1) }

  const { data: recordTypes, isLoading, error } = useQuery<RecordType[]>({
    queryKey: ['record-types'],
    queryFn: async () => (await api.get('/record-types')).data,
    retry: 1,
  })

  const { data: bots } = useQuery<TelegramBot[]>({
    queryKey: ['telegram-bots'],
    queryFn: async () => (await api.get('/reminders/bots')).data,
    enabled: canViewBots,
  })

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['record-types'] })

  const createMutation = useMutation({
    mutationFn: async (payload: unknown) => api.post('/record-types', payload),
    onSuccess: () => {
      invalidate()
      setShowCreate(false)
      setForm({ name: '', description: '', icon: '', telegram_bot_id: '' })
      setFieldDrafts([emptyField()])
      setFormError('')
    },
    onError: (err: any) => setFormError(err.response?.data?.error?.message || 'Failed to create record type'),
  })

  const addFieldMutation = useMutation({
    mutationFn: async (arg: { typeId: number; payload: unknown }) =>
      api.post(`/record-types/${arg.typeId}/fields`, arg.payload),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to add field'),
  })

  const editFieldMutation = useMutation({
    mutationFn: async (arg: { fieldId: number; payload: unknown }) =>
      api.put(`/record-types/fields/${arg.fieldId}`, arg.payload),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to update field'),
  })

  const deleteFieldMutation = useMutation({
    mutationFn: async (field: RecordField) => api.delete(`/record-types/fields/${field.id}`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to delete field'),
  })

const setReminderMutation = useMutation({
        mutationFn: async (arg: { typeId: number; fieldId: number | null }) =>
          api.put(`/record-types/${arg.typeId}`, { reminder_field_id: arg.fieldId }),
        onSuccess: invalidate,
        onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to set reminder field'),
      })

  const setOwnershipMutation = useMutation({
    mutationFn: async (arg: { typeId: number; value: boolean }) =>
      api.put(`/record-types/${arg.typeId}`, { track_ownership: arg.value }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to update ownership tracking'),
  })

  const reorderMutation = useMutation({
    mutationFn: async (arg: { typeId: number; ids: number[] }) =>
      api.put(`/record-types/${arg.typeId}/fields/reorder`, { field_ids: arg.ids }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to reorder fields'),
  })

  const addOptionMutation = useMutation({
    mutationFn: async (arg: { fieldId: number; value: string; label?: string }) =>
      api.post(`/record-types/fields/${arg.fieldId}/options`, { value: arg.value, label: arg.label || arg.value }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to add option'),
  })

  const deleteOptionMutation = useMutation({
    mutationFn: async (arg: { fieldId: number; optionId: number }) =>
      api.delete(`/record-types/fields/${arg.fieldId}/options/${arg.optionId}`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to remove option'),
  })

  const setBotMutation = useMutation({
    mutationFn: async (arg: { typeId: number; botId: number | null }) =>
      api.put(`/record-types/${arg.typeId}`, { telegram_bot_id: arg.botId }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to set reminder bot'),
  })

  const deleteTypeMutation = useMutation({
    mutationFn: async (typeId: number) => api.delete(`/record-types/${typeId}`),
    onSuccess: () => {
      invalidate()
      setDeletingType(null)
    },
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to delete record type'),
  })

  const editTypeMutation = useMutation({
    mutationFn: async (arg: { typeId: number; payload: unknown }) =>
      api.put(`/record-types/${arg.typeId}`, arg.payload),
    onSuccess: () => {
      invalidate()
      setEditingType(null)
      setFormError('')
    },
    onError: (err: any) => setFormError(err.response?.data?.error?.message || 'Failed to update record type'),
  })

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault()
    setFormError('')
    const named = fieldDrafts.filter((f) => f.name.trim())
    if (named.length === 0) {
      setFormError('Add at least one field')
      return
    }
    createMutation.mutate({
      name: form.name.trim(),
      description: form.description || null,
      icon: form.icon || null,
      telegram_bot_id: form.telegram_bot_id ? Number(form.telegram_bot_id) : null,
      fields: named.map((draft, idx) => draftToPayload(draft, idx)),
    })
  }

  const busy = addFieldMutation.isPending || deleteFieldMutation.isPending || setReminderMutation.isPending || reorderMutation.isPending

  const allTypes = recordTypes || []
  const pageCount = Math.max(1, Math.ceil(allTypes.length / VIEW_PAGE_SIZE))
  const curPage = Math.min(page, pageCount)
  const shownTypes = allTypes.slice((curPage - 1) * VIEW_PAGE_SIZE, curPage * VIEW_PAGE_SIZE)

  /* Open the type's record list for users who can browse records */
  const openRecords = (slug: string) => canViewRecords && navigate(`/records/${slug}`)

  /* Bottom action cluster shared by all view formats */
  const typeActions = (rt: RecordType) => (
    <div className="flex items-center gap-1 shrink-0">
      {canManageFields && (
        <button
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-primary transition-colors px-1 py-0.5 whitespace-nowrap"
          onClick={(e) => { e.stopPropagation(); setManaging(rt) }}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Manage fields
        </button>
      )}
      {canEditType && (
        <button
          className="p-1.5 rounded text-gray-300 hover:text-primary hover:bg-primary/5 transition-colors"
          title={`Edit "${rt.name}"`}
          aria-label={`Edit ${rt.name}`}
          onClick={(e) => { e.stopPropagation(); setEditingType(rt) }}
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      )}
      {canDeleteType && (
        <button
          className="p-1.5 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 transition-colors"
          title={`Delete "${rt.name}"`}
          aria-label={`Delete ${rt.name}`}
          onClick={(e) => {
            e.stopPropagation()
            setDeletingType(rt)
          }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  )

  /* Meta chips shared by all view formats */
  const fieldsChip = (rt: RecordType) => (
    <span className="inline-flex items-center rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-medium text-gray-600 whitespace-nowrap">
      {rt.fields?.length || 0} fields
    </span>
  )

  const remindersChip = (rt: RecordType, showOff = false) => (
    rt.reminder_field_id ? (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 border border-amber-200/70 px-2 py-0.5 text-[11px] font-medium text-amber-700 whitespace-nowrap shrink-0">
        <CalendarClock className="h-3 w-3" />
        Reminders on
      </span>
    ) : showOff ? (
      <span className="inline-flex items-center rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-400 whitespace-nowrap shrink-0">
        Reminders off
      </span>
    ) : null
  )

  const body = (() => {
    if (error) {
      return <div className="p-4 rounded-md bg-red-50 text-red-700 text-sm">Failed to load record types.</div>
    }
    if (isLoading) {
      return <div className="text-gray-500">Loading...</div>
    }
    if (viewMode === 'thumbnail') {
      return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {shownTypes.map((rt) => (
            <Card key={rt.id} className="group hover:shadow-md transition-shadow">
              <CardContent className="p-5">
                <div
                  className={canViewRecords ? 'cursor-pointer' : ''}
                  onClick={() => openRecords(rt.slug)}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="h-9 w-9 rounded-md bg-gray-50 border flex items-center justify-center shrink-0">
                        <TypeIcon icon={rt.icon} className="h-5 w-5 text-gray-600" />
                      </div>
                      <h3 className="font-semibold text-lg group-hover:text-primary transition-colors truncate" title={rt.name}>{rt.name}</h3>
                    </div>
                    <Badge variant={rt.active ? 'success' : 'secondary'} className="shrink-0">{rt.active ? 'Active' : 'Inactive'}</Badge>
                  </div>
                  <p className="text-sm text-gray-500 mt-2 line-clamp-2">{rt.description || 'No description'}</p>
                </div>
                <div className="flex items-center justify-between gap-2 flex-wrap mt-4 pt-3 border-t">
                  <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                    {fieldsChip(rt)}
                    {remindersChip(rt)}
                  </div>
                  <div className="flex items-center gap-1 ml-auto">{typeActions(rt)}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )
    }
    if (viewMode === 'list') {
      return (
        <div className="border rounded-lg bg-white divide-y shadow-sm">
          {shownTypes.map((rt) => (
            <div key={rt.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 hover:bg-gray-50 transition-colors">
              <div className="h-9 w-9 rounded-md bg-gray-50 border flex items-center justify-center shrink-0">
                <TypeIcon icon={rt.icon} className="h-5 w-5 text-gray-600" />
              </div>
              <button
                className={nameLinkCls(canViewRecords)}
                onClick={() => openRecords(rt.slug)}
                title={rt.name}
              >
                {rt.name}
              </button>
              <span className="text-sm text-gray-500 truncate hidden sm:block flex-1 min-w-[100px]">{rt.description || 'No description'}</span>
              {fieldsChip(rt)}
              {remindersChip(rt)}
              <Badge variant={rt.active ? 'success' : 'secondary'} className="shrink-0">{rt.active ? 'Active' : 'Inactive'}</Badge>
              <div className="flex items-center gap-1 sm:ml-auto">{typeActions(rt)}</div>
            </div>
          ))}
        </div>
      )
    }
    // details
    return (
      <div className="border rounded-lg bg-white overflow-hidden shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b text-left text-xs text-gray-500">
            <tr>
              <th className="px-4 py-2.5 font-medium">Type</th>
              <th className="px-4 py-2.5 font-medium">Description</th>
              <th className="px-4 py-2.5 font-medium">Fields</th>
              <th className="px-4 py-2.5 font-medium">Reminders</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {shownTypes.map((rt) => (
              <tr key={rt.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <div className="h-8 w-8 rounded-md bg-gray-50 border flex items-center justify-center shrink-0">
                      <TypeIcon icon={rt.icon} className="h-4 w-4 text-gray-600" />
                    </div>
                    <button className={nameLinkCls(canViewRecords)} onClick={() => openRecords(rt.slug)} title={rt.name}>{rt.name}</button>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-gray-500 max-w-[320px] truncate" title={rt.description || ''}>{rt.description || 'No description'}</td>
                <td className="px-4 py-2.5 text-gray-600">{fieldsChip(rt)}</td>
                <td className="px-4 py-2.5">{remindersChip(rt, true)}</td>
                <td className="px-4 py-2.5">
                  <Badge variant={rt.active ? 'success' : 'secondary'}>{rt.active ? 'Active' : 'Inactive'}</Badge>
                </td>
                <td className="px-4 py-2.5 text-right">{typeActions(rt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  })()

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">Record Types</h1>
          <p className="text-sm text-gray-500">
            {canViewRecords && canManageFields
              ? 'Click a type to view its records, or manage its fields.'
              : canViewRecords
                ? 'Click a type to view its records.'
                : canManageFields
                  ? 'Manage the fields of each record type.'
                  : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ViewSwitcher mode={viewMode} onChange={changeViewMode} />
          {canCreateType && <Button onClick={() => setShowCreate(true)}>+ Create Record Type</Button>}
        </div>
      </div>

      {body}

      {allTypes.length > 0 && allTypes.length > VIEW_PAGE_SIZE && (
        <Pager page={curPage} pages={pageCount} onPage={setPage} />
      )}

      {/* Manage fields modal */}
      {managing && (
        <FieldManagerModal
          recordType={(recordTypes || []).find((rt) => rt.id === managing.id) ?? managing}
          onClose={() => setManaging(null)}
          onAddField={(typeId, payload) => addFieldMutation.mutate({ typeId, payload })}
          onDeleteField={(f) => deleteFieldMutation.mutate(f)}
          onEditField={(f, payload) => editFieldMutation.mutate({ fieldId: f.id, payload })}
              onSetReminder={(typeId, fieldId) => setReminderMutation.mutate({ typeId, fieldId })}
              onSetOwnership={(typeId, value) => setOwnershipMutation.mutate({ typeId, value })}
          onReorder={(typeId, ids) => reorderMutation.mutate({ typeId, ids })}
          onAddOption={(fieldId, value) => addOptionMutation.mutate({ fieldId, value })}
          onDeleteOption={(fieldId, optionId) => deleteOptionMutation.mutate({ fieldId, optionId })}
          onSetBot={(typeId, botId) => setBotMutation.mutate({ typeId, botId })}
          busy={busy}
        />
      )}

      {/* Edit type modal (admin) */}
      {editingType && (
        <EditTypeModal
          recordType={editingType}
          onClose={() => setEditingType(null)}
          onSave={(payload) => editTypeMutation.mutate({ typeId: editingType.id, payload })}
          busy={editTypeMutation.isPending}
        />
      )}

      {/* Double-confirmation delete modal */}
      {deletingType && (
        <DeleteTypeModal
          recordType={deletingType}
          recordCount={allTypes.find((rt) => rt.id === deletingType.id)?.fields?.length ?? 0}
          onClose={() => setDeletingType(null)}
          onConfirm={() => deleteTypeMutation.mutate(deletingType.id)}
          busy={deleteTypeMutation.isPending}
        />
      )}

      {/* Create modal */}
      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowCreate(false)}>
          <div className="w-full max-w-2xl max-h-[85vh] flex flex-col bg-white rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b">
              <h2 className="text-lg font-semibold">Create Record Type</h2>
              <button onClick={() => setShowCreate(false)} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" aria-label="Close">
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleCreate} className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
              {formError && <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">{formError}</div>}

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-gray-500">Name *</label>
                  <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Insurance" required />
                </div>
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-gray-500">Description</label>
                  <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
                </div>
                <div className="space-y-1 md:col-span-1">
                  <label className="text-xs font-medium text-gray-500">Icon</label>
                  <IconPicker value={form.icon} onChange={(v) => setForm({ ...form, icon: v })} />
                </div>
              </div>

              {canViewBots && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-gray-500 flex items-center gap-1.5">
                  <Bot className="h-3.5 w-3.5" /> Reminder bot (optional)
                </label>
                <Select
                  className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
                  value={form.telegram_bot_id}
                  onChange={(e) => setForm({ ...form, telegram_bot_id: e.target.value })}
                >
                  <option value="">Each recipient's own bot</option>
                  {(bots || []).map((b) => (
                    <option key={b.id} value={b.id}>{b.name}{b.active ? '' : ' (inactive)'}</option>
                  ))}
                </Select>
                <p className="text-xs text-gray-400">When set, reminders for this type are sent with this bot only.</p>
              </div>
              )}


              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-gray-700">
                    Fields <span className="text-gray-400 font-normal">(define at least one)</span>
                  </h3>
                  <Button type="button" variant="outline" size="sm" onClick={() => setFieldDrafts([...fieldDrafts, emptyField()])}>
                    <Plus className="h-4 w-4 mr-1" /> Add field
                  </Button>
                </div>

                <div className="space-y-2">
                  {fieldDrafts.map((draft, idx) => {
                    const needsOptions = draft.field_type === 'select' || draft.field_type === 'multi_select'
                    const update = (patch: Partial<FieldDraft>) => {
                      const next = [...fieldDrafts]
                      next[idx] = { ...next[idx], ...patch }
                      setFieldDrafts(next)
                    }
                    return (
                      <div key={idx} className="rounded-md border p-3 bg-gray-50 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-gray-400">Field {idx + 1}</span>
                          <button
                            type="button"
                            className="p-1 rounded text-gray-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-30"
                            onClick={() => setFieldDrafts(fieldDrafts.filter((_, i) => i !== idx))}
                            disabled={fieldDrafts.length <= 1}
                            title={fieldDrafts.length <= 1 ? 'At least one field is required' : 'Remove'}
                            aria-label={`Remove field ${idx + 1}`}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500">Field name</label>
                            <Input
                              className="h-9"
                              placeholder="e.g. Policy Number"
                              value={draft.name}
                              onChange={(e) => update({ name: e.target.value })}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs font-medium text-gray-500">Type</label>
                            <Select
                              className="h-9"
                              value={draft.field_type}
                              onChange={(e) => update({ field_type: e.target.value })}
                            >
                              {FIELD_TYPES.map((ft) => (
                                <option key={ft.value} value={ft.value}>{ft.label}</option>
                              ))}
                            </Select>
                          </div>
                        </div>
                        <div className="flex flex-col md:flex-row md:items-end gap-2.5">
                          <div className="space-y-1 flex-1">
                            <label className="text-xs font-medium text-gray-500">
                              {needsOptions ? 'Dropdown options (comma-separated)' : 'Help text (optional)'}
                            </label>
                            <Input
                              className="h-9"
                              placeholder={needsOptions ? 'Active, Pending, Closed' : 'Shown under the field in forms'}
                              value={needsOptions ? draft.options : draft.help_text}
                              onChange={(e) => update(needsOptions ? { options: e.target.value } : { help_text: e.target.value })}
                            />
                          </div>
                          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer pb-2">
                            <input
                              type="checkbox"
                              className="h-4 w-4"
                              checked={draft.required}
                              onChange={(e) => update({ required: e.target.checked })}
                            />
                            Required
                          </label>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </form>
            <div className="flex justify-end gap-2 px-6 py-4 border-t">
              <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
              <Button onClick={handleCreate} disabled={createMutation.isPending}>
                {createMutation.isPending ? 'Creating...' : 'Create record type'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function EditFieldModal({ field, onClose, onSave, busy }: {
  field: RecordField
  onClose: () => void
  onSave: (payload: unknown) => void
  busy: boolean
}) {
  const [form, setForm] = useState({ name: field.name, field_type: field.field_type, required: field.required })
  const isCurrentType = form.field_type === field.field_type
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm bg-white rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold">Edit field</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            if (!form.name.trim()) return
            onSave({
              name: form.name.trim(),
              field_type: form.field_type,
              required: form.required,
            })
          }}
          className="px-5 py-4 space-y-4"
        >
          <div className="space-y-1">
            <label className="text-sm font-medium">Field name <span className="text-red-500">*</span></label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
            <p className="text-xs text-gray-400">Renaming keeps the values already stored.</p>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Field type</label>
            <Select
              value={form.field_type}
              onChange={(e) => setForm({ ...form, field_type: e.target.value })}
            >
              {FIELD_TYPES.map((ft) => (
                <option key={ft.value} value={ft.value}>{ft.label}</option>
              ))}
            </Select>
            {!isCurrentType && (
              <p className="text-xs text-amber-600">
                Changing the type changes how existing values are interpreted.
              </p>
            )}
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer">
            <input
              type="checkbox"
              className="h-4 w-4"
              checked={form.required}
              onChange={(e) => setForm({ ...form, required: e.target.checked })}
            />
            Required
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>Save changes</Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function OptionAddForm({ busy, onAdd }: { busy: boolean; onAdd: (value: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="flex gap-1.5 pt-1"
      onSubmit={(e) => {
        e.preventDefault()
        const v = value.trim()
        if (!v) return
        onAdd(v)
        setValue('')
      }}
    >
      <Input
        className="h-8 text-xs"
        placeholder="New option (e.g. Active)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <Button type="submit" size="sm" className="h-8" disabled={busy || !value.trim()}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </form>
  )
}

/* ---------------- Double-confirm delete modal ---------------- */

function DeleteTypeModal({ recordType, recordCount, onClose, onConfirm, busy }: {
  recordType: RecordType
  recordCount: number
  onClose: () => void
  onConfirm: () => void
  busy: boolean
}) {
  const [step, setStep] = useState<1 | 2>(1)
  const [ack, setAck] = useState(false)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold flex items-center gap-2 text-red-600">
            <TriangleAlert className="h-5 w-5" />
            {step === 1 ? 'Delete record type' : 'Final confirmation'}
          </h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {step === 1 ? (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-700">
              You are about to delete <span className="font-semibold">{recordType.name}</span>.
            </p>
            <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm space-y-1">
              <p>Every record of this type will be <strong>permanently deleted</strong>.</p>
              <p className="text-xs text-red-500">This includes all field values, imported data and history. This cannot be undone.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="button" className="bg-red-600 hover:bg-red-700 text-white" onClick={() => setStep(2)}>
                Continue
              </Button>
            </div>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-4">
            <p className="text-sm text-gray-700">
              Delete <span className="font-semibold">{recordType.name}</span>
              {recordCount > 0 && <> and its <span className="font-semibold">{recordCount}</span> field definitions</>}
              {recordCount > 0 ? ', including every stored record value?' : '?'}
            </p>
            <label className="flex items-start gap-2 text-sm cursor-pointer">
              <input type="checkbox" className="mt-0.5 h-4 w-4 accent-red-600" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span className="text-gray-700">I understand this action is permanent and cannot be undone.</span>
            </label>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={onClose}>Keep it</Button>
              <Button
                type="button"
                className="bg-red-600 hover:bg-red-700 text-white"
                disabled={!ack || busy}
                onClick={onConfirm}
              >
                {busy ? 'Deleting...' : 'Delete permanently'}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/* ---------------- Edit record type (name / description / icon) ---------------- */

function EditTypeModal({ recordType, onClose, onSave, busy }: {
  recordType: RecordType
  onClose: () => void
  onSave: (payload: { name: string; description: string | null; icon: string | null }) => void
  busy: boolean
}) {
  const [form, setForm] = useState({
    name: recordType.name,
    description: recordType.description || '',
    icon: recordType.icon || '',
  })
  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name.trim()) return
    onSave({
      name: form.name.trim(),
      description: form.description.trim() || null,
      icon: form.icon || null,
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-md bg-white rounded-lg shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold">Edit record type</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600" aria-label="Close">
          <X className="h-5 w-5" />
          </button>
        </div>
        <form onSubmit={submit} className="px-5 py-4 space-y-4">
          <div className="space-y-1">
            <label className="text-sm font-medium">Name <span className="text-red-500">*</span></label>
            <Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required autoFocus />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Description</label>
            <Input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Optional" />
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium">Icon</label>
            <IconPicker value={form.icon} onChange={(v) => setForm({ ...form, icon: v })} />
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy || !form.name.trim()}>
              {busy ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

const EARLY_PRESETS = [7, 14, 30, 60, 90]

/** Type-wide "renew N days before expiry" (e.g. domains renewed 30 days early). */
function RenewEarlySetting({ recordType }: { recordType: RecordType }) {
  const qc = useQueryClient()
  const save = useMutation({
    mutationFn: async (days: number) => api.put(`/record-types/${recordType.id}`, { renew_before_days: days }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['record-types'] }); toast.success('Renewal timing saved') },
    onError: (err: any) => toast.error(err?.response?.data?.error?.message || 'Could not save renewal timing'),
  })
  const current = recordType.renew_before_days ?? 0
  return (
    <div>
      <label className="flex items-center gap-1.5 text-sm font-medium text-gray-700 mb-1.5">
        <CalendarClock className="h-4 w-4 text-gray-400" />
        Renew early
      </label>
      <Select
        className="w-full h-10 rounded-md border border-input bg-background px-3 text-sm"
        value={current}
        disabled={save.isPending}
        onChange={(e) => save.mutate(Number(e.target.value))}
      >
        <option value={0}>On the expiry date</option>
        {!EARLY_PRESETS.includes(current) && current > 0 && <option value={current}>{current} days before expiry</option>}
        {EARLY_PRESETS.map((d) => <option key={d} value={d}>{d} days before expiry</option>)}
      </Select>
      <p className="text-xs text-gray-400 mt-1">
        Auto-renew records renew this many days early and their expiry moves forward right away (useful for domains, so nobody can grab them).
        Records with auto-renew off get their alert on that day. Single records can still override this.
      </p>
    </div>
  )
}
