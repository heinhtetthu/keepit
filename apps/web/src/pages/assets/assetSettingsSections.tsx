import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Banknote, Check, KeyRound, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import {
  CURRENCIES, DEFAULT_SPEC_KEYS, currencyInfo, currencyLabel, errorMessage, formatSerial, keys, specLabel, useApi, useCurrency, useReference, useSerialSettings, useTemplates,
  type ReferenceItem,
} from '@workspace/core'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Combobox, { type ComboOption } from '@/components/ui/combobox'
import { toast } from '@/components/ui/toaster'
import { Field } from '@/components/assets/shared'
import { cn } from '@/lib/utils'

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

/* ------------------------------------------------------------------ currency */

const CURRENCY_OPTIONS: ComboOption[] = CURRENCIES.map((c) => ({
  value: c.code, label: `${c.code} - ${c.name}`, sublabel: c.symbol !== c.code ? c.symbol : undefined, keywords: c.symbol,
}))

/** Searchable picker over every ISO 4217 currency; stores the code. */
export function CurrencyPicker({ value, onChange, exclude = [], placeholder = 'Choose a currency', className }: {
  value: string | null; onChange: (code: string) => void; exclude?: string[]; placeholder?: string; className?: string
}) {
  const options = useMemo(() => {
    const list = CURRENCY_OPTIONS.filter((o) => !exclude.includes(o.value))
    // Keep a stored code that is no longer in the ISO list selectable.
    return value && !list.some((o) => o.value === value) ? [{ value, label: value }, ...list] : list
  }, [exclude, value])
  return <Combobox options={options} value={value} onChange={(v) => v && onChange(v)} placeholder={placeholder} searchPlaceholder="Search code, name or symbol" className={className} />
}

function parseRate(text: string): number | null {
  const n = Number(text.replace(/[,\s]/g, ''))
  return text.trim() && Number.isFinite(n) && n > 0 ? n : null
}

function fmtNumber(n: number) {
  if (!Number.isFinite(n)) return ''
  const abs = Math.abs(n)
  const digits = abs >= 100 ? 2 : abs >= 1 ? 4 : 6
  return n.toLocaleString(undefined, { maximumFractionDigits: digits })
}

function ago(iso?: string) {
  if (!iso) return null
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return null
  const mins = Math.round((Date.now() - t) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  return days < 45 ? `${days} day${days === 1 ? '' : 's'} ago` : new Date(iso).toLocaleDateString()
}

type RateRow = { code: string; text: string }

export function Currency() {
  const core = useApi()
  const { data } = useCurrency()
  const refresh = useRefresh(keys.currency)
  const [def, setDef] = useState('USD')
  const [rows, setRows] = useState<RateRow[]>([])
  const [saving, setSaving] = useState(false)
  const [amount, setAmount] = useState('100')
  const [from, setFrom] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const inputs = useRef<Record<string, HTMLInputElement | null>>({})
  useEffect(() => {
    if (data) { setDef(data.default_currency); setRows(Object.entries(data.rates).map(([code, v]) => ({ code, text: String(v) }))) }
  }, [data])
  useEffect(() => { if (focus) { inputs.current[focus]?.focus(); setFocus(null) } }, [focus, rows])

  const invalid = rows.filter((r) => parseRate(r.text) === null).map((r) => r.code)
  const savedBase = data?.default_currency ?? 'USD'
  const rates: Record<string, number> = Object.fromEntries(rows.flatMap((r) => { const n = parseRate(r.text); return n ? [[r.code, n]] : [] }))
  const dirty = !!data && (def !== savedBase || JSON.stringify(rates) !== JSON.stringify(data.rates) || rows.length !== Object.keys(data.rates).length)
  const baseInfo = currencyInfo(def)
  const converterFrom = from && (from === def || rates[from]) ? from : rows.find((r) => rates[r.code])?.code ?? null
  const amountNum = Number(amount.replace(/[,\s]/g, ''))

  const add = (code: string) => { setRows([...rows, { code, text: '' }]); setFocus(code) }
  const save = () => {
    setSaving(true)
    core.settings.saveCurrency({ default_currency: def, rates })
      .then(() => { toast.success('Currency settings saved'); refresh() })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setSaving(false))
  }
  const convert = (value: number, code: string, to: string) => {
    const inBase = code === def ? value : value * (rates[code] ?? NaN)
    return to === def ? inBase : inBase / (rates[to] ?? NaN)
  }

  return (
    <div className="space-y-4">
      <Card><CardContent className="space-y-2 p-4">
        <p className="text-sm font-medium text-gray-900">Default currency</p>
        <p className="text-xs text-gray-500">Totals and reports are shown in this currency, and it is used when a cost has no currency of its own.</p>
        <div className="max-w-sm"><CurrencyPicker value={def} onChange={setDef} /></div>
        {def !== savedBase && rows.length > 0 && (
          <p className="rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800">Rates below are now read against {def}. Check each one before saving.</p>
        )}
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm font-medium text-gray-900">Exchange rates</p>
            <p className="text-xs text-gray-500">How many {baseInfo ? `${def} (${baseInfo.name})` : def} one unit of each currency is worth. Costs in these currencies are converted to {def} in totals.</p>
          </div>
          <div className="w-64 max-w-full"><CurrencyPicker value={null} onChange={add} exclude={[def, ...rows.map((r) => r.code)]} placeholder="+ Add currency" /></div>
        </div>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-1 rounded-lg border border-dashed px-4 py-8 text-center">
            <Banknote className="h-6 w-6 text-gray-300" />
            <p className="text-sm font-medium text-gray-700">No exchange rates yet</p>
            <p className="max-w-sm text-xs text-gray-500">Add a currency you pay in, for example USD, and enter what 1 unit is worth in {def}. Costs in currencies without a rate are left out of converted totals.</p>
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {rows.map((r, i) => {
              const bad = invalid.includes(r.code)
              const n = parseRate(r.text)
              const stamp = data?.rates[r.code] === n && savedBase === def ? ago(data?.rates_updated_at?.[r.code]) : null
              return (
                <li key={r.code} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5">
                  <span className="w-12 shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-center text-xs font-semibold text-gray-700" title={currencyLabel(r.code)}>{r.code}</span>
                  <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-gray-700">
                    <span className="whitespace-nowrap">1 {r.code} =</span>
                    <Input ref={(el) => { inputs.current[r.code] = el }} inputMode="decimal" aria-label={`Value of 1 ${r.code} in ${def}`} aria-invalid={bad}
                      className={cn('h-8 w-36 text-right tabular-nums', bad && 'border-red-400 focus-visible:ring-red-300')} placeholder="0.00" value={r.text}
                      onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, text: e.target.value } : x))}
                      onBlur={() => n && setRows(rows.map((x, j) => j === i ? { ...x, text: String(n) } : x))} />
                    <span className="whitespace-nowrap">{def}</span>
                  </div>
                  <span className="text-xs text-gray-400">
                    {bad ? <span className="text-red-600">{r.text.trim() ? 'Enter a number above 0' : 'Enter a rate'}</span>
                      : <>1 {def} = {fmtNumber(1 / (n as number))} {r.code}{stamp && <> · updated {stamp}</>}</>}
                  </span>
                  <Button variant="ghost" size="icon" className="h-8 w-8" aria-label={`Remove ${r.code}`} title={`Remove ${r.code}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                    <Trash2 className="h-4 w-4 text-gray-400" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}

        {Object.keys(rates).length > 0 && converterFrom && (
          <div className="rounded-lg bg-gray-50 p-3">
            <p className="mb-2 text-xs font-medium text-gray-600">Try it</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Input className="h-8 w-28 text-right tabular-nums" inputMode="decimal" aria-label="Amount to convert" value={amount} onChange={(e) => setAmount(e.target.value)} />
              <div className="w-28">
                <Combobox compact options={[def, ...Object.keys(rates)].map((c) => ({ value: c, label: c }))} value={converterFrom} onChange={(v) => v && setFrom(v)} />
              </div>
              <ArrowRight className="h-4 w-4 text-gray-400" />
              <span className="font-medium tabular-nums text-gray-900">
                {Number.isFinite(amountNum)
                  ? converterFrom === def
                    ? Object.keys(rates).slice(0, 3).map((c) => `${fmtNumber(convert(amountNum, def, c))} ${c}`).join(' · ')
                    : `${fmtNumber(convert(amountNum, converterFrom, def))} ${def}`
                  : 'Enter an amount'}
              </span>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-3">
          {invalid.length > 0 && <span className="text-xs text-red-600">Fix {invalid.length === 1 ? 'the highlighted rate' : `${invalid.length} highlighted rates`} to save.</span>}
          {dirty && !invalid.length && <span className="text-xs text-gray-500">Unsaved changes</span>}
          <Button disabled={saving || !dirty || invalid.length > 0} onClick={save}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </CardContent></Card>
    </div>
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

/* ------------------------------------------------------------------ AI provider */

type Provider = { id: string; label: string; base_url: string; models: string[] }
type AiSettings = { provider: string; provider_label: string; base_url: string; model: string; has_key: boolean; ready: boolean }
type ModelList = { models: string[]; source: 'live' | 'static'; message: string | null }

const PROVIDER_HINTS: Record<string, string> = {
  openai: 'GPT models', gemini: 'Gemini models', anthropic: 'Claude models', xai: 'Grok models', mistral: 'Mistral models',
  deepseek: 'DeepSeek chat and reasoner', groq: 'Fast open models', openrouter: 'Many providers, one key', custom: 'Any OpenAI-compatible URL',
}

export function AI() {
  const { data, refetch } = useQuery({ queryKey: ['ai-settings'], queryFn: async () => (await api.get('/settings/ai')).data as AiSettings })
  const { data: providers = [] } = useQuery({ queryKey: ['ai-providers'], queryFn: async () => (await api.get('/settings/ai/providers')).data as Provider[], staleTime: Infinity })
  const [provider, setProvider] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [replacing, setReplacing] = useState(false)
  const [models, setModels] = useState<ModelList | null>(null)
  const [loadingModels, setLoadingModels] = useState(false)
  const [reload, setReload] = useState(0)
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null)
  useEffect(() => {
    if (data) { setProvider(data.provider); setBaseUrl(data.provider === 'custom' ? data.base_url : ''); setModel(data.model); setKey(''); setReplacing(!data.has_key) }
  }, [data])

  const current = providers.find((p) => p.id === provider)
  const isCustom = provider === 'custom'
  const customUnsaved = isCustom && (data?.provider !== 'custom' || baseUrl.trim().replace(/\/+$/, '') !== data?.base_url)
  const pasted = key.trim()

  // Live model list for the chosen provider (debounced while a key is being pasted).
  useEffect(() => {
    if (!provider || customUnsaved) { setModels(null); return }
    let live = true
    const t = setTimeout(() => {
      setLoadingModels(true)
      api.post('/settings/ai/models', { provider, ...(pasted ? { api_key: pasted } : {}) })
        .then((r) => { if (live) setModels(r.data as ModelList) })
        .catch(() => { if (live) setModels(null) })
        .finally(() => { if (live) setLoadingModels(false) })
    }, pasted ? 600 : 0)
    return () => { live = false; clearTimeout(t) }
  }, [provider, pasted, customUnsaved, reload])

  const modelOptions: ComboOption[] = useMemo(() => {
    const ids = models?.models.length ? models.models : current?.models ?? []
    const list = ids.map((m) => ({ value: m, label: m }))
    return model && !ids.includes(model) ? [{ value: model, label: model, sublabel: 'custom' }, ...list] : list
  }, [models, current, model])

  const choose = (id: string) => {
    if (id === provider) return
    const next = providers.find((p) => p.id === id)
    setProvider(id); setResult(null); setModels(null)
    setModel(id === data?.provider ? data.model : next?.models[0] ?? '')
    if (id === 'custom' && data?.provider === 'custom') setBaseUrl(data.base_url)
  }
  const body = () => ({ provider, base_url: isCustom ? baseUrl.trim() : '', model: model.trim(), ...(pasted ? { api_key: pasted } : {}) })
  const save = () => {
    setBusy('save')
    api.put('/settings/ai', body())
      .then(() => { toast.success('AI settings saved'); setKey(''); refetch() })
      .catch((e) => toast.error(errorMessage(e)))
      .finally(() => setBusy(null))
  }
  const removeKey = () => api.put('/settings/ai', { ...body(), api_key: '' })
    .then(() => { toast.success('API key removed'); refetch() }).catch((e) => toast.error(errorMessage(e)))
  const test = () => {
    setBusy('test'); setResult(null)
    api.post('/settings/ai/test', { provider, model: model.trim(), ...(pasted ? { api_key: pasted } : {}) })
      .then((r) => setResult(r.data))
      .catch((e) => setResult({ ok: false, message: errorMessage(e) }))
      .finally(() => setBusy(null))
  }
  const dirty = !!data && (provider !== data.provider || model.trim() !== data.model || !!pasted || (isCustom && customUnsaved))

  return (
    <Card><CardContent className="space-y-5 p-4">
      <p className="text-sm text-gray-500">Powers open-ended questions in the Ask Keepit assistant. Built-in answers work without it. Users need the <code>assistant.use</code> permission.</p>

      <div className="space-y-2">
        <p className="text-xs font-medium text-gray-600">Provider</p>
        <div role="radiogroup" aria-label="AI provider" className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {providers.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={provider === p.id} onClick={() => choose(p.id)}
              className={cn('press flex items-start gap-2 rounded-xl border px-3 py-2.5 text-left transition',
                provider === p.id ? 'border-primary bg-primary-soft ring-1 ring-primary' : 'bg-white hover:border-gray-300 hover:bg-gray-50')}>
              <span className={cn('mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border', provider === p.id ? 'border-primary bg-primary text-primary-foreground' : 'border-gray-300')}>
                {provider === p.id && <Check className="h-3 w-3" />}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-medium text-gray-900">{p.label}</span>
                <span className="block truncate text-[11px] text-gray-500">{PROVIDER_HINTS[p.id] ?? ''}</span>
              </span>
            </button>
          ))}
        </div>
      </div>

      {isCustom && (
        <Field label="Base URL" hint="The OpenAI-compatible API root, ending before /chat/completions. Save it to load models and test.">
          <Input value={baseUrl} placeholder="https://llm.example.com/v1" onChange={(e) => setBaseUrl(e.target.value)} />
        </Field>
      )}

      {provider && (
        <div className="space-y-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-600">Model</span>
            {!customUnsaved && (
              <button type="button" className="inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-primary disabled:opacity-50" disabled={loadingModels} onClick={() => setReload((n) => n + 1)}>
                <RefreshCw className={cn('h-3 w-3', loadingModels && 'animate-spin')} />Refresh list
              </button>
            )}
          </div>
          <Combobox options={modelOptions} value={model || null} allowCustom onChange={(v) => setModel(v ?? '')}
            placeholder="Choose or type a model id" searchPlaceholder="Search or type a model id" emptyText="Type a model id to use it" />
          <p className="text-[11px] text-gray-400">
            {loadingModels ? 'Loading models from the provider…'
              : models?.source === 'live' ? `${models.models.length} models available to this key.`
                : models?.message ?? (customUnsaved ? 'Save the base URL to load models.' : 'Suggested models. You can also type any model id.')}
          </p>
        </div>
      )}

      {provider && (
        <div className="space-y-1">
          <span className="text-xs font-medium text-gray-600">API key</span>
          {data?.has_key && !replacing ? (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-gray-50 px-3 py-2 text-sm">
              <KeyRound className="h-4 w-4 text-gray-400" />
              <span className="flex-1 text-gray-700">A key is saved and encrypted. It is never shown again.</span>
              <Button size="sm" variant="outline" onClick={() => setReplacing(true)}>Replace key</Button>
              <Button size="sm" variant="ghost" className="text-red-600" onClick={removeKey}>Remove</Button>
            </div>
          ) : (
            <div className="flex gap-2">
              <Input type="password" autoComplete="off" spellCheck={false} aria-label="API key" placeholder={`Paste your ${current?.label.replace(/ \(.*\)$/, '') ?? ''} API key`}
                value={key} onChange={(e) => setKey(e.target.value)} />
              {data?.has_key && <Button variant="ghost" onClick={() => { setKey(''); setReplacing(false) }}>Cancel</Button>}
            </div>
          )}
        </div>
      )}

      {result && (
        <p role="status" className={cn('flex items-center gap-2 rounded-lg px-3 py-2 text-sm', result.ok ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-700')}>
          {result.ok ? <Check className="h-4 w-4" /> : <X className="h-4 w-4" />}{result.message}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className={cn('inline-flex items-center gap-1.5 text-sm', data?.ready ? 'text-green-700' : 'text-gray-500')}>
          <span className={cn('h-2 w-2 rounded-full', data?.ready ? 'bg-green-500' : 'bg-gray-300')} />
          {data?.ready ? `Ready: ${data.provider_label}, ${data.model}` : 'Not configured'}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={!!busy || !provider || !model.trim() || customUnsaved || (!pasted && !data?.has_key)} onClick={test}>
            {busy === 'test' ? 'Testing…' : 'Test connection'}
          </Button>
          <Button disabled={!!busy || !dirty || !provider || (isCustom && !baseUrl.trim())} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save'}</Button>
        </div>
      </div>
    </CardContent></Card>
  )
}
