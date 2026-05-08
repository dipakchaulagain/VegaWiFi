import { FormEvent, Fragment, useEffect, useState } from 'react'
import {
  getPolicy, updatePolicy, PolicyResponse,
  getNasList, createNas, updateNas, deleteNas, NasEntry,
} from '../api/policy'
import ConfirmDialog from '../components/ConfirmDialog'

function NasForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: Partial<NasEntry>
  onSave: (entry: NasEntry) => Promise<void>
  onCancel: () => void
}) {
  const [form, setForm] = useState<NasEntry>({
    nasname: initial?.nasname ?? '',
    shortname: initial?.shortname ?? '',
    type: initial?.type ?? 'other',
    secret: initial?.secret ?? '',
    description: initial?.description ?? '',
  })
  const [showSecret, setShowSecret] = useState(!initial?.shortname)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-4 bg-gray-50 rounded-md">
      <div>
        <label className="label">Shortname</label>
        <input className="input" required value={form.shortname}
          onChange={e => setForm({ ...form, shortname: e.target.value })} />
      </div>
      <div>
        <label className="label">IP Address</label>
        <input className="input" required value={form.nasname}
          onChange={e => setForm({ ...form, nasname: e.target.value })} placeholder="192.168.1.1" />
      </div>
      <div>
        <label className="label">Shared Secret {!showSecret && <button type="button" className="text-blue-600 text-xs ml-1" onClick={() => setShowSecret(true)}>Change</button>}</label>
        {showSecret ? (
          <input className="input" required={!initial?.shortname} value={form.secret}
            onChange={e => setForm({ ...form, secret: e.target.value })} type="password" />
        ) : (
          <input className="input" disabled value="••••••••" />
        )}
      </div>
      <div className="col-span-2 sm:col-span-3">
        <label className="label">Description</label>
        <input className="input" value={form.description ?? ''}
          onChange={e => setForm({ ...form, description: e.target.value })} />
      </div>
      {error && <p className="form-error col-span-3">{error}</p>}
      <div className="flex gap-2 col-span-3">
        <button type="submit" className="btn-primary btn-sm" disabled={saving}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" className="btn-secondary btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}

export default function Policy() {
  const [policy, setPolicy] = useState<PolicyResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')

  const [authMode, setAuthMode] = useState('db')
  const [simUse, setSimUse] = useState('2')
  const [ldapGroupDn, setLdapGroupDn] = useState('')
  const [ldapBindPw, setLdapBindPw] = useState('')

  const [showAddNas, setShowAddNas] = useState(false)
  const [editNas, setEditNas] = useState<any | null>(null)
  const [deleteNasId, setDeleteNasId] = useState<number | null>(null)
  const [nasList, setNasList] = useState<any[]>([])

  async function load() {
    setLoading(true)
    try {
      const p = await getPolicy()
      setPolicy(p)
      setAuthMode(p.auth_mode)
      setSimUse(String(p.default_simultaneous_use))
      setLdapGroupDn(p.ldap_group_dn ?? '')
      setNasList(p.nas_list)
    } catch {
      setError('Failed to load policy')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleSavePolicy(e: FormEvent) {
    e.preventDefault()
    setSaving(true)
    setError('')
    setSuccess('')
    try {
      await updatePolicy({
        auth_mode: authMode,
        default_simultaneous_use: parseInt(simUse),
        ldap_group_dn: ldapGroupDn || undefined,
        ldap_bind_pw: ldapBindPw || undefined,
      })
      setSuccess('Policy saved and FreeRADIUS reloaded')
      setLdapBindPw('')
      load()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function handleDeleteNas() {
    if (deleteNasId == null) return
    try {
      await deleteNas(deleteNasId)
      load()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Delete NAS failed')
    } finally {
      setDeleteNasId(null)
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Loading…</div>

  return (
    <div className="space-y-8 max-w-3xl">
      <h1 className="text-xl font-semibold text-gray-900">Policy</h1>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}
      {success && <div className="text-sm text-green-600 bg-green-50 border border-green-200 rounded px-3 py-2">{success}</div>}

      {/* Global policy */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Global Policy</h2>
        <form onSubmit={handleSavePolicy} className="space-y-4">
          <div>
            <label className="label">Authentication Mode</label>
            <select className="input w-64" value={authMode} onChange={e => setAuthMode(e.target.value)}>
              <option value="db">Local DB only</option>
              <option value="ldap">LDAP / Active Directory only</option>
              <option value="hybrid">Hybrid (DB + LDAP fallback)</option>
            </select>
          </div>
          <div>
            <label className="label">Default Simultaneous-Use</label>
            <select className="input w-48" value={simUse} onChange={e => setSimUse(e.target.value)}>
              <option value="1">1 device</option>
              <option value="2">2 devices</option>
              <option value="5">5 devices</option>
            </select>
          </div>
          {authMode !== 'db' && (
            <>
              <div>
                <label className="label">LDAP Group DN</label>
                <input className="input" value={ldapGroupDn}
                  onChange={e => setLdapGroupDn(e.target.value)}
                  placeholder="cn=WiFi-Users,ou=Groups,dc=domain,dc=com" />
              </div>
              <div>
                <label className="label">LDAP Bind Password <span className="text-gray-400">(leave blank to keep current)</span></label>
                <input className="input w-64" type="password" value={ldapBindPw}
                  onChange={e => setLdapBindPw(e.target.value)} placeholder="••••••••" />
              </div>
            </>
          )}
          <button type="submit" className="btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save & Reload FreeRADIUS'}
          </button>
        </form>
      </div>

      {/* NAS list */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-700">NAS / AP-Controllers</h2>
          <button className="btn-primary btn-sm" onClick={() => setShowAddNas(true)}>+ Add NAS</button>
        </div>

        {showAddNas && (
          <div className="px-5 py-4 border-b border-gray-100">
            <NasForm
              onSave={async (entry) => {
                await createNas(entry)
                setShowAddNas(false)
                load()
              }}
              onCancel={() => setShowAddNas(false)}
            />
          </div>
        )}

        <table className="min-w-full divide-y divide-gray-100">
          <thead className="bg-gray-50">
            <tr>
              {['Shortname', 'IP Address', 'Description', 'Actions'].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {nasList.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-gray-400">No NAS entries</td></tr>
            ) : (
              nasList.map(n => (
                <Fragment key={n.id}>
                  <tr className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{n.shortname}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{n.nasname}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{n.description ?? '—'}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-2">
                        <button className="btn-secondary btn-sm" onClick={() => setEditNas(n)}>Edit</button>
                        <button className="btn-danger btn-sm" onClick={() => setDeleteNasId(n.id)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                  {editNas?.id === n.id && (
                    <tr>
                      <td colSpan={4} className="px-4 py-2">
                        <NasForm
                          initial={editNas}
                          onSave={async (entry) => {
                            await updateNas(n.id, entry)
                            setEditNas(null)
                            load()
                          }}
                          onCancel={() => setEditNas(null)}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>

      {deleteNasId != null && (
        <ConfirmDialog
          title="Delete NAS entry?"
          message="This will remove the NAS from clients.conf and reload FreeRADIUS."
          confirmLabel="Delete"
          danger
          onConfirm={handleDeleteNas}
          onCancel={() => setDeleteNasId(null)}
        />
      )}
    </div>
  )
}
