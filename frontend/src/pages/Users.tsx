import { FormEvent, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  getLocalUsers, createLocalUser, deleteLocalUser,
  blockUser, unblockUser,
  getLdapUsers, LocalUser, LdapUser,
} from '../api/users'
import StatusBadge from '../components/StatusBadge'
import BlockToggle from '../components/BlockToggle'
import ConfirmDialog from '../components/ConfirmDialog'

function LocalTab() {
  const [users, setUsers] = useState<LocalUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [form, setForm] = useState({ username: '', password: '', simultaneous_use: '' })
  const [formError, setFormError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    try { setUsers(await getLocalUsers()) }
    catch { setError('Failed to load users') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  async function handleAdd(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    try {
      await createLocalUser({
        username: form.username,
        password: form.password,
        simultaneous_use: form.simultaneous_use ? parseInt(form.simultaneous_use) : undefined,
      })
      setShowAdd(false)
      setForm({ username: '', password: '', simultaneous_use: '' })
      load()
    } catch (err: any) {
      setFormError(err.response?.data?.detail ?? 'Failed to create user')
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return
    try {
      await deleteLocalUser(deleteTarget)
      load()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Delete failed')
    } finally {
      setDeleteTarget(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary btn-sm" onClick={() => setShowAdd(true)}>+ Add User</button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      {showAdd && (
        <div className="card p-4">
          <h3 className="text-sm font-medium text-gray-700 mb-3">New Local User</h3>
          <form onSubmit={handleAdd} className="grid grid-cols-2 sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="label">Username</label>
              <input className="input" required value={form.username}
                onChange={e => setForm({ ...form, username: e.target.value })} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="input" type="password" required value={form.password}
                onChange={e => setForm({ ...form, password: e.target.value })} />
            </div>
            <div>
              <label className="label">Simultaneous-Use</label>
              <select className="input" value={form.simultaneous_use}
                onChange={e => setForm({ ...form, simultaneous_use: e.target.value })}>
                <option value="">Global default</option>
                <option value="1">1 device</option>
                <option value="2">2 devices</option>
                <option value="5">5 devices</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="submit" className="btn-primary btn-sm">Create</button>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setShowAdd(false)}>Cancel</button>
            </div>
            {formError && <p className="form-error col-span-4">{formError}</p>}
          </form>
        </div>
      )}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Username', 'Simultaneous-Use', 'Status', 'Last Seen', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {users.length === 0 ? (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-400">No local users</td></tr>
              ) : (
                users.map(u => (
                  <tr key={u.username} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{u.username}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{u.simultaneous_use}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={u.blocked ? 'blocked' : 'active'} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {u.last_seen ? new Date(u.last_seen).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Link to={`/users/local/${u.username}`} className="btn-secondary btn-sm">Edit</Link>
                        <BlockToggle
                          username={u.username}
                          blocked={u.blocked}
                          onToggle={async (shouldBlock) => {
                            await (shouldBlock ? blockUser(u.username, 'local') : unblockUser(u.username, 'local'))
                            load()
                          }}
                        />
                        <button className="btn-danger btn-sm" onClick={() => setDeleteTarget(u.username)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={`Delete user "${deleteTarget}"?`}
          message="This will permanently remove the user and all their RADIUS attributes. This cannot be undone."
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

function LdapTab() {
  const [data, setData] = useState<{ group_dn: string; members: LdapUser[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function load() {
    setLoading(true)
    setError('')
    try { setData(await getLdapUsers()) }
    catch (err: any) { setError(err.response?.data?.detail ?? 'Failed to load LDAP users') }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="space-y-4">
      {data && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded px-3 py-2">
          <span className="text-xs text-blue-700">Group: <code className="font-mono">{data.group_dn}</code></span>
          <button className="btn-secondary btn-sm" onClick={load}>Refresh</button>
        </div>
      )}

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading LDAP group members…</div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                {['Display Name', 'Username', 'Email', 'Sessions', 'Last Seen', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              {!data?.members.length ? (
                <tr><td colSpan={7} className="px-4 py-8 text-center text-sm text-gray-400">No members</td></tr>
              ) : (
                data.members.map(m => (
                  <tr key={m.username} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{m.display_name ?? m.username}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.username}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.email ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{m.current_sessions}</td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {m.last_seen ? new Date(m.last_seen).toLocaleString() : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={m.blocked ? 'blocked' : 'active'} />
                    </td>
                    <td className="px-4 py-3">
                      <BlockToggle
                        username={m.username}
                        blocked={m.blocked}
                        onToggle={async (shouldBlock) => {
                          await (shouldBlock ? blockUser(m.username, 'ldap') : unblockUser(m.username, 'ldap'))
                          load()
                        }}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

export default function Users() {
  const [tab, setTab] = useState<'local' | 'ldap'>('local')

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Users</h1>
      <div className="flex border-b border-gray-200">
        {(['local', 'ldap'] as const).map(t => (
          <button
            key={t}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
            onClick={() => setTab(t)}
          >
            {t === 'local' ? 'Local Users' : 'LDAP / Active Directory'}
          </button>
        ))}
      </div>
      {tab === 'local' ? <LocalTab /> : <LdapTab />}
    </div>
  )
}
