import { useState, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { RefreshCw } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import SearchableSelect from '@/components/SearchableSelect'
import { cn } from '@/lib/utils'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import type { RecordType, RecordField, Employee } from '../types'

export interface EditableRecord {
  updated_at?: string
  id: number
  name: string
  status: string
  values: { [fieldSlug: string]: any }
}

interface Props {
  recordType: RecordType
  record?: EditableRecord | null
  onClose: () => void
  onSaved?: () => void
}

const emptyFormValues = (fields: RecordField[], record?: EditableRecord | null): Record<string, any> => {
  const vals: Record<string, any> = {}
  for (const f of fields) {
    if (f.field_type === 'boolean') vals[f.slug] = false
    else if (f.field_type === 'multi_select') vals[f.slug] = []
    else vals[f.slug] = f.default_value ?? ''
  }
  if (record?.values) {
    for (const [slug, value] of Object.entries(record.values)) {
      if (slug in vals) vals[slug] = value ?? (vals[slug] ?? '')
    }
  }
  return vals
}

const ASSIGNEE_FIELD_NAMES = ['Assigned To', 'Assignee', 'Holder', 'User']
const PRODUCT_FIELD_NAMES = ['Product Name', 'Product', 'License Plan']
const CUSTOM_ASSIGNEE = '__cust_emp__'
const CUSTOM_BU = '__cust_bu__'

export default function DynamicForm({ recordType, record, onClose, onSaved }: Props) {
  const queryClient = useQueryClient()
  const isTracked = !!recordType.track_ownership
  const [values, setValues] = useState<Record<string, any>>(() => emptyFormValues(recordType.fields, record))
  const [name, setName] = useState(record?.name ?? '')
  const [status, setStatus] = useState(record?.status ?? 'active')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [nameTouched, setNameTouched] = useState(false)

  const activeFields = (recordType.fields || [])
    .filter((f) => f.active)
    .sort((a, b) => a.display_order - b.display_order)

  const { data: employees } = useQuery<Employee[]>({
    queryKey: ['employees'],
    queryFn: async () => (await api.get('/employees')).data,
    enabled: isTracked || activeFields.some((f) => f.field_type === 'employee'),
    retry: 1,
  })

  const { data: businessUnits } = useQuery<{ id: number; name: string; active: boolean }[]>({
    queryKey: ['business-units'],
    queryFn: async () => (await api.get('/business-units')).data,
    enabled: activeFields.some((f) => f.field_type === 'business_unit'),
    retry: 1,
  })

  const productField = activeFields.find((f) => PRODUCT_FIELD_NAMES.includes(f.name))
  const assigneeField = activeFields.find((f) => f.field_type === 'employee' || ASSIGNEE_FIELD_NAMES.includes(f.name))

  // Suggested display name for ownership-tracked types: "{Product Name} - {Assigned To}".
  const productLabel = (() => {
    if (!productField) return null
    const v = values[productField.slug]
    if (!v) return null
    const opt = (productField.options || []).find((o) => o.value === v)
    return (opt?.label || String(v))
  })()
  const suggestedName = isTracked
    ? [productLabel, values[assigneeField?.slug ?? '']].filter(Boolean).join(' - ')
    : ''

  // Auto-fill the Name while the user fills the form (create mode only, until touched).
  useEffect(() => {
    if (!isTracked || record || nameTouched) return
    if (suggestedName) setName(suggestedName)
  }, [suggestedName]) // eslint-disable-line react-hooks/exhaustive-deps

  const autoNameMismatch = !!suggestedName && name.trim() !== suggestedName
  const applyAutoName = () => { setName(suggestedName); setNameTouched(false) }

  useEffect(() => {
    setValues(emptyFormValues(recordType.fields, record))
    setName(record?.name ?? '')
    setStatus(record?.status ?? 'active')
    setFieldErrors({})
    setNameTouched(false)
    // Re-derive the form when fields/options change (e.g. options edited in Settings)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recordType.id, record?.id, JSON.stringify((recordType.fields || []).map((f) => [f.slug, f.active, (f.options || []).map((o) => o.value)]))])

  const validate = (): boolean => {
    const errs: Record<string, string> = {}
    for (const f of activeFields) {
      const v = values[f.slug]
      const empty = v === '' || v === null || v === undefined ||
        (Array.isArray(v) && v.length === 0)
      if (f.required && empty && !(record && f.field_type === 'secret')) errs[f.slug] = `${f.name} is required`
    }
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setFieldErrors({})
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (!validate()) return
    setLoading(true)
    try {
      const payload = {
        name: name.trim(),
        status,
        values: activeFields
          .map((f) => ({ field_id: f.id, value: values[f.slug] }))
          .filter((v) => v.value !== '' && v.value !== null && !(Array.isArray(v.value) && v.value.length === 0)),
      }
      if (record) {
        await api.put(`/records/${record.id}`, { ...payload, expected_updated_at: record.updated_at })
      } else {
        await api.post(`/records/by-type/${recordType.id}`, payload)
      }
      queryClient.invalidateQueries({ queryKey: ['records'] })
      queryClient.invalidateQueries({ queryKey: ['record'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
      onSaved?.()
      onClose()
    } catch (err: any) {
      const detail = err.response?.data
      const msg =
        detail?.error?.message ||
        detail?.detail?.error?.message ||
        (typeof detail?.detail === 'string' ? detail.detail : null) ||
        err.message ||
        'Failed to save record'
      setError(msg)
    } finally {
      setLoading(false)
    }
  }

  const setValue = (slug: string, value: any) => {
    setValues((prev) => ({ ...prev, [slug]: value }))
    setFieldErrors((prev) => {
      if (!prev[slug]) return prev
      const next = { ...prev }
      delete next[slug]
      return next
    })
  }

  const renderField = (field: RecordField) => {
    const v = values[field.slug]
    const err = fieldErrors[field.slug]
    const label = (
      <label className="text-sm font-medium">
        {field.name} {field.required && <span className="text-red-500">*</span>}
      </label>
    )
    const errorText = err ? <p className="text-xs text-red-600">{err}</p> : null
    const helpText = field.help_text ? <p className="text-xs text-gray-500">{field.help_text}</p> : null

    const wrap = (input: React.ReactNode) => (
      <div className="space-y-1">
        {label}
        {input}
        {errorText}
        {helpText}
      </div>
    )

    // Employee field: pick from the employee master list (Settings → Employees).
    if (field.field_type === 'employee') {
      const emps = employees || []
      const isCustom = v === CUSTOM_ASSIGNEE || (!!v && !emps.some((e) => e.name === v))
      if (!isCustom) {
        return wrap(
          <SearchableSelect
            options={[
              ...emps.map((e) => {
                const bus = (e.business_units || [])
                const buTag = bus.length ? bus.slice(0, 2).join(' / ') + (bus.length > 2 ? '…' : '') : null
                return { value: e.name, label: buTag ? `${e.name} · ${buTag}` : e.name }
              }),
              { value: CUSTOM_ASSIGNEE, label: 'Other (type manually)…' },
            ]}
            value={v ?? ''}
            onChange={(val) => setValue(field.slug, val)}
            placeholder={field.required ? 'Select employee…' : 'Select employee or leave empty'}
          />
        )
      }
      return wrap(
        <div className="space-y-1">
          <Input
            type="text"
            value={v === CUSTOM_ASSIGNEE ? '' : (v ?? '')}
            onChange={(e) => setValue(field.slug, e.target.value)}
            placeholder="Team / external name"
          />
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setValue(field.slug, '')}>
            ← back to employee list
          </button>
        </div>
      )
    }

    // Business unit field: pick from the business unit master list (Settings → Employees).
    if (field.field_type === 'business_unit') {
      const bus = (businessUnits || []).map((b) => ({ value: b.name, label: b.name }))
      const isCustom = v === CUSTOM_BU || (!!v && !bus.some((b) => b.value === v))
      if (!isCustom) {
        return wrap(
          <SearchableSelect
            options={[
              ...bus,
              { value: CUSTOM_BU, label: 'Other (type manually)…' },
            ]}
            value={v ?? ''}
            onChange={(val) => setValue(field.slug, val)}
            placeholder={field.required ? 'Select business unit…' : 'Select business unit or leave empty'}
          />
        )
      }
      return wrap(
        <div className="space-y-1">
          <Input
            type="text"
            value={v === CUSTOM_BU ? '' : (v ?? '')}
            onChange={(e) => setValue(field.slug, e.target.value)}
            placeholder="Business unit name"
          />
          <button type="button" className="text-xs text-primary hover:underline" onClick={() => setValue(field.slug, '')}>
            ← back to business unit list
          </button>
        </div>
      )
    }

    switch (field.field_type) {
      case 'secret':
        return wrap(<div className="space-y-1"><Input type="password" autoComplete="new-password" value={v ?? ''} onChange={e => setValue(field.slug, e.target.value)} placeholder={record ? 'Leave blank to keep protected value' : 'Protected value'} /><p className="text-xs text-gray-500">Encrypted and masked. Not searchable or included in reminders/exports.</p></div>)
      case 'long_text':
        return wrap(
          <textarea
            className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            value={v ?? ''}
            onChange={(e) => setValue(field.slug, e.target.value)}
          />
        )
      case 'boolean':        return wrap(
          <div className="flex w-fit rounded-md border border-input overflow-hidden" role="group" aria-label={field.name}>
            {[
              { label: 'No', value: false },
              { label: 'Yes', value: true },
            ].map((opt) => {
              const active = v === opt.value || (v == null && opt.value === false)
              return (
                <button
                  key={opt.label}
                  type="button"
                  onClick={() => setValue(field.slug, opt.value)}
                  className={cn(
                    'px-4 py-2 text-sm font-medium transition-colors',
                    active
                      ? opt.value
                        ? 'bg-emerald-500 text-white'
                        : 'bg-gray-400 text-white'
                      : 'bg-white text-gray-500 hover:bg-gray-50',
                  )}
                >
                  {opt.label}
                </button>
              )
            })}
          </div>
        )
      case 'select':
        return wrap(
          <SearchableSelect
            options={(field.options || []).map((opt) => ({ value: opt.value, label: opt.label }))}
            value={v ?? ''}
            onChange={(val) => setValue(field.slug, val as string)}
            placeholder="Select..."
          />
        )
      case 'multi_select':
        return wrap(
          <SearchableSelect
            multiple
            options={(field.options || []).map((opt) => ({ value: opt.value, label: opt.label }))}
            value={Array.isArray(v) ? v : []}
            onChange={(val) => setValue(field.slug, val as string[])}
            placeholder="Select one or more..."
          />
        )
      case 'integer':
      case 'decimal':
      case 'currency':
      case 'percentage':
        return wrap(
          <Input
            type="number"
            step={field.field_type === 'integer' ? 1 : 'any'}
            value={v ?? ''}
            onChange={(e) => setValue(field.slug, e.target.value === '' ? null : Number(e.target.value))}
          />
        )
      case 'date':
        return wrap(<Input type="date" value={v ?? ''} onChange={(e) => setValue(field.slug, e.target.value)} />)
      case 'datetime':
        return wrap(<Input type="datetime-local" value={v ?? ''} onChange={(e) => setValue(field.slug, e.target.value)} />)
      case 'email':
        return wrap(<Input type="email" value={v ?? ''} onChange={(e) => setValue(field.slug, e.target.value)} />)
      case 'url':
        return wrap(<Input type="url" value={v ?? ''} onChange={(e) => setValue(field.slug, e.target.value)} placeholder="https://" />)
      case 'phone':
        return wrap(<Input type="tel" value={v ?? ''} onChange={(e) => setValue(field.slug, e.target.value)} />)
      default:
        return wrap(<Input type="text" value={v ?? ''} onChange={(e) => setValue(field.slug, e.target.value)} />)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-0 sm:p-4" onClick={onClose}>
      <Card className="w-full sm:max-w-2xl max-h-[94vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <CardHeader className="p-4 sm:p-6 pb-2 border-b bg-white z-10">
          <CardTitle className="text-lg">{record ? 'Edit' : 'Add'} {recordType.name}</CardTitle>
        </CardHeader>
        <CardContent className="p-4 sm:p-6 min-h-0 flex-1 overflow-y-auto">
          <form onSubmit={handleSubmit} className="space-y-4" id="record-form">
            {error && (
              <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">
                {error}
                {Object.keys(fieldErrors).length > 0 && (
                  <ul className="mt-1 list-disc list-inside text-xs">
                    {Object.entries(fieldErrors).map(([slug, msg]) => (
                      <li key={slug}>{msg}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4">
              <div className="space-y-1">
                <label className="text-sm font-medium">
                  Name <span className="text-red-500">*</span>
                </label>
                <div className="flex gap-2">
                  <Input value={name} onChange={(e) => { setName(e.target.value); setNameTouched(true) }} required />
                  {isTracked && autoNameMismatch && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-10 shrink-0"
                      title={`Use "${suggestedName}"`}
                      onClick={applyAutoName}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Auto name
                    </Button>
                  )}
                </div>
                {isTracked && (
                  <p className="text-xs text-gray-400">
                    {suggestedName ? <>Suggested: <span className="font-medium">{suggestedName}</span></> : 'Fills automatically as "{Product Name} - {Assigned To}".'}
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label className="text-sm font-medium">Business status</label>
                <SearchableSelect
                  options={[
                    { value: 'active', label: 'Active' },
                    { value: 'inactive', label: 'Inactive' },
                    { value: 'pending', label: 'Pending' },
                    { value: 'expired', label: 'Expired' },
                  ]}
                  value={status}
                  onChange={(v) => setStatus(v as string)}
                  placeholder="Select status"
                />
              </div>
            </div>
            {activeFields.map((field) => (
              <div key={field.id} className={field.field_type === 'long_text' ? 'col-span-full' : ''}>
                {renderField(field)}
              </div>
            ))}
          </form>
        </CardContent>
        {/* Sticky footer */}
        <div className="border-t bg-gray-50 p-3 sm:p-4 flex justify-end gap-2 sticky bottom-0 sm:static">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" form="record-form" disabled={loading}>
            {loading ? 'Saving…' : record ? 'Save Changes' : 'Create Record'}
          </Button>
        </div>
      </Card>
    </div>
  )
}
