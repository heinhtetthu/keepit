import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Sparkles } from 'lucide-react'
import { errorMessage, useApi, useAssetMutation, useAssets, useReference, type Document, type ExtractionRun } from '@workspace/core'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import Combobox from '@/components/ui/combobox'
import { toast } from '@/components/ui/toaster'
import { EmployeePicker, Field } from '@/components/assets/shared'

/** AI extraction: pick type → run → review/correct → confirm. Nothing is saved until Confirm. */
export default function ExtractionDialog({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const api = useApi()
  const { data: types = [] } = useQuery({ queryKey: ['extraction-types'], queryFn: api.extraction.docTypes, staleTime: Infinity })
  const [docType, setDocType] = useState(doc.category === 'Warranty' ? 'warranty' : doc.category === 'Repair Record' ? 'repair' : doc.category === 'Contract' ? 'contract' : doc.category === 'License' ? 'license' : 'invoice')
  const [run, setRun] = useState<ExtractionRun | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [rows, setRows] = useState<Record<string, string | null>[]>([])
  const [assetId, setAssetId] = useState<number | null>(doc.links.find((l) => l.entity_type === 'asset')?.entity_id ?? null)
  const [employeeId, setEmployeeId] = useState<number | null>(doc.links.find((l) => l.entity_type === 'employee')?.entity_id ?? null)
  const [newType, setNewType] = useState('Laptop')
  const [running, setRunning] = useState(false)
  const type = types.find((t) => t.key === docType)
  const { data: ref } = useReference()
  const { data: assets } = useAssets({ page_size: 500, sort: 'brand', order: 'asc' })

  useEffect(() => {
    api.extraction.runs(doc.id).then((rs) => {
      const latest = rs.find((r) => r.status === 'success')
      if (latest) { setRun(latest); setDocType(latest.doc_type); setValues(Object.fromEntries(Object.entries(latest.result?.fields ?? {}).map(([k, v]) => [k, v ?? '']))); setRows(latest.result?.rows ?? []) }
    }).catch(() => undefined)
  }, [api, doc.id])

  const start = async () => {
    setRunning(true)
    try {
      const r = await api.extraction.run(doc.id, docType)
      setRun(r)
      if (r.status === 'failed') toast.error(r.error || 'Extraction failed')
      setValues(Object.fromEntries(Object.entries(r.result?.fields ?? {}).map(([k, v]) => [k, v ?? ''])))
      setRows(r.result?.rows ?? [])
    } catch (e) { toast.error(errorMessage(e)) } finally { setRunning(false) }
  }

  const target = useMemo(() => {
    if (docType === 'invoice' || docType === 'warranty') return assetId ? { asset_id: assetId } : { create_asset: { asset_type: newType } }
    if (docType === 'repair' || docType === 'maintenance') return { asset_id: assetId }
    if (docType === 'contract') return employeeId ? { employee_id: employeeId } : {}
    return {}
  }, [docType, assetId, employeeId, newType])
  const confirm = useAssetMutation((a, _: void) => a.extraction.confirm(run!.id, type?.row_based ? { rows } : values, target))
  const reject = useAssetMutation((a, _: void) => a.extraction.reject(run!.id))
  const reviewing = run?.status === 'success' && run.doc_type === docType
  const conf = run?.result?.confidence ?? {}

  return (
    <Modal size="lg" title={<span className="inline-flex items-center gap-1.5"><Sparkles className="h-4 w-4 text-violet-500" />Extract with AI</span>} subtitle={doc.title} onClose={onClose} footer={reviewing ? <>
      <Button variant="outline" className="mr-auto" onClick={() => reject.mutate(undefined, { onSuccess: () => { toast.info('Extraction discarded'); onClose() } })}>Discard</Button>
      <Button variant="outline" onClick={onClose}>Later</Button>
      <Button disabled={confirm.isPending || ((docType === 'repair' || docType === 'maintenance') && !assetId)} onClick={() => confirm.mutate(undefined, {
        onSuccess: () => { toast.success('Saved from document'); onClose() }, onError: (e) => toast.error(errorMessage(e)),
      })}>{confirm.isPending ? 'Saving…' : 'Confirm & save'}</Button>
    </> : <><Button variant="outline" onClick={onClose}>Close</Button><Button disabled={running} onClick={start}>{running ? 'Reading document…' : 'Extract'}</Button></>}>
      <div className="space-y-4">
        <Field label="Document type">
          <Select value={docType} onChange={(e) => { setDocType(e.target.value); setRun(null) }}>{types.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}</Select>
        </Field>
        {run?.status === 'failed' && <p className="rounded bg-red-50 p-2 text-sm text-red-700">{run.error}</p>}
        {reviewing && !type?.row_based && (
          <>
            <p className="text-xs text-gray-500">Check every value against the document. Low-confidence fields are highlighted. {run.result?.notes}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {type?.fields.map((f) => (
                <Field key={f.key} label={`${f.label}${f.save ? '' : ' (info)'}`} hint={f.hint ?? undefined}>
                  {f.kind === 'enum'
                    ? <Select value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}><option value="">—</option>{f.enum.map((o) => <option key={o}>{o}</option>)}</Select>
                    : <Input type={f.kind === 'date' ? 'date' : 'text'} className={(conf[f.key] ?? 1) < 0.6 ? 'border-amber-400 bg-amber-50' : ''} value={values[f.key] ?? ''} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
                </Field>
              ))}
            </div>
          </>
        )}
        {reviewing && type?.row_based && (
          <div className="max-h-72 overflow-auto rounded border">
            <table className="w-full text-xs"><thead className="sticky top-0 bg-gray-50"><tr>{['logType', 'serialNumber', 'date', 'itemName', 'borrowerName', 'issue', 'cost'].map((k) => <th key={k} className="px-2 py-1 text-left">{k}</th>)}<th /></tr></thead>
              <tbody>{rows.map((r, i) => <tr key={i} className="border-t">{['logType', 'serialNumber', 'date', 'itemName', 'borrowerName', 'issue', 'cost'].map((k) => (
                <td key={k} className="px-1 py-0.5"><input className="w-full rounded border-transparent px-1 hover:border-gray-200" value={r[k] ?? ''} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, [k]: e.target.value } : x))} /></td>
              ))}<td><button className="px-1 text-gray-400 hover:text-red-600" aria-label="Remove row" onClick={() => setRows(rows.filter((_, j) => j !== i))}>×</button></td></tr>)}</tbody>
            </table>
          </div>
        )}
        {reviewing && (docType === 'invoice' || docType === 'warranty' || docType === 'repair' || docType === 'maintenance') && (
          <div className="grid grid-cols-1 gap-3 rounded-lg border bg-gray-50 p-3 sm:grid-cols-2">
            <Field label={docType === 'invoice' || docType === 'warranty' ? 'Update existing asset (optional)' : 'Asset'} required={docType === 'repair' || docType === 'maintenance'}>
              <Combobox value={assetId ? String(assetId) : null} onChange={(v) => setAssetId(v ? Number(v) : null)}
                options={(assets?.items ?? []).map((a) => ({ value: String(a.id), label: a.display_name }))} placeholder="Search assets…" />
            </Field>
            {(docType === 'invoice' || docType === 'warranty') && !assetId && (
              <Field label="…or create a new asset of type"><Select value={newType} onChange={(e) => setNewType(e.target.value)}>{(ref?.asset_type ?? []).map((t) => <option key={t.id}>{t.name}</option>)}</Select></Field>
            )}
          </div>
        )}
        {reviewing && docType === 'contract' && (
          <Field label="Update existing employee (leave empty to create one)"><EmployeePicker includeInactive value={employeeId} onChange={setEmployeeId} /></Field>
        )}
        {!reviewing && run?.status !== 'failed' && <p className="text-sm text-gray-500">The configured AI model reads this document and suggests values. You review and correct them before anything is saved.</p>}
      </div>
    </Modal>
  )
}
