import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Upload, CheckCircle2, AlertTriangle, XCircle, Download, FileSpreadsheet, Check, ChevronRight, CircleDot, ArrowLeft, X } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toaster'
import { cn } from '@/lib/utils'
import type { RecordType } from '../types'
import { Select } from '@/components/ui/select'

interface PreviewRow {
  row: number
  name: string
  status: 'ok' | 'warning' | 'error'
  errors: string[]
  warnings: string[]
  values: { [slug: string]: any }
}

interface PreviewResult {
  headers: string[]
  field_list: { slug: string; name: string; field_type: string; required: boolean; options: string[] }[]
  mapping: { [header: string]: string }
  unmapped_headers: string[]
  total_rows: number
  preview_rows: PreviewRow[]
  summary: { ok: number; warnings: number; errors: number }
}

interface Props {
  recordType: RecordType
  onClose: () => void
}

type Step = 1 | 2 | 3

const STEPS = [
  { n: 1, label: 'Upload file' },
  { n: 2, label: 'Map & review' },
  { n: 3, label: 'Import' },
]

export default function ImportWizard({ recordType, onClose }: Props) {
  const queryClient = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [step, setStep] = useState<Step>(1)
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [mapping, setMapping] = useState<{ [header: string]: string }>({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [conflicts, setConflicts] = useState<'skip' | 'rename'>('skip')
  const [done, setDone] = useState<{ created: number; skipped: number; total_in_file: number } | null>(null)

  const importable = preview ? preview.summary.ok + preview.summary.warnings : 0

  const runPreview = async (f: File, currentMapping?: { [header: string]: string }) => {
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', f)
      const m = currentMapping ?? {}
      if (Object.keys(m).length) fd.append('mapping', JSON.stringify(m))
      const res = await api.post(`/record-types/${recordType.id}/import/preview`, fd)
      setPreview(res.data)
      setMapping(res.data.mapping)
    } catch (err: any) {
      setError(err.response?.data?.error?.message || err.response?.data?.detail || 'Could not read that file. Make sure it is a valid .xlsx or .csv with headers in the first row.')
      setPreview(null)
      setStep(1) // stay on the upload step so the user can pick a different file
    } finally {
      setBusy(false)
    }
  }

  const pickFile = (f: File | null) => {
    if (!f) return
    setFile(f)
    setPreview(null)
    setDone(null)
    setMapping({})
    setStep(2)
    runPreview(f)
  }

  const changeMapping = (header: string, target: string) => {
    let next: { [header: string]: string }
    if (target === '__auto__') {
      next = {}
      for (const [h, t] of Object.entries(mapping)) if (h !== header) next[h] = t
    } else {
      next = { ...mapping, [header]: target }
    }
    setMapping(next)
    if (file) runPreview(file, next)
  }

  const commit = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (Object.keys(mapping).length) fd.append('mapping', JSON.stringify(mapping))
      fd.append('on_name_conflict', conflicts)
      const res = await api.post(`/record-types/${recordType.id}/import/commit`, fd)
      setDone(res.data)
      setStep(3)
      toast.success(`Imported ${res.data.created} record${res.data.created === 1 ? '' : 's'} into ${recordType.name}`)
      queryClient.invalidateQueries({ queryKey: ['records'] })
      queryClient.invalidateQueries({ queryKey: ['dashboard'] })
    } catch (err: any) {
      const msg = err.response?.data?.error?.message || 'Import failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const targetValue = (header: string) => mapping[header] ?? '__auto__'

  return createPortal(
    <div className="fixed inset-0 z-[90] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" onClick={() => !busy && onClose()}>
      <div
        className="w-full sm:max-w-3xl max-h-[94vh] sm:max-h-[90vh] rounded-t-xl sm:rounded-xl border bg-white shadow-xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header + stepper */}
        <div className="border-b px-4 sm:px-6 pt-4 sm:pt-5 pb-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Import records</h2>
              <p className="text-sm text-gray-500">into {recordType.name}</p>
            </div>
            <Button variant="ghost" size="icon" onClick={() => !busy && onClose()} aria-label="Close">
              <X className="h-5 w-5" />
            </Button>
          </div>
          <ol className="mt-4 flex items-center gap-1 text-xs">
            {STEPS.map((s, i) => {
              const state = done ? 3 : step
              const active = s.n === state
              const complete = s.n < state
              return (
                <li key={s.n} className="flex items-center flex-1 last:flex-none">
                  <span
                    className={cn(
                      'flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium',
                      active ? 'bg-primary text-primary-foreground' : complete ? 'text-green-700' : 'text-gray-400',
                    )}
                  >
                    {complete ? <Check className="h-3 w-3" /> : <CircleDot className="h-3 w-3" />}
                    <span className="hidden sm:inline">{s.label}</span>
                    <span className="sm:hidden">{s.n}</span>
                  </span>
                  {i < STEPS.length - 1 && <span className={cn('h-px flex-1', complete ? 'bg-green-300' : 'bg-gray-200')} />}
                </li>
              )
            })}
          </ol>
        </div>

        {/* Body */}
        <div className="overflow-y-auto p-4 sm:p-6 space-y-4">
          {error && (
            <div className="flex items-start gap-2 rounded-md bg-red-50 border border-red-100 p-3 text-red-700 text-sm">
              <XCircle className="h-4 w-4 mt-0.5 shrink-0" />
              {error}
            </div>
          )}

          {step === 1 && (
            <div
              className="rounded-xl border-2 border-dashed border-gray-300 bg-gray-50/60 p-8 text-center transition-colors hover:border-primary/50 hover:bg-gray-50 cursor-pointer"
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0] || null) }}
            >
              <FileSpreadsheet className="mx-auto h-10 w-10 text-gray-400" />
              <p className="mt-3 font-medium">Drop a spreadsheet here, or click to browse</p>
              <p className="mt-1 text-sm text-gray-500">.xlsx or .csv - first row must contain column headers</p>
              <div className="mt-4 flex justify-center">
                <a
                  className="inline-flex items-center text-sm text-primary hover:underline"
                  href={`${api.defaults.baseURL}/record-types/${recordType.id}/import/template`}
                  download
                  onClick={(e) => e.stopPropagation()}
                >
                  <Download className="h-4 w-4 mr-1" /> Download a template with example formats
                </a>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xlsm,.csv,.txt,.xls"
                className="hidden"
                onChange={(e) => { pickFile(e.target.files?.[0] || null); e.target.value = '' }}
              />
            </div>
          )}

          {step === 2 && preview && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <button
                  className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
                  onClick={() => { setStep(1); setPreview(null) }}
                >
                  <ArrowLeft className="h-3.5 w-3.5" /> Change file
                </button>
                <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium">
                  {preview.total_rows} rows
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-green-50 border border-green-200 px-2.5 py-1 text-xs font-medium text-green-700">
                  <CheckCircle2 className="h-3 w-3" /> {preview.summary.ok} ready
                </span>
                {preview.summary.warnings > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-orange-50 border border-orange-200 px-2.5 py-1 text-xs font-medium text-orange-700">
                    <AlertTriangle className="h-3 w-3" /> {preview.summary.warnings} warnings
                  </span>
                )}
                {preview.summary.errors > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-50 border border-red-200 px-2.5 py-1 text-xs font-medium text-red-700">
                    <XCircle className="h-3 w-3" /> {preview.summary.errors} errors
                  </span>
                )}
              </div>

              {preview.summary.errors > 0 && (
                <div className="rounded-md border border-red-100 bg-red-50/60 p-3 text-xs text-red-700 space-y-0.5 max-h-24 overflow-y-auto">
                  {preview.preview_rows.flatMap((row) =>
                    row.errors.map((err, ei) => (
                      <p key={`${row.row}-${ei}`}>Row {row.row}: {err}</p>
                    )),
                  )}
                </div>
              )}
              {preview.summary.warnings > 0 && preview.summary.errors === 0 && (
                <div className="rounded-md border border-orange-100 bg-orange-50/60 p-3 text-xs text-orange-700 max-h-20 overflow-y-auto">
                  {preview.preview_rows.flatMap((row) =>
                    row.warnings.map((w, wi) => <p key={`${row.row}-${wi}`}>Row {row.row}: {w}</p>),
                  )}
                </div>
              )}

              {/* Mapping */}
              <div className="rounded-lg border overflow-hidden">
                <div className="bg-gray-50 border-b px-3 py-2 text-xs font-medium text-gray-600 flex items-center justify-between">
                  <span>Column mapping</span>
                  <span className="text-gray-400 font-normal">change any column you don't want mapped</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-y-1 gap-x-4 p-2.5">
                  {preview.headers.map((h, i) => (
                    <div key={i} className="flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-gray-50">
                      <span className="font-medium text-gray-700 min-w-0 flex-1 truncate" title={h}>
                        {h || `Column ${i + 1}`}
                      </span>
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 text-gray-300" />
                      <Select
                        className={cn(
                          'h-8 max-w-[170px] rounded-md border px-1.5 text-xs bg-white',
                          targetValue(h) === '__auto__' && 'text-gray-400',
                          targetValue(h) !== '__auto__' && targetValue(h) !== '__ignore__' && 'border-primary/40 bg-primary/5 text-primary',
                        )}
                        value={targetValue(h)}
                        onChange={(e) => changeMapping(h, e.target.value)}
                      >
                        <option value="__auto__">Auto (unmapped)</option>
                        <option value="__name__">Record name</option>
                        {preview.field_list.map((f) => (
                          <option key={f.slug} value={f.slug}>
                            {f.name}{f.required ? ' ★' : ''} ({f.field_type})
                          </option>
                        ))}
                        <option value="__ignore__">Ignore</option>
                      </Select>
                    </div>
                  ))}
                </div>
              </div>

              {/* Row preview */}
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-sm min-w-[480px]">
                  <thead className="bg-gray-50 border-b text-xs text-gray-500">
                    <tr>
                      <th className="px-2.5 py-2 text-left w-10">#</th>
                      <th className="px-2.5 py-2 text-left w-10"></th>
                      <th className="px-2.5 py-2 text-left">Name</th>
                      {preview.field_list.filter((f) => mapping && Object.values(mapping).includes(f.slug)).slice(0, 4).map((f) => (
                        <th key={f.slug} className="px-2.5 py-2 text-left">{f.name}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.preview_rows.slice(0, 30).map((row) => (
                      <tr key={row.row} className={cn('hover:bg-gray-50', row.status === 'error' && 'opacity-70 bg-red-50/40')}>
                        <td className="px-2.5 py-1.5 text-gray-400 text-xs">{row.row}</td>
                        <td className="px-2.5 py-1.5">
                          {row.status === 'ok' && <CheckCircle2 className="h-4 w-4 text-green-600" />}
                          {row.status === 'warning' && <AlertTriangle className="h-4 w-4 text-orange-500" />}
                          {row.status === 'error' && <XCircle className="h-4 w-4 text-red-600" />}
                        </td>
                        <td className="px-2.5 py-1.5 font-medium max-w-[200px] truncate">{row.name || '- '}</td>
                        {preview.field_list.filter((f) => mapping && Object.values(mapping).includes(f.slug)).slice(0, 4).map((f) => (
                          <td key={f.slug} className="px-2.5 py-1.5 text-gray-600 max-w-[160px] truncate" title={String(row.values[f.slug] ?? '')}>
                            {row.values[f.slug] !== undefined && row.values[f.slug] !== null
                              ? String(Array.isArray(row.values[f.slug]) ? row.values[f.slug].join('; ') : row.values[f.slug])
                              : '- '}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {preview.total_rows > 30 && (
                <p className="text-xs text-gray-400">Showing first 30 of {preview.total_rows} rows.</p>
              )}
            </>
          )}

          {step === 3 && done && (
            <div className="space-y-4 py-4 text-center">
              <CheckCircle2 className="h-14 w-14 text-green-600 mx-auto" />
              <div className="space-y-1">
                <p className="text-xl font-semibold">{done.created} record{done.created === 1 ? '' : 's'} imported</p>
                <p className="text-sm text-gray-500">
                  {done.created} created · {done.skipped} skipped (invalid rows and duplicates) of {done.total_in_file} rows
                </p>
              </div>
              <div className="flex justify-center gap-2 pt-2">
                <Button
                  variant="outline"
                  onClick={() => { setDone(null); setFile(null); setPreview(null); setMapping({}); setStep(1) }}
                >
                  Import another file
                </Button>
                <Button onClick={onClose}>Done</Button>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {step === 2 && preview && (
          <div className="border-t bg-gray-50/70 px-4 sm:px-6 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-b-xl">
            <div className="flex items-center gap-2 text-sm">
              <span className="text-gray-500 text-xs">If a record name already exists:</span>
              <Select className="h-8 rounded-md border border-input px-2 text-xs bg-white" value={conflicts} onChange={(e) => setConflicts(e.target.value as 'skip' | 'rename')}>
                <option value="skip">Skip that row</option>
                <option value="rename">Import with a new name</option>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={commit} disabled={busy || importable === 0}>
                <Upload className="h-4 w-4 mr-1" />
                {busy ? 'Importing…' : `Import ${importable} row${importable === 1 ? '' : 's'}`}
              </Button>
            </div>
          </div>
        )}
        {step === 1 && (
          <div className="border-t bg-gray-50/70 px-4 sm:px-6 py-3 flex justify-between rounded-b-xl">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> Browse files
            </Button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}
