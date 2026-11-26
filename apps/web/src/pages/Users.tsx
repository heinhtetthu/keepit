import { useMemo, useState } from 'react'
import { useQuery, useQueryClient, useMutation } from '@tanstack/react-query'
import { Plus, Pencil, Trash2, X, KeyRound, Shield, ShieldCheck } from 'lucide-react'
import api from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { useAuthStore } from '../store/auth'
import AccessDialog from '../components/AccessDialog'
import RolesExplained from '../components/RolesExplained'
import { TableCard, TableScrollArea, RowsPerPageSelect, MiniPager, TableFooterInfo, usePageSize, TH_STICKY } from '../components/table_shell'
import { cn } from '@/lib/utils'
import type { NotificationRecipient } from '../types'

interface UserRow {
  id: number
  email: string
  username: string | null
  name: string
  is_active: boolean
  is_superuser: boolean
  last_login: string | null
  roles: { id: number; name: string; scope?: string | null }[]
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

export default function Users() {
  const queryClient = useQueryClient()
  const { hasPermission, user: me } = useAuthStore()
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePageSize('users')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<UserRow | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [formError, setFormError] = useState('')

  const canCreate = hasPermission('user.create')
  const canEdit = hasPermission('user.edit')
  const canDelete = hasPermission('user.delete')

  const { data, isLoading, error } = useQuery({
    queryKey: ['users', search, page, pageSize],
    queryFn: async () => (await api.get('/users', { params: { search, page, page_size: pageSize } })).data,
    retry: 1,
  })

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

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-gray-500">Each person has separate access to <b>assets</b> and <b>records</b>; record access is then set per record type as View or Edit.</p>
      </div>

      <TableCard
        header={
          <div className="flex flex-wrap items-center gap-2 px-3 py-2.5 border-b shrink-0">
            <div className="relative w-52 sm:w-64">
              <Input
                placeholder="Search by name or email..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setPage(1) }}
              />
            </div>
            {canCreate && <Button className="ml-auto shrink-0" size="sm" onClick={openCreate}><Plus className="h-4 w-4 mr-1" /> Add User</Button>}
          </div>
        }
        footer={
          <>
            <TableFooterInfo shown={data?.items?.length || 0} total={data?.total || 0} noun="users" />
            <div className="flex items-center gap-3 justify-end">
              <RowsPerPageSelect value={pageSize} onChange={(n) => { setPageSize(n); setPage(1) }} />
              <MiniPager page={page} pages={data?.total_pages || 1} onPage={setPage} />
            </div>
          </>
        }
      >
          {error ? (
            <div className="p-4 rounded-md bg-red-50 text-red-700 text-sm">Failed to load users.</div>
          ) : isLoading ? (
            <p className="text-gray-500 text-sm">Loading...</p>
          ) : (
            <TableScrollArea className="max-h-[calc(100vh-420px)] min-h-[200px]">
              <table className="w-full text-sm">
                <thead className="border-b text-left text-xs text-gray-500">
                  <tr>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Name</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Username</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Email</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Access</th>
                    {canManageRecipientsColumn && <th className={cn('px-3 py-2', TH_STICKY)}>Telegram accounts</th>}
                    <th className={cn('px-3 py-2', TH_STICKY)}>Status</th>
                    <th className={cn('px-3 py-2', TH_STICKY)}>Last Login</th>
                    <th className={cn('px-3 py-2 text-right', TH_STICKY)}>Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {(data?.items || []).map((u: UserRow) => (
                    <tr key={u.id} className={`hover:bg-gray-50 ${!u.is_active ? 'opacity-60' : ''}`}>
                      <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                        {u.name}
                        {u.is_superuser && <Badge variant="default" className="ml-2">superuser</Badge>}
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">
                        <span className="font-mono text-xs">{u.username || '-'}</span>
                      </td>
                      <td className="px-3 py-2.5 text-gray-600 whitespace-nowrap">{u.email}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {u.is_superuser ? <Badge variant="default">Full access</Badge> : (u.roles || []).map((r) => (
                            <Badge key={r.id} variant="secondary" className={cn(r.scope === 'assets' && 'bg-sky-50 text-sky-700', r.scope === 'records' && 'bg-violet-50 text-violet-700')}>{r.name}</Badge>
                          ))}
                          {!u.is_superuser && (!u.roles || u.roles.length === 0) && <span className="text-xs text-gray-400">No access yet</span>}
                        </div>
                      </td>
                      {canManageRecipientsColumn && (
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-1 max-w-[200px]">
                            {(recipientOwners.get(u.id) || []).map((r) => (
                              <span key={r.id} className="inline-flex items-center whitespace-nowrap rounded border bg-gray-50 px-1.5 py-0.5 text-[11px] text-gray-600" title={`Chat ID ${r.telegram_chat_id}`}>
                                {r.display_name}
                              </span>
                            ))}
                            {(recipientOwners.get(u.id) || []).length === 0 && <span className="text-xs text-gray-300">-</span>}
                          </div>
                        </td>
                      )}
                      <td className="px-3 py-2.5">
                        <button
                          disabled={!canEdit || u.id === me?.id}
                          onClick={() => toggleActive.mutate(u)}
                          title={u.id === me?.id ? "You can't deactivate yourself" : (u.is_active ? 'Click to deactivate' : 'Click to activate')}
                          className="disabled:cursor-default"
                        >
                          <Badge variant={u.is_active ? 'success' : 'destructive'}>
                            {u.is_active ? 'Active' : 'Inactive'}
                          </Badge>
                        </button>
                      </td>
                      <td className="px-3 py-2.5 text-gray-500 text-xs whitespace-nowrap">
                        {u.last_login ? new Date(u.last_login).toLocaleString() : 'Never'}
                      </td>
                      <td className="px-3 py-2.5 text-right whitespace-nowrap">
                        {canEdit && (
                          <Button variant="ghost" size="sm" title="Access to assets and records" onClick={() => setAccessFor(u)}>
                            <ShieldCheck className="h-3.5 w-3.5" /><span className="hidden xl:inline">Access</span>
                          </Button>
                        )}
                        {canEdit && (
                          <Button variant="ghost" size="sm" title="Edit user" onClick={() => openEdit(u)}>
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {canDelete && u.id !== me?.id && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-red-600 hover:text-red-700"
                            onClick={() => {
                              if (confirm(`Delete user "${u.name}"? This cannot be undone.`)) deleteMutation.mutate(u.id)
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {(!data?.items || data.items.length === 0) && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">No users found</td></tr>
                  )}
                </tbody>
              </table>
            </TableScrollArea>
          )}
      </TableCard>

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
