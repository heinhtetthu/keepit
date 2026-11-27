import { useMemo, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, KeyRound, Shield, ShieldCheck, Users as UsersIcon } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import RowMenu from '@/components/ui/menu'
import { useAuthStore } from '../store/auth'
import AccessDialog, { useAccessCatalog, type AccessCatalog } from '../components/AccessDialog'
import RolesExplained from '../components/RolesExplained'
import {
  DataTable, EmptyRows, TableTabs, TableToolbar, TitleCell, clientRows, filterField, filterRows, useTableState,
  type Column, type SortDef,
} from '@/components/data-table'
import { cn } from '@/lib/utils'
import type { NotificationRecipient } from '../types'

interface UserRow {
  id: number
  email: string
  username: string | null
  name: string
  is_active: boolean
  is_superuser: boolean
  mfa_enabled?: boolean
  last_login: string | null
  roles: { id: number; name: string; scope?: string | null; level?: number | null }[]
  created_at: string
}

interface RoleRow {
  id: number
  name: string
  description: string | null
  is_system: boolean
  scope?: string | null
  level?: number | null
  permissions: { id: number; name: string; description: string | null }[]
}

interface PermissionRow {
  id: number
  name: string
  description: string | null
}

const emptyDraft = { name: '', email: '', username: '', password: '', role_id: null as number | null, is_active: true }

/* Users are few, so the list loads whole and is searched, filtered, sorted and paged in the browser. */
async function fetchAllUsers(): Promise<UserRow[]> {
  const out: UserRow[] = []
  for (let page = 1; page <= 50; page++) {
    const data = (await api.get('/users', { params: { page, page_size: 100 } })).data
    out.push(...(data.items ?? []))
    if (page >= (data.total_pages ?? 1)) break
  }
  return out
}

type Area = 'assets' | 'records'
const NO_ACCESS = 'No access'
const NO_USERS: UserRow[] = []
const FULL_ACCESS = 'Full access'
const SCOPED = new Set(['assets', 'records', 'workspace', 'assistant'])
const pill = 'whitespace-nowrap'
const dash = <span className="text-gray-400">-</span>

/** Level title for one area, e.g. "Editor"; superusers have full access. */
function levelOf(u: UserRow, area: Area, cat?: AccessCatalog): string {
  if (u.is_superuser) return FULL_ACCESS
  const role = u.roles.find((r) => r.scope === area)
  if (!role) return NO_ACCESS
  return (role.level != null && cat?.[area].levels[role.level]?.title) || role.name
}
const extrasOf = (u: UserRow) => u.roles.filter((r) => r.scope === 'workspace' || r.scope === 'assistant').map((r) => r.name)
const customOf = (u: UserRow) => u.roles.filter((r) => !r.scope || !SCOPED.has(r.scope)).map((r) => r.name)

function LevelPill({ level, area }: { level: string; area: Area }) {
  if (level === NO_ACCESS) return <span className="whitespace-nowrap text-xs text-gray-400">{NO_ACCESS}</span>
  if (level === FULL_ACCESS) return <Badge variant="default" className={pill}>{FULL_ACCESS}</Badge>
  return <Badge variant="secondary" className={cn(pill, area === 'assets' ? 'bg-sky-50 text-sky-700' : 'bg-violet-50 text-violet-700')}>{level}</Badge>
}

type Tab = 'all' | 'active' | 'inactive' | 'superusers' | 'no_mfa'
const TABS: { id: Tab; label: string; test: (u: UserRow) => boolean; tone?: string }[] = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'Active', test: (u) => u.is_active },
  { id: 'inactive', label: 'Inactive', test: (u) => !u.is_active },
  { id: 'superusers', label: 'Superusers', test: (u) => u.is_superuser },
  { id: 'no_mfa', label: 'Without two-factor', test: (u) => u.is_active && !u.mfa_enabled, tone: 'text-amber-700' },
]

const SORTS: SortDef[] = [
  { id: 'name', label: 'Name' }, { id: 'username', label: 'Username' }, { id: 'email', label: 'Email' },
  { id: 'assets', label: 'Assets access' }, { id: 'records', label: 'Records access' }, { id: 'status', label: 'Status' },
  { id: 'last_login', label: 'Last sign-in', kind: 'date' }, { id: 'created_at', label: 'Added', kind: 'date' },
]

export default function Users() {
  const queryClient = useQueryClient()
  const { hasPermission, user: me } = useAuthStore()
  const t = useTableState({ key: 'users', defaultSort: 'name', defaultOrder: 'asc', defaultColumns: ['email', 'assets', 'records', 'extras', 'mfa', 'status', 'last_login'] })
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState('')

  const canCreate = hasPermission('user.create')
  const canEdit = hasPermission('user.edit')
  const canDelete = hasPermission('user.delete')

  const { data: users, isLoading, isFetching, error } = useQuery({ queryKey: ['users', 'all'], queryFn: fetchAllUsers, retry: 1 })
  const { data: cat } = useAccessCatalog()

  const { data: roles } = useQuery<RoleRow[]>({
    queryKey: ['roles'],
    queryFn: async () => (await api.get('/users/roles')).data,
  })

  const { data: allPermissions } = useQuery<PermissionRow[]>({
    queryKey: ['permissions'],
    queryFn: async () => (await api.get('/users/permissions')).data,
  })

  /* Telegram accounts linked to each user (admin only) */
  const canManageRecipientsColumn = !!me?.is_superuser && hasPermission('notification.view')
  const { data: telegramRecipients } = useQuery<NotificationRecipient[]>({
    queryKey: ['recipients'],
    queryFn: async () => (await api.get('/reminders/recipients?active_only=false')).data,
    enabled: canManageRecipientsColumn,
  })
  const recipientOwners = useMemo(() => {
    const map = new Map<number, NotificationRecipient[]>()
    for (const r of telegramRecipients || []) {
      if (r.user_id != null) {
        const list = map.get(r.user_id) || []
        list.push(r)
        map.set(r.user_id, list)
      }
    }
    return map
  }, [telegramRecipients])

  const [accessFor, setAccessFor] = useState<{ id: number; name: string } | null>(null)

  const [editingRole, setEditingRole] = useState<RoleRow | null>(null)
  const [showRoleForm, setShowRoleForm] = useState(false)
  const [roleDraft, setRoleDraft] = useState({ name: '', description: '', permission_ids: [] as number[] })
  const [roleError, setRoleError] = useState('')

  const saveRole = useMutation({
    mutationFn: async (payload: unknown) =>
      editingRole ? api.put(`/users/roles/${editingRole.id}`, payload) : api.post('/users/roles', payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] })
      closeRoleModal()
    },
    onError: (err: any) => setRoleError(err.response?.data?.error?.message || 'Failed to save role'),
  })

  const deleteRole = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/roles/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['roles'] }),
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to delete role'),
  })

  const openRoleCreate = () => {
    setEditingRole(null)
    setRoleDraft({ name: '', description: '', permission_ids: [] })
    setRoleError('')
    setShowRoleForm(true)
  }

  const openRoleEdit = (r: RoleRow) => {
    setEditingRole(r)
    setRoleDraft({ name: r.name, description: r.description || '', permission_ids: (r.permissions || []).map((p) => p.id) })
    setRoleError('')
    setShowRoleForm(true)
  }

  const closeRoleModal = () => {
    setShowRoleForm(false)
    setEditingRole(null)
    setRoleError('')
  }

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['users'] })

  const saveMutation = useMutation({
    mutationFn: async (payload: unknown) =>
      editing ? api.put(`/users/${editing.id}`, payload) : api.post('/users', payload),
    onSuccess: (res: any) => {
      invalidate()
      const created = !editing
      closeModal()
      if (created && me?.is_superuser && res?.data?.id) setAccessFor({ id: res.data.id, name: res.data.name })
    },
    onError: (err: any) => setFormError(err.response?.data?.error?.message || 'Failed to save user'),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => api.delete(`/users/${id}`),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to delete user'),
  })

  const toggleActive = useMutation({
    mutationFn: async (u: UserRow) => api.put(`/users/${u.id}`, { is_active: !u.is_active }),
    onSuccess: invalidate,
    onError: (err: any) => alert(err.response?.data?.error?.message || 'Failed to update user'),
  })

  const openCreate = () => {
    setEditing(null)
    setDraft(emptyDraft)
    setFormError('')
    setShowForm(true)
  }

  const openEdit = (u: UserRow) => {
    setEditing(u)
    setDraft({
      name: u.name,
      email: u.email,
      username: u.username || '',
      password: '',
      role_id: (u.roles || [])[0]?.id ?? null,
      is_active: u.is_active,
    })
    setFormError('')
    setShowForm(true)
  }

  const closeModal = () => {
    setShowForm(false)
    setEditing(null)
    setDraft(emptyDraft)
    setFormError('')
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    const payload: any = {
      name: draft.name.trim(),
      email: draft.email.trim(),
      username: draft.username.trim().toLowerCase(),
      is_active: draft.is_active,
    }
    if (draft.password) payload.password = draft.password
    if (!editing && !draft.password) {
      setFormError('Password is required for new users')
      return
    }
    saveMutation.mutate(payload)
  }


  /* ---------- list ---------- */
  const get = (u: UserRow, slug: string): unknown => {
    switch (slug) {
      case 'assets': case 'records': return levelOf(u, slug, cat)
      case 'extras': return extrasOf(u)
      case 'custom': return customOf(u)
      case 'status': return u.is_active ? 'Active' : 'Inactive'
      case 'mfa': return u.mfa_enabled ? 'On' : 'Off'
      case 'superuser': return u.is_superuser
      case 'last_login': return u.last_login
      case 'created_at': return u.created_at
      case 'name': return u.name
      case 'username': return u.username
      case 'email': return u.email
      default: return null
    }
  }
  const fields = useMemo(() => {
    const levels = (area: Area) => [FULL_ACCESS, ...(cat?.[area].levels ?? []).filter((l) => l.key !== 'none').map((l) => l.title), NO_ACCESS]
    const extra = (roles ?? []).filter((r) => r.scope === 'workspace' || r.scope === 'assistant').map((r) => r.name)
    const custom = (roles ?? []).filter((r) => !r.scope || !SCOPED.has(r.scope)).map((r) => r.name)
    return [
      filterField('assets', 'Assets access', 'select', levels('assets')),
      filterField('records', 'Records access', 'select', levels('records')),
      filterField('extras', 'Extra access', 'select', extra),
      ...(custom.length ? [filterField('custom', 'Custom role', 'select', custom)] : []),
      filterField('status', 'Status', 'select', ['Active', 'Inactive']),
      filterField('mfa', 'Two-factor sign-in', 'select', [{ value: 'On', label: 'Turned on' }, { value: 'Off', label: 'Not set up' }]),
      filterField('superuser', 'Superuser', 'boolean'),
      filterField('last_login', 'Last sign-in', 'date'),
      filterField('created_at', 'Added', 'date'),
    ]
  }, [cat, roles])

  const tab = TABS.find((x) => x.id === t.tab) ?? TABS[0]
  const all = users ?? NO_USERS
  const counts = useMemo(() => {
    const base = filterRows(all, t.filters, fields, get)
    return Object.fromEntries(TABS.map((x) => [x.id, base.filter(x.test).length])) as Record<Tab, number>
  }, [all, t.filters, fields]) // eslint-disable-line react-hooks/exhaustive-deps -- get reads cat, already behind fields
  const view = clientRows(all.filter(tab.test), t, fields, get, (u) => `${u.name} ${u.email} ${u.username ?? ''}`)

  const columns: Column<UserRow>[] = [
    { id: 'name', label: 'Name', sort: 'name', locked: true, render: (u) => <TitleCell title={u.name} sub={u.username ? `@${u.username}` : u.email} /> },
    { id: 'username', label: 'Username', sort: 'username', render: (u) => u.username ? <span className="font-mono text-xs">{u.username}</span> : dash },
    { id: 'email', label: 'Email', sort: 'email', render: (u) => u.email },
    { id: 'assets', label: 'Assets', sort: 'assets', render: (u) => <LevelPill area="assets" level={levelOf(u, 'assets', cat)} /> },
    { id: 'records', label: 'Records', sort: 'records', render: (u) => <LevelPill area="records" level={levelOf(u, 'records', cat)} /> },
    { id: 'extras', label: 'Extra access', render: (u) => extrasOf(u).length
      ? <div className="flex gap-1">{extrasOf(u).map((n) => <Badge key={n} variant="secondary" className={pill}>{n}</Badge>)}</div> : dash },
    { id: 'custom', label: 'Custom roles', render: (u) => customOf(u).length
      ? <div className="flex gap-1">{customOf(u).map((n) => <Badge key={n} variant="outline" className={pill}>{n}</Badge>)}</div> : dash },
    { id: 'superuser', label: 'Superuser', render: (u) => u.is_superuser ? <Badge variant="default" className={pill}>Superuser</Badge> : dash },
    { id: 'mfa', label: 'Two-factor', render: (u) => u.mfa_enabled
      ? <Badge variant="success" className={pill}>On</Badge> : <Badge variant="secondary" className={cn(pill, 'text-gray-500')}>Off</Badge> },
    ...(canManageRecipientsColumn ? [{ id: 'telegram', label: 'Telegram accounts', render: (u: UserRow) => (recipientOwners.get(u.id) || []).length ? (
      <div className="flex gap-1">{(recipientOwners.get(u.id) || []).map((r) => (
        <span key={r.id} className="inline-flex items-center whitespace-nowrap rounded border bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600" title={`Chat ID ${r.telegram_chat_id}`}>{r.display_name}</span>
      ))}</div>) : dash }] : []),
    { id: 'status', label: 'Status', sort: 'status', render: (u) => (
      <button disabled={!canEdit || u.id === me?.id} onClick={(e) => { e.stopPropagation(); toggleActive.mutate(u) }} className="disabled:cursor-default"
        title={u.id === me?.id ? "You can't deactivate yourself" : (u.is_active ? 'Click to deactivate' : 'Click to activate')}>
        <Badge variant={u.is_active ? 'success' : 'destructive'} className={pill}>{u.is_active ? 'Active' : 'Inactive'}</Badge>
      </button>) },
    { id: 'last_login', label: 'Last sign-in', sort: 'last_login', render: (u) => <span className="text-xs tabular-nums text-gray-500">{u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}</span> },
    { id: 'created_at', label: 'Added', sort: 'created_at', render: (u) => <span className="text-xs tabular-nums text-gray-500">{new Date(u.created_at).toLocaleDateString()}</span> },
  ]

  const rowMenu = (u: UserRow) => (
    <RowMenu items={[
      { label: 'Access', icon: <ShieldCheck />, onSelect: () => setAccessFor(u), hidden: !canEdit },
      { label: 'Edit user', icon: <Pencil />, onSelect: () => openEdit(u), hidden: !canEdit },
      { label: 'Delete user', icon: <Trash2 />, danger: true, divider: true, hidden: !canDelete || u.id === me?.id,
        onSelect: () => { if (confirm(`Delete user "${u.name}"? This cannot be undone.`)) deleteMutation.mutate(u.id) } },
    ]} />
  )

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-gray-500">Each person has separate access to <b>assets</b> and <b>records</b>; record access is then set per record type as View or Edit.</p>

        <TableTabs tabs={TABS.map((x) => ({ id: x.id, label: x.label, count: users ? counts[x.id] : null, tone: x.tone }))} value={t.tab} onChange={t.setTab} />

        <TableToolbar state={t} searchPlaceholder="Name, email or username…" filterFields={fields} sorts={SORTS} columns={columns}>
          {canCreate && <Button size="sm" className="sm:ml-auto" onClick={openCreate}><Plus className="h-3.5 w-3.5 sm:mr-1.5" /><span className="hidden sm:inline">Add user</span></Button>}
        </TableToolbar>

        <DataTable rows={view.rows} rowKey={(u) => u.id} columns={columns} visible={t.columns} sort={t.sort} order={t.order} onSort={t.toggleSort}
          loading={isLoading} fetching={isFetching && !isLoading} error={error ? 'Failed to load users.' : null}
          onRowClick={canEdit ? (u) => setAccessFor(u) : undefined} rowClassName={(u) => !u.is_active && 'opacity-60'}
          actions={canEdit || canDelete ? rowMenu : undefined}
          empty={<EmptyRows icon={<UsersIcon className="h-9 w-9" />} title="No users match" />}
          pager={{ page: t.page, pages: view.pages, total: view.total, pageSize: t.pageSize, onPage: t.setPage, onPageSize: t.setPageSize, noun: 'users' }} />
      </div>

      <RolesExplained />

      {/* Custom roles (advanced) */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2">
              <Shield className="h-4 w-4 text-gray-400" />
              Custom roles <span className="text-xs font-normal text-gray-400">advanced</span>
            </CardTitle>
            {me?.is_superuser && (
              <Button size="sm" variant="outline" onClick={openRoleCreate}>
                <Plus className="h-4 w-4 mr-1" /> New Role
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <div className="border rounded-md divide-y">
            {(roles || []).filter((r) => !r.scope).map((r) => (
              <div key={r.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">{r.name}</span>
                    {r.is_system && <Badge variant="secondary">system</Badge>}
                    <Badge variant="outline">{(r.permissions || []).length} permissions</Badge>
                  </div>
                  {r.description && <p className="text-xs text-gray-400 mt-0.5">{r.description}</p>}
                </div>
                {me?.is_superuser && (
                  <Button variant="ghost" size="sm" onClick={() => openRoleEdit(r)}>
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                )}
                {me?.is_superuser && !r.is_system && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-red-600 hover:text-red-700"
                    onClick={() => { if (confirm(`Delete role "${r.name}"? Users with this role keep their account but lose its permissions.`)) deleteRole.mutate(r.id) }}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            ))}
            {!(roles || []).some((r) => !r.scope) && (
              <p className="px-4 py-6 text-center text-sm text-gray-400">No custom roles. The access levels above cover most needs; a system administrator can add a custom role for special cases and attach it to a user.</p>
            )}
          </div>
        </CardContent>
      </Card>

      {accessFor && <AccessDialog user={accessFor} onClose={() => setAccessFor(null)} />}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeModal}>
          <Card className="w-full max-w-md max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{editing ? `Edit - ${editing.name}` : 'Add User'}</CardTitle>
                <button onClick={closeModal} className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form onSubmit={submit} className="space-y-4">
                {formError && <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">{formError}</div>}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Name</label>
                  <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Username</label>
                  <Input
                    value={draft.username}
                    onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                    placeholder="e.g. alex.k - lowercase, no spaces"
                    pattern="[a-zA-Z0-9._-]+"
                    title="Lowercase letters, numbers, dots, dashes and underscores only"
                    required
                    spellCheck={false}
                  />
                  <p className="text-xs text-gray-400">Can be used to sign in instead of the email address.</p>
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Email</label>
                  <Input type="email" value={draft.email} onChange={(e) => setDraft({ ...draft, email: e.target.value })} required />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5 text-gray-400" />
                    {editing ? 'New password (leave blank to keep current)' : 'Password'}
                  </label>
                  <Input
                    type="password"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                    placeholder={editing ? '........' : 'Min. 8 characters'}
                    required={!editing}
                    minLength={8}
                  />
                </div>
                <p className="rounded-lg bg-gray-50 p-2.5 text-xs text-gray-600">{editing ? 'Change what this person can do with the Access button in the user list.' : 'After saving you can choose their access to assets and records.'}</p>
                <label className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draft.is_active}
                    onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })}
                  />
                  Account active
                </label>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={closeModal}>Cancel</Button>
                  <Button type="submit" disabled={saveMutation.isPending}>
                    {saveMutation.isPending ? 'Saving...' : editing ? 'Save changes' : 'Create user'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Create / Edit role modal */}
      {showRoleForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={closeRoleModal}>
          <Card className="w-full max-w-lg max-h-[90vh] overflow-auto" onClick={(e) => e.stopPropagation()}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>{editingRole ? `Edit - ${editingRole.name}` : 'New Role'}</CardTitle>
                <button onClick={closeRoleModal} className="p-1 rounded hover:bg-gray-100 text-gray-400" aria-label="Close">
                  <X className="h-5 w-5" />
                </button>
              </div>
            </CardHeader>
            <CardContent>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  saveRole.mutate({
                    name: roleDraft.name.trim(),
                    description: roleDraft.description.trim() || null,
                    permission_ids: roleDraft.permission_ids,
                  })
                }}
              >
                {roleError && <div className="p-3 rounded-md bg-red-50 text-red-700 text-sm">{roleError}</div>}
                <div className="space-y-1">
                  <label className="text-sm font-medium">Role name</label>
                  <Input value={roleDraft.name} onChange={(e) => setRoleDraft({ ...roleDraft, name: e.target.value })} placeholder="e.g. Finance Manager" required />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Description</label>
                  <Input value={roleDraft.description} onChange={(e) => setRoleDraft({ ...roleDraft, description: e.target.value })} placeholder="Optional" />
                </div>
                <div className="space-y-1">
                  <label className="text-sm font-medium">Permissions</label>
                  <div className="border rounded-md p-3 max-h-56 overflow-auto space-y-1">
                    {(allPermissions || []).map((p) => (
                      <label key={p.id} className="flex items-start gap-2 text-sm cursor-pointer py-0.5">
                        <input
                          type="checkbox"
                          className="mt-0.5 h-4 w-4"
                          checked={roleDraft.permission_ids.includes(p.id)}
                          onChange={(e) => {
                            if (e.target.checked) setRoleDraft({ ...roleDraft, permission_ids: [...roleDraft.permission_ids, p.id] })
                            else setRoleDraft({ ...roleDraft, permission_ids: roleDraft.permission_ids.filter((x) => x !== p.id) })
                          }}
                        />
                        <span>
                          <span className="font-mono text-xs text-gray-700">{p.name}</span>
                          {p.description && <span className="block text-xs text-gray-400">{p.description}</span>}
                        </span>
                      </label>
                    ))}
                  </div>
                  <p className="text-xs text-gray-400">{roleDraft.permission_ids.length} of {(allPermissions || []).length} selected</p>
                </div>
                <div className="flex justify-end gap-2 pt-1">
                  <Button type="button" variant="outline" onClick={closeRoleModal}>Cancel</Button>
                  <Button type="submit" disabled={saveRole.isPending || !roleDraft.name.trim()}>
                    {saveRole.isPending ? 'Saving...' : editingRole ? 'Save changes' : 'Create role'}
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
