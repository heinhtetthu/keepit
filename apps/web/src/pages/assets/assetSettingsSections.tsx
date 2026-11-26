import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Trash2 } from 'lucide-react'
import {
  DEFAULT_SPEC_KEYS, errorMessage, formatSerial, keys, specLabel, useApi, useCurrency, useReference, useSerialSettings, useTemplates,
  type ReferenceItem,
} from '@workspace/core'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toaster'
import { Field } from '@/components/assets/shared'

export const LISTS: { kind: string; label: string }[] = [
  { kind: 'asset_type', label: 'Asset types' }, { kind: 'brand', label: 'Brands' }, { kind: 'location', label: 'Locations' },
  { kind: 'region', label: 'Regions' }, { kind: 'vendor', label: 'Vendors' },
]

/* Asset configuration sections, rendered inside Settings (pages/Settings.tsx). */

function useRefresh(key: readonly unknown[]) {
  const qc = useQueryClient()
  return () => qc.invalidateQueries({ queryKey: key })
}

export function RefList({ kind, label }: { kind: string; label: string }) {
  const core = useApi()
  const { data } = useReference()
  const refresh = useRefresh(keys.reference)
  const [name, setName] = useState('')
  const items: ReferenceItem[] = (data as Record<string, ReferenceItem[]> | undefined)?.[kind] ?? []
  const run = (p: Promise<unknown>, msg: string) => p.then(() => { toast.success(msg); refresh() }).catch((e) => toast.error(errorMessage(e)))
  return (
    <Card><CardHeader className="pb-2"><CardTitle className="text-base">{label}</CardTitle></CardHeader><CardContent className="space-y-2">
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) run(core.reference.add(kind, name.trim()), 'Added').then(() => setName('')) }}>
        <Input placeholder={`Add ${label.toLowerCase().replace(/s$/, '')}`} value={name} onChange={(e) => setName(e.target.value)} />
        <Button type="submit" variant="outline" size="icon" aria-label="Add"><Plus className="h-4 w-4" /></Button>
      </form>
      <ul className="max-h-64 divide-y overflow-auto rounded border">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-2 px-3 py-1.5 text-sm">
            <input className="flex-1 rounded border-transparent bg-transparent px-1 hover:border-gray-200" defaultValue={i.name} aria-label={`Rename ${i.name}`}
              onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== i.name && run(core.reference.update(kind, i.id, e.target.value.trim()), 'Renamed')} />
            <button className="text-gray-400 hover:text-red-600" aria-label={`Delete ${i.name}`} onClick={() => run(core.reference.remove(kind, i.id), 'Removed')}><Trash2 className="h-4 w-4" /></button>
          </li>
        ))}
        {!items.length && <li className="px-3 py-3 text-center text-xs text-gray-400">Empty</li>}
      </ul>
    </CardContent></Card>
  )
}

export function Templates() {
  const core = useApi()
  const { data: ref } = useReference()
  const { data: templates = [] } = useTemplates()
  const refresh = useRefresh(keys.templates)
  const [type, setType] = useState('')
  const [attrs, setAttrs] = useState<string[]>([])
  const [custom, setCustom] = useState('')
  useEffect(() => { setAttrs(templates.find((t) => t.asset_type === type)?.attributes ?? DEFAULT_SPEC_KEYS) }, [type, templates])
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-gray-500">Choose which specification fields appear on the asset form for each type. Types without a template show all standard fields.</p>
      <Field label="Asset type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Choose…</option>{(ref?.asset_type ?? []).map((t) => <option key={t.id}>{t.name}</option>)}</Select></Field>
      {type && <>
        <div className="flex flex-wrap gap-2">
          {[...new Set([...DEFAULT_SPEC_KEYS, ...attrs])].map((k) => (
            <label key={k} className="inline-flex items-center gap-1.5 rounded border px-2 py-1 text-sm">
              <input type="checkbox" checked={attrs.includes(k)} onChange={() => setAttrs(attrs.includes(k) ? attrs.filter((a) => a !== k) : [...attrs, k])} />{specLabel(k)}
            </label>
          ))}
        </div>
        <div className="flex gap-2"><Input placeholder="Custom attribute (e.g. Color)" value={custom} onChange={(e) => setCustom(e.target.value)} /><Button variant="outline" disabled={!custom.trim()} onClick={() => { setAttrs([...attrs, custom.trim()]); setCustom('') }}>Add</Button></div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => core.assets.deleteTemplate(type).then(() => { toast.success('Template removed'); refresh() })}>Reset</Button>
          <Button onClick={() => core.assets.saveTemplate(type, attrs).then(() => { toast.success('Template saved'); refresh() }).catch((e) => toast.error(errorMessage(e)))}>Save</Button>
        </div>
      </>}
    </CardContent></Card>
  )
}

export function Serials() {
  const core = useApi()
  const { data: ref } = useReference()
  const { data: settings = [] } = useSerialSettings()
  const refresh = useRefresh(keys.serials)
  const [type, setType] = useState('')
  const current = settings.find((s) => s.asset_type === type)
  const [f, setF] = useState({ enabled: false, format: '', next_number: 1 })
  useEffect(() => { setF({ enabled: current?.enabled ?? false, format: current?.format ?? '', next_number: current?.next_number ?? 1 }) }, [current, type])
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-gray-500">Generate product numbers for gear without a printed serial. Tokens: <code>{'{YY}'}</code> <code>{'{MM}'}</code> <code>{'{DD}'}</code> <code>{'{SEQ:4}'}</code> <code>{'{TYPE}'}</code>. Example <code>{'UPS-{YY}-{SEQ:4}'}</code>.</p>
      <Field label="Asset type"><Select value={type} onChange={(e) => setType(e.target.value)}><option value="">Choose…</option>{(ref?.asset_type ?? []).map((t) => <option key={t.id}>{t.name}</option>)}</Select></Field>
      {type && <>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.enabled} onChange={(e) => setF({ ...f, enabled: e.target.checked })} />Enable auto numbers for {type}</label>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Format"><Input value={f.format} maxLength={40} onChange={(e) => setF({ ...f, format: e.target.value })} /></Field>
          <Field label="Next number"><Input type="number" min={1} value={f.next_number} onChange={(e) => setF({ ...f, next_number: Number(e.target.value) || 1 })} /></Field>
        </div>
        {f.format && <p className="text-sm">Preview: <b>{formatSerial(f.format, f.next_number, new Date(), type)}</b></p>}
        <div className="flex justify-end"><Button onClick={() => core.assets.saveSerialSetting(type, f).then(() => { toast.success('Saved'); refresh() }).catch((e) => toast.error(errorMessage(e)))}>Save</Button></div>
      </>}
      {settings.length > 0 && <ul className="divide-y rounded border text-sm">{settings.map((s) => <li key={s.asset_type} className="flex justify-between px-3 py-1.5"><span>{s.asset_type}</span><span className="text-gray-500">{s.enabled ? `${s.format} → ${s.preview}` : 'off'}</span></li>)}</ul>}
    </CardContent></Card>
  )
}

export function Currency() {
  const core = useApi()
  const { data } = useCurrency()
  const refresh = useRefresh(keys.currency)
  const [def, setDef] = useState('USD')
  const [rates, setRates] = useState<[string, string][]>([])
  useEffect(() => { if (data) { setDef(data.default_currency); setRates(Object.entries(data.rates).map(([k, v]) => [k, String(v)])) } }, [data])
  return (
    <Card><CardContent className="space-y-3 p-4">
      <Field label="Default currency" hint="Used when a cost has no currency"><Input className="w-32" value={def} onChange={(e) => setDef(e.target.value.toUpperCase())} /></Field>
      <p className="text-xs font-medium text-gray-600">Exchange rates (units of {def} per 1 unit)</p>
      {rates.map(([c, r], i) => (
        <div key={i} className="flex gap-2">
          <Input className="w-28" value={c} placeholder="Code" onChange={(e) => setRates(rates.map((x, j) => j === i ? [e.target.value.toUpperCase(), x[1]] : x))} />
          <Input type="number" min="0" step="any" value={r} onChange={(e) => setRates(rates.map((x, j) => j === i ? [x[0], e.target.value] : x))} />
          <Button variant="ghost" size="icon" aria-label="Remove rate" onClick={() => setRates(rates.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
        </div>
      ))}
      <div className="flex justify-between"><Button variant="outline" size="sm" onClick={() => setRates([...rates, ['', '']])}><Plus className="mr-1 h-4 w-4" />Add rate</Button>
        <Button onClick={() => core.settings.saveCurrency({ default_currency: def, rates: Object.fromEntries(rates.filter(([c, r]) => c && Number(r) > 0).map(([c, r]) => [c, Number(r)])) })
          .then(() => { toast.success('Saved'); refresh() }).catch((e) => toast.error(errorMessage(e)))}>Save</Button></div>
    </CardContent></Card>
  )
}

export function Alerts() {
  const core = useApi()
  const { data: bots = [] } = useQuery({ queryKey: ['telegram-bots'], queryFn: async () => (await api.get('/reminders/bots')).data as { id: number; name: string }[] })
  const { data } = useQuery({ queryKey: ['asset-alerts'], queryFn: core.settings.alerts })
  const [f, setF] = useState({ bot_id: null as number | null, days: 30 })
  const [preview, setPreview] = useState<string | null | undefined>(undefined)
  useEffect(() => { if (data) setF(data) }, [data])
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-gray-500">Once a day the worker sends a Telegram digest of warranties and documents expiring soon and overdue borrows to every recipient of the chosen bot.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Telegram bot"><Select value={f.bot_id ?? ''} onChange={(e) => setF({ ...f, bot_id: e.target.value ? Number(e.target.value) : null })}><option value="">Off</option>{bots.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</Select></Field>
        <Field label="Look-ahead (days)"><Input type="number" min={1} max={365} value={f.days} onChange={(e) => setF({ ...f, days: Number(e.target.value) || 30 })} /></Field>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => core.settings.previewAlerts().then((r) => setPreview(r.message))}>Preview</Button>
        <Button onClick={() => core.settings.saveAlerts(f).then(() => toast.success('Saved')).catch((e) => toast.error(errorMessage(e)))}>Save</Button>
      </div>
      {preview !== undefined && <pre className="whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs">{preview ? preview.replace(/<\/?b>/g, '') : 'Nothing to report today.'}</pre>}
    </CardContent></Card>
  )
}

export function AI() {
  const core = useApi()
  const { data, refetch } = useQuery({ queryKey: ['ai-settings'], queryFn: core.settings.ai })
  const [f, setF] = useState({ base_url: '', model: '', api_key: '' })
  useEffect(() => { if (data) setF({ base_url: data.base_url, model: data.model, api_key: '' }) }, [data])
  return (
    <Card><CardContent className="space-y-3 p-4">
      <p className="text-sm text-gray-500">Used by the Ask Keepit assistant. Any OpenAI-compatible endpoint works (OpenAI, Azure OpenAI, OpenRouter, a local server). Users need the <code>assistant.use</code> permission.</p>
      <Field label="Base URL"><Input value={f.base_url} placeholder="https://api.openai.com/v1" onChange={(e) => setF({ ...f, base_url: e.target.value })} /></Field>
      <Field label="Model"><Input value={f.model} placeholder="e.g. gpt-4o-mini" onChange={(e) => setF({ ...f, model: e.target.value })} /></Field>
      <Field label="API key" hint={data?.has_key ? 'A key is saved (encrypted). Leave empty to keep it.' : 'Stored encrypted.'}><Input type="password" autoComplete="off" value={f.api_key} onChange={(e) => setF({ ...f, api_key: e.target.value })} /></Field>
      <div className="flex items-center justify-between"><span className={`text-sm ${data?.ready ? 'text-green-700' : 'text-gray-500'}`}>{data?.ready ? 'Ready' : 'Not configured'}</span>
        <Button onClick={() => core.settings.saveAi({ base_url: f.base_url, model: f.model, ...(f.api_key ? { api_key: f.api_key } : {}) })
          .then(() => { toast.success('Saved'); refetch(); setF({ ...f, api_key: '' }) }).catch((e) => toast.error(errorMessage(e)))}>Save</Button></div>
    </CardContent></Card>
  )
}
