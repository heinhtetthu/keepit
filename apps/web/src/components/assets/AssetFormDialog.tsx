import { useMemo, useState } from 'react'
import { Wand2 } from 'lucide-react'
import { DEFAULT_SPEC_KEYS, errorMessage, specLabel, todayISO, useApi, useAssetMutation, useCurrency, useReference, useSerialSettings, useTemplates, type Asset, type AssetCreate } from '@workspace/core'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Combobox from '@/components/ui/combobox'
import { toast } from '@/components/ui/toaster'
import { EmployeePicker, Field, inputCls } from './shared'

type Form = Omit<AssetCreate, 'specs'> & { specs: Record<string, string> }

/** Create or edit an asset. Spec fields follow the type's template. */
export default function AssetFormDialog({ asset, onClose, onSaved }: { asset?: Asset; onClose: () => void; onSaved?: (a: Asset) => void }) {
  const api = useApi()
  const { data: ref } = useReference()
  const { data: templates = [] } = useTemplates()
  const { data: serials = [] } = useSerialSettings()
  const { data: currency } = useCurrency()
  const [form, setForm] = useState<Form>(() => asset ? {
    asset_type: asset.asset_type, other_type_name: asset.other_type_name, brand: asset.brand, model: asset.model,
    serial_number: asset.serial_number, location: asset.location, specs: Object.fromEntries(Object.entries(asset.specs ?? {}).map(([k, v]) => [k, v ?? ''])),
    purchase_date: asset.purchase_date, purchase_cost: asset.purchase_cost, currency: asset.currency, supplier: asset.supplier,
    warranty_end_date: asset.warranty_end_date, notes: asset.notes,
  } : { asset_type: '', specs: {}, currency: undefined })
  const [extraKey, setExtraKey] = useState('')
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const specKeys = useMemo(() => {
    const t = templates.find((x) => x.asset_type === form.asset_type)
    const base = t ? t.attributes : DEFAULT_SPEC_KEYS
    return [...new Set([...base, ...Object.keys(form.specs)])]
  }, [templates, form.asset_type, form.specs])
  const autoSerial = serials.find((s) => s.asset_type === form.asset_type && s.enabled)

  const save = useAssetMutation(async (a, _: void) => {
    const body = { ...form, purchase_cost: form.purchase_cost === '' ? null : form.purchase_cost, currency: form.currency || (form.purchase_cost ? currency?.default_currency : null) }
    return asset ? a.assets.update(asset.id, body) : a.assets.create(body as AssetCreate)
  })

  const opts = (kind: keyof NonNullable<typeof ref>) => (ref?.[kind] ?? []).map((i) => ({ value: i.name, label: i.name }))

  return (
    <Modal size="lg" title={asset ? 'Edit asset' : 'Add asset'} subtitle={asset?.display_name} onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!form.asset_type || save.isPending} onClick={() => save.mutate(undefined, {
        onSuccess: (a) => { toast.success(asset ? 'Asset updated' : 'Asset added'); onSaved?.(a); onClose() },
        onError: (e) => toast.error(errorMessage(e)),
      })}>{save.isPending ? 'Saving…' : asset ? 'Save changes' : 'Add asset'}</Button>
    </>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Asset type" required>
          <Combobox value={form.asset_type || null} onChange={(v) => set('asset_type', v ?? '')} options={opts('asset_type')} allowCustom placeholder="Laptop, Monitor…" />
        </Field>
        {form.asset_type === 'Other' && <Field label="Type name"><Input value={form.other_type_name ?? ''} onChange={(e) => set('other_type_name', e.target.value)} /></Field>}
        <Field label="Brand"><Combobox value={form.brand ?? null} onChange={(v) => set('brand', v)} options={opts('brand')} allowCustom placeholder="Brand" /></Field>
        <Field label="Model"><Input value={form.model ?? ''} onChange={(e) => set('model', e.target.value)} /></Field>
        <Field label="Serial / product number">
          <div className="flex gap-2">
            <Input value={form.serial_number ?? ''} onChange={(e) => set('serial_number', e.target.value)} />
            {autoSerial && (
              <Button type="button" variant="outline" size="icon" title="Generate next product number" onClick={async () => {
                try { set('serial_number', (await api.assets.generateSerial(form.asset_type)).serial) } catch (e) { toast.error(errorMessage(e)) }
              }}><Wand2 className="h-4 w-4" /></Button>
            )}
          </div>
        </Field>
        <Field label="Location"><Combobox value={form.location ?? null} onChange={(v) => set('location', v)} options={opts('location')} allowCustom placeholder="Location" /></Field>
        <Field label="Supplier"><Combobox value={form.supplier ?? null} onChange={(v) => set('supplier', v)} options={opts('vendor')} allowCustom placeholder="Vendor" /></Field>
        <Field label="Purchase date"><Input type="date" value={form.purchase_date ?? ''} max={todayISO()} onChange={(e) => set('purchase_date', e.target.value || null)} /></Field>
        <Field label="Warranty ends"><Input type="date" value={form.warranty_end_date ?? ''} onChange={(e) => set('warranty_end_date', e.target.value || null)} /></Field>
        <Field label="Purchase cost">
          <div className="flex gap-2">
            <Input type="number" min="0" step="0.01" value={form.purchase_cost ?? ''} onChange={(e) => set('purchase_cost', e.target.value || null)} />
            <Input className="w-24" placeholder={currency?.default_currency ?? 'USD'} value={form.currency ?? ''} onChange={(e) => set('currency', e.target.value.toUpperCase() || null)} />
          </div>
        </Field>
        {!asset && <Field label="Assign to (optional)"><EmployeePicker value={(form as AssetCreate).employee_id ?? null} onChange={(id) => setForm((f) => ({ ...f, employee_id: id }))} /></Field>}
      </div>

      <fieldset className="mt-4 rounded-lg border p-3">
        <legend className="px-1 text-xs font-medium text-gray-600">Specifications</legend>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {specKeys.map((k) => (
            <Field key={k} label={specLabel(k)}>
              <Input value={form.specs[k] ?? ''} onChange={(e) => set('specs', { ...form.specs, [k]: e.target.value })} />
            </Field>
          ))}
        </div>
        <div className="mt-3 flex gap-2">
          <input className={inputCls} placeholder="Add another attribute (e.g. Color)" value={extraKey} onChange={(e) => setExtraKey(e.target.value)} />
          <Button type="button" variant="outline" disabled={!extraKey.trim()} onClick={() => { set('specs', { ...form.specs, [extraKey.trim()]: '' }); setExtraKey('') }}>Add</Button>
        </div>
      </fieldset>
      <Field label="Notes" className="mt-3"><textarea className={`${inputCls} h-20`} value={form.notes ?? ''} onChange={(e) => set('notes', e.target.value)} /></Field>
    </Modal>
  )
}
