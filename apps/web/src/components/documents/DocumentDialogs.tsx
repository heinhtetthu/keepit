import { useEffect, useState } from 'react'
import { Download, FileText, Paperclip, Upload } from 'lucide-react'
import { DOCUMENT_CATEGORIES, errorMessage, formatBytes, formatDate, useApi, useAssetMutation, useDocuments, type Document } from '@workspace/core'
import Modal from '@/components/ui/modal'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { toast } from '@/components/ui/toaster'
import { EmptyState, Field, useCan } from '@/components/assets/shared'

export type EntityRef = { entity_type: 'asset' | 'employee' | 'record' | 'borrow'; entity_id: number }

export function UploadDialog({ link, onClose, onUploaded }: { link?: EntityRef; onClose: () => void; onUploaded?: (d: Document) => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [f, setF] = useState({ title: '', category: 'Invoice', tags: '', reference_number: '', expiry_date: '', description: '' })
  const m = useAssetMutation((a, _: void) => {
    const form = new FormData()
    form.append('file', file!)
    Object.entries(f).forEach(([k, v]) => { if (v) form.append(k, v) })
    if (link) form.append('links', JSON.stringify([link]))
    return a.documents.upload(form)
  })
  return (
    <Modal title="Upload document" onClose={onClose} footer={<>
      <Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={!file || m.isPending} onClick={() => m.mutate(undefined, {
        onSuccess: (d) => { toast.success('Document uploaded'); onUploaded?.(d); onClose() }, onError: (e) => toast.error(errorMessage(e)),
      })}><Upload className="mr-1.5 h-4 w-4" />{m.isPending ? 'Uploading…' : 'Upload'}</Button>
    </>}>
      <div className="space-y-3">
        <label className="flex cursor-pointer flex-col items-center gap-1 rounded-lg border-2 border-dashed p-5 text-center text-sm text-gray-500 hover:bg-gray-50"
          onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const x = e.dataTransfer.files[0]; if (x) { setFile(x); setF((p) => ({ ...p, title: p.title || x.name })) } }}>
          <Paperclip className="h-5 w-5" />
          {file ? <span className="font-medium text-gray-800">{file.name} · {formatBytes(file.size)}</span> : 'Drop a file or click to choose (PDF, image, text, CSV, Office · max 10 MB)'}
          <input type="file" className="sr-only" onChange={(e) => { const x = e.target.files?.[0]; if (x) { setFile(x); setF((p) => ({ ...p, title: p.title || x.name })) } }} />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Title" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
          <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{DOCUMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
          <Field label="Reference no."><Input value={f.reference_number} onChange={(e) => setF({ ...f, reference_number: e.target.value })} /></Field>
          <Field label="Expiry date" hint="Warranties, contracts, licenses: shown in alerts"><Input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
          <Field label="Tags" hint="Comma-separated"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
        </div>
      </div>
    </Modal>
  )
}

/** Inline preview (images/PDF/text) fetched with the user's session. */
export function PreviewDialog({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const api = useApi()
  const [url, setUrl] = useState<string | null>(null)
  const [text, setText] = useState<string | null>(null)
  useEffect(() => {
    let objectUrl: string | null = null
    api.documents.file(doc.id).then(async (blob) => {
      if (doc.mime_type.startsWith('text/')) setText((await blob.text()).slice(0, 200_000))
      else { objectUrl = URL.createObjectURL(blob); setUrl(objectUrl) }
    }).catch((e) => toast.error(errorMessage(e)))
    return () => { if (objectUrl) URL.revokeObjectURL(objectUrl) }
  }, [api, doc.id, doc.mime_type])
  return (
    <Modal size="lg" title={doc.title} subtitle={`${doc.category} · ${doc.file_name}`} onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Close</Button><DownloadButton doc={doc} /></>}>
      {!doc.previewable ? <p className="text-sm text-gray-500">No preview for this file type. Download it to open.</p>
        : text !== null ? <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap rounded bg-gray-50 p-3 text-xs">{text}</pre>
        : !url ? <p className="text-sm text-gray-400">Loading preview…</p>
        : doc.mime_type === 'application/pdf' ? <iframe title={doc.title} src={url} className="h-[65vh] w-full rounded border" />
        : <img src={url} alt={doc.title} className="mx-auto max-h-[65vh] rounded" />}
    </Modal>
  )
}

export function DownloadButton({ doc, variant = 'default' }: { doc: Document; variant?: 'default' | 'outline' | 'ghost' }) {
  const api = useApi()
  return (
    <Button variant={variant} size={variant === 'ghost' ? 'sm' : 'default'} onClick={async () => {
      try {
        const blob = await api.documents.file(doc.id, true)
        const a = Object.assign(window.document.createElement('a'), { href: URL.createObjectURL(blob), download: doc.file_name })
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000)
      } catch (e) { toast.error(errorMessage(e)) }
    }}><Download className="h-4 w-4" />{variant !== 'ghost' && <span className="ml-1.5">Download</span>}</Button>
  )
}

/** Documents tab on asset / employee / record pages. */
export function LinkedDocuments({ link }: { link: EntityRef }) {
  const can = useCan()
  const { data, isLoading } = useDocuments({ entity_type: link.entity_type, entity_id: link.entity_id, page_size: 100 }, can('document.view'))
  const [upload, setUpload] = useState(false)
  const [preview, setPreview] = useState<Document | null>(null)
  if (!can('document.view')) return null
  const docs = data?.items ?? []
  return (
    <div className="space-y-2">
      {can('document.upload') && <div className="flex justify-end"><Button size="sm" variant="outline" onClick={() => setUpload(true)}><Upload className="mr-1.5 h-4 w-4" />Upload</Button></div>}
      {isLoading ? <p className="text-sm text-gray-400">Loading…</p> : docs.length === 0 ? <EmptyState icon={<FileText className="h-8 w-8" />} title="No documents yet">Invoices, warranties and contracts linked here appear in this tab.</EmptyState> : (
        <ul className="divide-y rounded-lg border">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-3 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-gray-400" />
              <button className="min-w-0 flex-1 text-left" onClick={() => setPreview(d)}>
                <span className="block truncate text-sm font-medium text-gray-800 hover:underline">{d.title}</span>
                <span className="text-xs text-gray-500">{formatBytes(d.size_bytes)} · {formatDate(d.created_at)}{d.expiry_date && ` · expires ${formatDate(d.expiry_date)}`}</span>
              </button>
              <Badge variant="outline">{d.category}</Badge>
              <DownloadButton doc={d} variant="ghost" />
            </li>
          ))}
        </ul>
      )}
      {upload && <UploadDialog link={link} onClose={() => setUpload(false)} />}
      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
    </div>
  )
}
