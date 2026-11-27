import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '@/lib/api'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from '@/components/ui/toaster'
import { apiError } from '@/lib/seats'
import { useAuthStore } from '@/store/auth'
import { cn } from '@/lib/utils'
import type { RecordType, ReminderRule } from '@/types'
import { Toggle, intervalLabel } from './shared'

const PRESETS = [90, 60, 30, 14, 7, 3, 1, 0]

export function TelegramBubble({ text, loading, error }: { text?: string; loading?: boolean; error?: string | null }) {
  return (
    <div className="rounded-2xl bg-gradient-to-b from-sky-50 to-sky-100/60 p-3 sm:p-4">
      <div className={cn('relative max-w-full rounded-2xl rounded-bl-sm bg-white px-3.5 py-2.5 text-sm shadow-sm ring-1 ring-black/5 transition-opacity', loading && 'opacity-60')}>
        {error
          ? <p role="alert" className="text-red-700">{error}</p>
          : <pre data-testid="telegram-message-preview" className="whitespace-pre-wrap break-words font-sans leading-relaxed text-gray-800">{text || ' '}</pre>}
        <span className="mt-1 block text-right text-[10px] text-gray-400">Telegram preview</span>
      </div>
    </div>
  )
}

/** Create or edit one reminder rule, with a live preview of the message it will send. */
export default function RuleDialog({ recordType, rule, existingDays, onClose, onSaved }: {
  recordType: RecordType
  rule: ReminderRule | null
  existingDays: number[]
  onClose: () => void
  onSaved: () => void
}) {
  const user = useAuthStore((s) => s.user)
  const [days, setDays] = useState(String(rule?.days_before ?? 7))
  const [name, setName] = useState(rule?.name ?? '')
  const [active, setActive] = useState(rule?.active ?? true)
  const [custom, setCustom] = useState(!!rule?.template)
  const [template, setTemplate] = useState(rule?.template ?? '')
  const [debounced, setDebounced] = useState({ template, days })
  const [error, setError] = useState('')

  useEffect(() => { const t = setTimeout(() => setDebounced({ template, days }), 350); return () => clearTimeout(t) }, [template, days])
  const d = Number(days)
  const validDays = days !== '' && Number.isInteger(d) && d >= 0 && d <= 365
  const dupe = validDays && existingDays.includes(d) && d !== rule?.days_before
  const previewDays = Math.max(0, Math.min(365, Number(debounced.days) || 0))
  const useCustom = custom && debounced.template.trim().length > 0

  const preview = useQuery<{ text: string; length: number }>({
    queryKey: ['message-preview', user?.id, recordType.id, 'rule', useCustom ? debounced.template : null, previewDays],
    // Without a custom message, leave `template` out so the type's shared message is used.
    queryFn: async () => (await api.post(`/reminders/types/${recordType.id}/message/preview`,
      useCustom ? { template: debounced.template, days_before: previewDays } : { days_before: previewDays })).data,
    retry: false,
  })

  const save = useMutation({
    mutationFn: async () => {
      const payload = { name: name.trim() || intervalLabel(d), days_before: d, active, template: custom && template.trim() ? template.trim() : null }
      return rule ? api.put(`/reminders/rules/${rule.id}`, payload) : api.post('/reminders/rules', { ...payload, record_type_id: recordType.id })
    },
    onSuccess: () => { toast.success(rule ? 'Reminder updated' : 'Reminder added'); onSaved(); onClose() },
    onError: (err) => setError(apiError(err, 'Could not save the reminder')),
  })

  return (
    <Modal size="lg" title={rule ? 'Edit reminder' : 'New reminder'} subtitle={recordType.name} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!validDays || dupe || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Saving…' : rule ? 'Save reminder' : 'Add reminder'}</Button>
    </>}>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
        <div className="min-w-0 space-y-4">
          {error && <div role="alert" className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
          <div className="space-y-1.5">
            <span className="text-sm font-medium">When</span>
            <div className="flex flex-wrap gap-1.5">
              {PRESETS.map((p) => {
                const taken = existingDays.includes(p) && p !== rule?.days_before
                return (
                  <button key={p} type="button" disabled={taken} onClick={() => setDays(String(p))}
                    className={cn('press rounded-full border px-2.5 py-1 text-xs disabled:cursor-not-allowed disabled:opacity-40',
                      String(p) === days ? 'border-primary bg-primary/10 font-medium text-primary' : 'text-gray-600 hover:bg-gray-50')}>
                    {p === 0 ? 'On the day' : `${p}d`}
                  </button>
                )
              })}
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Input aria-label="Days before" type="number" min={0} max={365} value={days} onChange={(e) => setDays(e.target.value)} className="h-9 w-24" />
              <span className="text-sm text-gray-500">days before the renewal date</span>
            </div>
            {dupe && <p className="text-xs text-red-600">This type already has a reminder at that interval.</p>}
            {days !== '' && !validDays && <p className="text-xs text-red-600">Use a whole number from 0 to 365.</p>}
          </div>
          <div className="space-y-1.5">
            <label htmlFor="rule-name" className="text-sm font-medium">Name</label>
            <Input id="rule-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={validDays ? intervalLabel(d) : 'Optional'} />
          </div>
          <div className="flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5">
            <div>
              <p className="text-sm font-medium">Active</p>
              <p className="text-xs text-gray-500">Paused reminders keep their settings but send nothing.</p>
            </div>
            <Toggle checked={active} onChange={setActive} label="Reminder active" />
          </div>
          <div className="space-y-1.5 rounded-lg border px-3 py-2.5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium">Custom message</p>
                <p className="text-xs text-gray-500">Off uses {recordType.name}'s shared message.</p>
              </div>
              <Toggle checked={custom} onChange={setCustom} label="Use a custom message" />
            </div>
            {custom && (
              <textarea aria-label="Rule message" value={template} maxLength={4096} rows={7} onChange={(e) => setTemplate(e.target.value)}
                placeholder={'{record_type} renewal reminder\n\n{record_name}\nRenewal date: {renewal_date}\nDays remaining: {days_remaining}\n\n{record_url}'}
                className="mt-2 w-full rounded-md border bg-background px-3 py-2 font-mono text-xs leading-relaxed animate-pop-in" />
            )}
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-sm font-medium">Preview</p>
          <TelegramBubble text={preview.data?.text} loading={preview.isFetching}
            error={preview.error ? apiError(preview.error, 'This message cannot be previewed.') : null} />
          <p className="text-xs text-gray-500">
            Sample values, {validDays ? intervalLabel(previewDays).toLowerCase() : 'interval pending'}. Previewing sends nothing.
            {preview.data && <> {preview.data.length}/4,096 characters.</>}
          </p>
        </div>
      </div>
    </Modal>
  )
}
