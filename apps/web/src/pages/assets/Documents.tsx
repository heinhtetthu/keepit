import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { FileText, Search, Sparkles, Upload } from 'lucide-react'
import { DOCUMENT_CATEGORIES, errorMessage, formatBytes, formatDate, daysUntil, useApi, useAssetMutation, useDocuments, type Document } from '@workspace/core'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import RowMenu from '@/components/ui/menu'
import Modal from '@/components/ui/modal'
import { toast } from '@/components/ui/toaster'
import { MiniPager, TableCard, TableFooterInfo, TableScrollArea, TH_STICKY } from '@/components/table_shell'
import { EmptyState, Field, useCan, useConfirm } from '@/components/assets/shared'
import { DownloadButton, PreviewDialog, UploadDialog } from '@/components/documents/DocumentDialogs'
import ExtractionDialog from '@/components/documents/ExtractionDialog'

const th = `${TH_STICKY} px-3 py-2 text-left text-xs font-medium text-gray-500`
const LINK_PATH: Record<string, (id: number) => string> = { asset: (id) => `/assets/${id}`, employee: (id) => `/employees/${id}`, borrow: () => '/it-logs' }

export default function Documents() {
  const can = useCan()
  const api = useApi()
  const [sp, setSp] = useSearchParams()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [page, setPage] = useState(1)
  const { data, isLoading } = useDocuments({ q: search || undefined, category: category || undefined, page, page_size: 50 })
  const [upload, setUpload] = useState(false)
  const [preview, setPreview] = useState<Document | null>(null)
  const [extract, setExtract] = useState<Document | null>(null)
  const [edit, setEdit] = useState<Document | null>(null)
  const del = useAssetMutation((a, id: number) => a.documents.remove(id))
  const { confirm, dialog } = useConfirm()
  const items = data?.items ?? []

  useEffect(() => {  // deep link from ⌘K: /documents?open=ID
    const open = Number(sp.get('open'))
    if (open) api.documents.get(open).then(setPreview).catch(() => undefined).finally(() => setSp({}, { replace: true }))
  }, [api, sp, setSp])

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div><h1 className="text-2xl font-semibold tracking-tight text-gray-900">Documents</h1><p className="text-sm text-gray-500">Invoices, warranties, contracts and licenses linked to assets, people and renewals.</p></div>
        {can('document.upload') && <Button className="ml-auto" size="sm" onClick={() => setUpload(true)}><Upload className="mr-1.5 h-4 w-4" />Upload</Button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); setSearch(q.trim()); setPage(1) }}>
          <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input className="pl-8" placeholder="Title, file, reference, tag…" value={q} onChange={(e) => setQ(e.target.value)} onBlur={() => { setSearch(q.trim()); setPage(1) }} />
        </form>
        <Select className="w-auto" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1) }} aria-label="Category">
          <option value="">All categories</option>{DOCUMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}
        </Select>
      </div>
      <TableCard footer={<div className="flex items-center"><TableFooterInfo shown={items.length} total={data?.total ?? 0} noun="documents" /><div className="ml-auto"><MiniPager page={page} pages={data?.total_pages ?? 1} onPage={setPage} /></div></div>}>
        <TableScrollArea>
          {isLoading ? <p className="p-6 text-center text-sm text-gray-400">Loading…</p> : !items.length ? <EmptyState icon={<FileText className="h-10 w-10" />} title="No documents" /> : (
            <table className="w-full text-sm"><thead><tr><th className={th}>Title</th><th className={th}>Category</th><th className={th}>Expires</th><th className={th}>Size</th><th className={th}>Uploaded</th><th className={th} /></tr></thead>
              <tbody className="divide-y">{items.map((d) => {
                const left = daysUntil(d.expiry_date)
                return (
                  <tr key={d.id} className="hover:bg-gray-50">
                    <td className="px-3 py-2"><button className="text-left font-medium text-gray-900 hover:underline" onClick={() => setPreview(d)}>{d.title}</button>
                      <div className="text-xs text-gray-500">{d.file_name}{d.reference_number && ` · #${d.reference_number}`}{d.tags.length > 0 && ` · ${d.tags.join(', ')}`}</div></td>
                    <td className="px-3 py-2"><Badge variant="outline">{d.category}</Badge></td>
                    <td className={`px-3 py-2 ${left !== null && left >= 0 && left <= 30 ? 'font-medium text-amber-700' : 'text-gray-600'}`}>{formatDate(d.expiry_date)}</td>
                    <td className="px-3 py-2 text-gray-600">{formatBytes(d.size_bytes)}</td>
                    <td className="px-3 py-2 text-gray-600">{formatDate(d.created_at)}</td>
                    <td className="px-3 py-2 text-right"><div className="flex justify-end gap-1">
                      <DownloadButton doc={d} variant="ghost" />
                      <RowMenu items={[
                        { label: 'Preview', onSelect: () => setPreview(d) },
                        { label: 'Extract with AI', icon: <Sparkles className="h-4 w-4" />, onSelect: () => setExtract(d), hidden: !can('extraction.run') },
                        { label: 'Edit details & links', onSelect: () => setEdit(d), hidden: !can('document.edit') },
                        { label: 'Delete', danger: true, divider: true, hidden: !can('document.delete'), onSelect: () => confirm('Delete document', `Delete “${d.title}”?`, () => del.mutateAsync(d.id), 'Delete') },
                      ]} />
                    </div></td>
                  </tr>
                )
              })}</tbody></table>
          )}
        </TableScrollArea>
      </TableCard>
      {upload && <UploadDialog onClose={() => setUpload(false)} onUploaded={(d) => can('extraction.run') && ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv'].includes(d.mime_type) && setExtract(d)} />}
      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
      {extract && <ExtractionDialog doc={extract} onClose={() => setExtract(null)} />}
      {edit && <EditDialog doc={edit} onClose={() => setEdit(null)} />}
      {dialog}
    </div>
  )
}

function EditDialog({ doc, onClose }: { doc: Document; onClose: () => void }) {
  const [f, setF] = useState({ title: doc.title, category: doc.category, reference_number: doc.reference_number ?? '', expiry_date: doc.expiry_date ?? '', tags: doc.tags.join(', ') })
  const [links, setLinks] = useState(doc.links)
  const save = useAssetMutation((a, _: void) => a.documents.update(doc.id, { ...f, reference_number: f.reference_number || null, expiry_date: f.expiry_date || null, tags: f.tags.split(',').map((t) => t.trim()).filter(Boolean) }))
  const unlink = useAssetMutation((a, id: number) => a.documents.removeLink(doc.id, id))
  return (
    <Modal title="Edit document" subtitle={doc.file_name} onClose={onClose} footer={<><Button variant="outline" onClick={onClose}>Cancel</Button>
      <Button disabled={save.isPending} onClick={() => save.mutate(undefined, { onSuccess: () => { toast.success('Saved'); onClose() }, onError: (e) => toast.error(errorMessage(e)) })}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Title" className="sm:col-span-2"><Input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Category"><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{DOCUMENT_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
        <Field label="Reference no."><Input value={f.reference_number} onChange={(e) => setF({ ...f, reference_number: e.target.value })} /></Field>
        <Field label="Expiry date"><Input type="date" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
        <Field label="Tags"><Input value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></Field>
      </div>
      <p className="mt-4 text-xs font-medium text-gray-600">Linked to</p>
      {links.length ? <ul className="mt-1 divide-y rounded border text-sm">{links.map((l) => (
        <li key={l.id} className="flex items-center gap-2 px-3 py-1.5">
          <span className="text-xs uppercase text-gray-400">{l.entity_type}</span>
          {LINK_PATH[l.entity_type] ? <Link className="flex-1 hover:underline" to={LINK_PATH[l.entity_type](l.entity_id)}>{l.label ?? `#${l.entity_id}`}</Link> : <span className="flex-1">{l.label ?? `#${l.entity_id}`}</span>}
          <button className="text-xs text-red-600 hover:underline" onClick={() => unlink.mutate(l.id, { onSuccess: () => setLinks(links.filter((x) => x.id !== l.id)) })}>Unlink</button>
        </li>
      ))}</ul> : <p className="mt-1 text-sm text-gray-500">Not linked. Upload from an asset or employee page to link automatically.</p>}
    </Modal>
  )
}
