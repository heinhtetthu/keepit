import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { toast } from '@/components/ui/toaster'
import { useAuthStore } from '../store/auth'
import type { RecordType } from '../types'
import { Select } from '@/components/ui/select'
import { MessageSquareText } from 'lucide-react'
import { TelegramBubble } from '@/components/renewals/RuleDialog'

interface Settings {
  template: string | null
  default_template: string
  effective_template: string
  rule_overrides: number
  variables: { key: string; alias?: string; label: string; kind: 'record' | 'field' }[]
}
interface Preview { text: string; length: number; warnings: string[]; sample: boolean }
const inputClass = 'w-full rounded-md border bg-background px-3 py-2 text-sm'

export default function ReminderMessageEditor({ recordType }: { recordType: RecordType }) {
  const { user, hasPermission } = useAuthStore()
  const queryClient = useQueryClient()
  const textarea = useRef<HTMLTextAreaElement>(null)
  const [draft, setDraft] = useState<string | null>(null)
  const [replaceOverrides, setReplaceOverrides] = useState(false)
  const [recordSearch, setRecordSearch] = useState('')
  const [search, setSearch] = useState('')
  const [recordId, setRecordId] = useState('')
  const [days, setDays] = useState(7)
  const [previewText, setPreviewText] = useState('')
  const key = ['reminder-message', user?.id, recordType.id]
  const canEdit = hasPermission('reminder.edit')
  const canReadRecords = hasPermission('record.view')
  const endpoint = `/reminders/types/${recordType.id}/message`
  const { data, isPending, error } = useQuery<Settings>({
    queryKey: key, queryFn: async () => (await api.get(endpoint)).data,
  })
  const text = draft ?? data?.effective_template ?? ''
  useEffect(() => {
    const timer = setTimeout(() => setPreviewText(text), 350)
    return () => clearTimeout(timer)
  }, [text])
  useEffect(() => {
    const timer = setTimeout(() => setSearch(recordSearch), 300)
    return () => clearTimeout(timer)
  }, [recordSearch])
  const { data: records, isFetching: findingRecords } = useQuery<{ items: { id: number; name: string }[] }>({
    queryKey: ['message-preview-records', user?.id, recordType.id, search],
    queryFn: async () => (await api.get(`/records/by-type/${recordType.id}`, { params: { search: search || undefined, page_size: 25 } })).data,
    enabled: canReadRecords, retry: false,
  })
  const preview = useQuery<Preview>({
    queryKey: ['message-preview', user?.id, recordType.id, previewText, recordId, days],
    queryFn: async () => (await api.post(`${endpoint}/preview`, {
      template: previewText, record_id: recordId ? Number(recordId) : null, days_before: days,
    })).data,
    enabled: !!data && previewText === text, retry: false,
  })
  const save = useMutation({
    mutationFn: async () => (await api.put(endpoint, {
      template: text.trim() === data?.default_template.trim() ? null : text.trim() || null,
      replace_rule_overrides: replaceOverrides,
    })).data as Settings,
    onSuccess: result => {
      queryClient.setQueryData(key, result)
      queryClient.invalidateQueries({ queryKey: ['reminder-rules'] })
      setDraft(null)
      setReplaceOverrides(false)
      toast.success('Telegram message saved')
    },
    onError: (err: any) => toast.error(err.response?.data?.error?.message || 'Could not save the message'),
  })
  const insert = (name: string) => {
    const input = textarea.current
    const from = input?.selectionStart ?? text.length
    const to = input?.selectionEnd ?? text.length
    const token = `{${name}}`
    setDraft(text.slice(0, from) + token + text.slice(to))
    requestAnimationFrame(() => {
      input?.focus()
      input?.setSelectionRange(from + token.length, from + token.length)
    })
  }
  const updating = preview.isFetching || previewText !== text

  return (
    <Card className="animate-page-in">
      <CardHeader className="pb-3">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600"><MessageSquareText className="h-4 w-4" /></span>
          <div className="min-w-0">
            <CardTitle className="text-base">Shared Telegram message</CardTitle>
            <p className="text-sm text-gray-500">Every {recordType.name} reminder sends this, unless the reminder has its own custom message.</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {isPending && <p className="text-sm text-gray-500">Loading message…</p>}
        {error && <p role="alert" className="text-sm text-red-700">Could not load this type's message.</p>}
        {data && <>
          <div className="grid grid-cols-1 gap-5 xl:grid-cols-2">
            <section className="min-w-0 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor={`message-${recordType.id}`} className="text-sm font-medium">Message template</label>
                <span className={`rounded-full px-2 py-0.5 text-xs ${draft !== null ? 'bg-amber-50 text-amber-700' : data.template ? 'bg-violet-50 text-violet-700' : 'bg-gray-100 text-gray-500'}`}>{draft !== null ? 'Unsaved changes' : data.template ? 'Custom message' : 'Default message'}</span>
              </div>
              <textarea id={`message-${recordType.id}`} ref={textarea} value={text} readOnly={!canEdit}
                maxLength={4096} onChange={e => setDraft(e.target.value)} rows={12}
                className={`${inputClass} font-mono text-xs leading-relaxed`} />
              <p className="text-xs text-gray-500">Insert a value at the cursor. Missing field values appear as a dash. An empty message uses the default.</p>
              <details className="rounded-md border p-3 text-xs text-gray-500">
                <summary className="cursor-pointer font-medium">Formatting help</summary>
                <p className="mt-2">Use plain text or basic HTML: <code>{'<b>bold</b>, <i>italic</i>, <u>underline</u>, <s>strike</s>, <code>code</code>'}</code>.</p>
                <p className="mt-2">Links: <code>{'<a href="{record_url}">Open record</a>'}</code>. Use {'{{'} or {'}}'} for literal braces.</p>
                <p className="mt-2">Field buttons insert stable IDs, so renaming a field keeps its value linked. Slug aliases such as {'{field.cost}'} also work while that slug exists.</p>
              </details>
              <p className="text-xs font-medium text-gray-600">Record and reminder values</p>
              <div className="flex flex-wrap gap-1.5">
                {data.variables.filter(v => v.kind === 'record').map(v => <button type="button" key={v.key}
                  disabled={!canEdit} title={`{${v.key}}`} onClick={() => insert(v.key)}
                  className="press rounded-full border bg-gray-50 px-2.5 py-1 text-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50">{v.label}</button>)}
              </div>
              <p className="text-xs font-medium text-gray-600">{recordType.name} fields</p>
              <div className="flex max-h-40 flex-wrap gap-1.5 overflow-auto">
                {data.variables.filter(v => v.kind === 'field').map(v => <button type="button" key={v.key}
                  disabled={!canEdit} title={`{${v.key}} · {${v.alias}}`} onClick={() => insert(v.key)}
                  className="press rounded-full border px-2.5 py-1 text-xs hover:border-primary/40 hover:bg-primary/5 hover:text-primary disabled:opacity-50">{v.label}</button>)}
              </div>
            </section>
            <section className="min-w-0 space-y-3">
              <h4 className="text-sm font-medium">Message preview</h4>
              {canReadRecords && <>
                <label className="block space-y-1 text-xs text-gray-500">Find a record for preview
                  <input className={inputClass} placeholder="Search records for preview" value={recordSearch}
                    onChange={e => { setRecordSearch(e.target.value); setRecordId('') }} />
                </label>
                <Select aria-label="Preview record" className={inputClass} value={recordId} onChange={e => setRecordId(e.target.value)}>
                  <option value="">Sample data</option>
                  {(records?.items || []).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                </Select>
                {findingRecords && <p className="text-xs text-gray-500">Finding records…</p>}
              </>}
              <label className="block space-y-1 text-xs text-gray-500">Preview interval (days before)
                <input type="number" aria-label="Preview interval" min={0} max={365} className={inputClass} value={days}
                  onChange={e => setDays(Math.max(0, Math.min(365, Number(e.target.value) || 0)))} />
              </label>
              <p className="text-xs text-gray-500">{recordId ? 'Uses current record values and expiry date.' : 'Uses example values; sample expiry follows the preview interval.'} Previewing sends no Telegram message.</p>
              {updating && <p role="status" className="text-xs text-gray-500">Updating preview…</p>}
              <TelegramBubble text={preview.data?.text} loading={updating}
                error={preview.error && !updating ? ((preview.error as any)?.response?.data?.error?.message || 'This message cannot be previewed.') : null} />
              {preview.data && !preview.error && !updating && <>
                <p className="text-xs text-gray-500">Text preview · {preview.data.length}/4,096 · Telegram applies the supported HTML formatting.</p>
                {preview.data.warnings.map(w => <p key={w} className="text-xs text-amber-700">{w}</p>)}
              </>}
            </section>
          </div>
          {data.rule_overrides > 0 && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
            <p>{data.rule_overrides} rules have custom messages that take precedence over this shared message.</p>
            {canEdit && <label className="flex gap-2 items-start"><input type="checkbox" className="mt-1" checked={replaceOverrides} onChange={e => setReplaceOverrides(e.target.checked)} />
              Make those rules use this shared message when I save
            </label>}
          </div>}
          <p className="text-xs text-gray-500">Changes apply to newly scheduled reminders. Queued messages and their retries keep the original content.</p>
          {canEdit && <div className="flex flex-wrap gap-2 justify-end border-t pt-3">
            <Button variant="outline" onClick={() => setDraft(data.default_template)} disabled={save.isPending}>Restore default</Button>
            <Button onClick={() => save.mutate()} disabled={save.isPending || updating || !!preview.error || (draft === null && !replaceOverrides)}>
              {save.isPending ? 'Saving…' : 'Save message'}
            </Button>
          </div>}
        </>}
      </CardContent>
    </Card>
  )
}
