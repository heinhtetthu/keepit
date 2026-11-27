import { useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { FileText, Pencil, Trash2, Upload } from 'lucide-react'
import { DOCUMENT_CATEGORIES, errorMessage, formatBytes, formatDate, daysUntil, useApi, useAssetMutation, useDocuments, type Document } from '@workspace/core'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import RowMenu from '@/components/ui/menu'
import Modal from '@/components/ui/modal'
import { toast } from '@/components/ui/toaster'
import { Field, useCan, useConfirm } from '@/components/assets/shared'
import { DownloadButton, PreviewDialog, UploadDialog } from '@/components/documents/DocumentDialogs'
import {
  DataTable, EmptyRows, MoreMenu, TableTabs, TableToolbar, TitleCell, csv, filterField, range,
  useTableState, type Column, type SortDef,
} from '@/components/data-table'
import { cn } from '@/lib/utils'
import type { FilterState } from '@/components/FilterBar'

const LINK_PATH: Record<string, (id: number) => string> = { asset: (id) => `/assets/${id}`, employee: (id) => `/employees/${id}`, borrow: () => '/it-logs' }
const LINK_LABEL: Record<string, string> = { asset: 'Asset', employee: 'Employee', record: 'Record', borrow: 'Borrow' }

type Counts = { total: number; expiring: number; expired: number; unlinked: number }
const TABS: { id: string; label: string; count: keyof Counts; tone?: string; params: Record<string, string> }[] = [
  { id: 'all', label: 'All', count: 'total', params: {} },
  { id: 'expiring', label: 'Expiring soon', count: 'expiring', tone: 'text-amber-700', params: { expiry: 'expiring' } },
  { id: 'expired', label: 'Expired', count: 'expired', tone: 'text-red-600', params: { expiry: 'expired' } },
  { id: 'unlinked', label: 'Unlinked', count: 'unlinked', params: { linked: 'none' } },
]
const LINKED = [...Object.entries(LINK_LABEL).map(([value, label]) => ({ value, label })), { value: 'none', label: 'Not linked' }]
const EXPIRY = [{ value: 'expiring', label: 'Expiring in 30 days' }, { value: 'expired', label: 'Expired' }, { value: 'active', label: 'Valid' }, { value: 'none', label: 'No expiry' }]
const KINDS = [{ value: 'pdf', label: 'PDF' }, { value: 'image', label: 'Image' }, { value: 'text', label: 'Text / CSV' }, { value: 'office', label: 'Office' }, { value: 'other', label: 'Other' }]

function kindOf(mime: string) {
  if (mime === 'application/pdf') return 'PDF'
  if (mime.startsWith('image/')) return 'Image'
  if (mime.startsWith('text/')) return 'Text'
  if (/msword|officedocument|ms-|opendocument/.test(mime)) return 'Office'
  return 'Other'
}

/** Panel filters → document API parameters. */
function toParams(f: FilterState): Record<string, string | undefined> {
  const exp = range(f.expiry_date), up = range(f.created_at)
  return {
    category: csv(f.category), linked: csv(f.linked), expiry: csv(f.expiry), file_type: csv(f.file_type),
    expiry_from: exp.from, expiry_to: exp.to, uploaded_from: up.from, uploaded_to: up.to,
  }
}

const dash = <span className="text-gray-400">-</span>
const SORTS: SortDef[] = [
  { id: 'created_at', label: 'Uploaded', kind: 'date' }, { id: 'title', label: 'Title' }, { id: 'category', label: 'Category' },
  { id: 'expiry_date', label: 'Expiry date', kind: 'date' }, { id: 'size_bytes', label: 'Size', kind: 'number' },
  { id: 'file_name', label: 'File name' }, { id: 'updated_at', label: 'Last updated', kind: 'date' },
]

export default function Documents() {
  const can = useCan()
  const core = useApi()
  const [sp, setSp] = useSearchParams()
  const t = useTableState({ key: 'documents', defaultSort: 'created_at', defaultOrder: 'desc', defaultColumns: ['category', 'linked', 'expiry', 'size', 'created_at'] })
  const trash = !!t.extras.trash
  const tab = TABS.find((x) => x.id === t.tab) ?? TABS[0]
  const { data, isLoading, isFetching, error } = useDocuments({
    ...toParams(t.filters), ...(trash ? {} : tab.params), q: t.search || undefined, deleted: trash || undefined,
    page: t.page, page_size: t.pageSize, sort: t.sort, order: t.order,
  })
  const { data: counts } = useQuery<Counts>({ queryKey: ['documents', 'tab-counts'], queryFn: async () => (await api.get('/documents/tab-counts')).data })
  const [upload, setUpload] = useState(false)
  const [preview, setPreview] = useState<Document | null>(null)
  const [edit, setEdit] = useState<Document | null>(null)
  const del = useAssetMutation((a, id: number) => a.documents.remove(id))
  const restore = useAssetMutation((a, id: number) => a.documents.restore(id))
  const { confirm, dialog } = useConfirm()
  const items = data?.items ?? []
  const filtered = !!t.search || Object.keys(t.filters).length > 0 || tab.id !== 'all'

  useEffect(() => {  // deep link from ⌘K: /documents?open=ID
    const open = Number(sp.get('open'))
    if (open) core.documents.get(open).then(setPreview).catch(() => undefined).finally(() => setSp({}, { replace: true }))
  }, [core, sp, setSp])

  const fields = useMemo(() => [
    filterField('category', 'Category', 'select', [...DOCUMENT_CATEGORIES]),
    filterField('linked', 'Linked to', 'select', LINKED),
    filterField('expiry', 'Expiry status', 'select', EXPIRY),
    filterField('expiry_date', 'Expiry date', 'date'),
    filterField('created_at', 'Uploaded', 'date'),
    filterField('file_type', 'File type', 'select', KINDS),
  ], [])

  const columns = useMemo((): Column<Document>[] => [
    { id: 'title', label: 'Title', sort: 'title', locked: true, render: (d) => (
      <TitleCell title={d.title} sub={[d.file_name, d.reference_number && `#${d.reference_number}`].filter(Boolean).join(' · ')} />) },
    { id: 'category', label: 'Category', sort: 'category', render: (d) => <Badge variant="outline">{d.category}</Badge> },
    { id: 'linked', label: 'Linked to', render: (d) => d.links.length
      ? <span className="text-gray-700">{[...new Set(d.links.map((l) => LINK_LABEL[l.entity_type] ?? l.entity_type))].join(', ')}{d.links.length > 1 && <span className="text-gray-400"> ({d.links.length})</span>}</span>
      : <span className="text-gray-400">Not linked</span> },
    { id: 'expiry', label: 'Expires', sort: 'expiry_date', render: (d) => {
      if (!d.expiry_date) return dash
      const left = daysUntil(d.expiry_date)
      return <span className={cn('tabular-nums', left !== null && left < 0 ? 'text-red-600' : left !== null && left <= 30 ? 'font-medium text-amber-700' : 'text-gray-700')}>{formatDate(d.expiry_date)}</span>
    } },
    { id: 'size', label: 'Size', sort: 'size_bytes', align: 'right', render: (d) => formatBytes(d.size_bytes) },
    { id: 'file_type', label: 'Type', render: (d) => kindOf(d.mime_type) },
    { id: 'reference', label: 'Reference no.', render: (d) => d.reference_number || dash },
    { id: 'tags', label: 'Tags', render: (d) => d.tags.length ? d.tags.join(', ') : dash },
    { id: 'uploaded_by', label: 'Uploaded by', render: (d) => d.uploaded_by_name || dash },
    { id: 'created_at', label: 'Uploaded', sort: 'created_at', render: (d) => <span className="tabular-nums">{formatDate(d.created_at)}</span> },
  ], [])

  const rowMenu = (d: Document) => trash ? (
    <RowMenu items={[{ label: 'Restore', hidden: !can('document.delete'), onSelect: () => restore.mutate(d.id, { onSuccess: () => toast.success('Document restored'), onError: (e) => toast.error(errorMessage(e)) }) }]} />
  ) : (
    <div className="flex justify-end gap-1">
      <DownloadButton doc={d} variant="ghost" />
      <RowMenu items={[
        { label: 'Preview', onSelect: () => setPreview(d) },
        { label: 'Edit details & links', icon: <Pencil />, onSelect: () => setEdit(d), hidden: !can('document.edit') },
        { label: 'Move to trash', icon: <Trash2 />, danger: true, divider: true, hidden: !can('document.delete'), onSelect: () => confirm('Delete document', `Move “${d.title}” to trash?`, () => del.mutateAsync(d.id).then(() => toast.success('Moved to trash')), 'Delete') },
      ]} />
    </div>
  )

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border bg-white"><FileText className="h-5 w-5 text-gray-600" /></div>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold tracking-tight text-gray-900 sm:text-2xl">{trash ? 'Documents in trash' : 'Documents'}</h1>
            <p className="truncate text-sm text-gray-500">{trash ? 'Restore anything deleted by mistake.' : 'Invoices, warranties, contracts and licenses linked to assets, people and renewals.'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {trash && <Button variant="outline" size="sm" onClick={() => t.setExtra('trash', false)}>Back to documents</Button>}
          {can('document.upload') && !trash && <Button size="sm" onClick={() => setUpload(true)}><Upload className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Upload</span></Button>}
        </div>
      </div>

      {!trash && <TableTabs tabs={TABS.map((x) => ({ id: x.id, label: x.label, count: counts?.[x.count], tone: x.tone }))} value={t.tab}
        onChange={(id) => { t.setTab(id); if (id === 'expiring' || id === 'expired') t.setSort('expiry_date', id === 'expiring' ? 'asc' : 'desc') }} />}

      <TableToolbar state={t} searchPlaceholder="Title, file, reference, tag…" filterFields={fields} sorts={SORTS} columns={columns}
        more={can('document.delete') ? <MoreMenu toggles={[{ id: 'trash', label: 'Show trash', value: trash, onChange: (v) => t.setExtra('trash', v) }]} /> : undefined} />

      <DataTable rows={items} rowKey={(d) => d.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
        loading={isLoading && !data} fetching={isFetching} error={error ? errorMessage(error) : null}
        onRowClick={trash ? undefined : (d) => setPreview(d)} actions={rowMenu}
        empty={<EmptyRows icon={<FileText className="h-9 w-9" />} title={trash ? 'Trash is empty' : 'No documents match'}
          hint={!trash && !filtered && can('document.upload') ? 'Upload an invoice, warranty or contract.' : !trash ? 'Try another tab or clear the filters.' : undefined} />}
        pager={{ page: t.page, pages: data?.total_pages ?? 1, total: data?.total ?? 0, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'documents' }} />

      {upload && <UploadDialog onClose={() => setUpload(false)} />}
      {preview && <PreviewDialog doc={preview} onClose={() => setPreview(null)} />}
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
