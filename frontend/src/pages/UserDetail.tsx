import { FormEvent, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { getUserDetail, updateLocalUser, blockUser, unblockUser, UserDetail } from '../api/users'
import { disconnectSession as disconnectSessionApi } from '../api/sessions'
import StatusBadge from '../components/StatusBadge'

export default function UserDetailPage() {
  const { username } = useParams<{ username: string }>()
  const navigate = useNavigate()
  const [detail, setDetail] = useState<UserDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [simUse, setSimUse] = useState<string>('')
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  async function load() {
    if (!username) return
    setLoading(true)
    try {
      const d = await getUserDetail(username)
      setDetail(d)
      setSimUse(String(d.simultaneous_use))
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Failed to load user')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [username])

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setFormError('')
    setSuccess('')

    if (newPassword && newPassword !== confirmPassword) {
      setFormError('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      await updateLocalUser(username!, {
        password: newPassword || undefined,
        simultaneous_use: parseInt(simUse),
      })
      setSuccess('Saved successfully')
      setNewPassword('')
      setConfirmPassword('')
      load()
    } catch (err: any) {
      setFormError(err.response?.data?.detail ?? 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  async function toggleBlock() {
    if (!detail || !username) return
    try {
      if (detail.blocked) {
        await unblockUser(username, 'local')
      } else {
        await blockUser(username, 'local')
      }
      load()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Block toggle failed')
    }
  }

  async function handleDisconnect(radacctid: number) {
    try {
      await disconnectSessionApi(radacctid)
      load()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Disconnect failed')
    }
  }

  if (loading) return <div className="p-8 text-center text-gray-400">Loading…</div>
  if (error) return <div className="p-8 text-center text-red-600">{error}</div>
  if (!detail) return null

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <button className="text-sm text-blue-600 hover:underline" onClick={() => navigate('/users')}>← Users</button>
        <h1 className="text-xl font-semibold text-gray-900">{username}</h1>
        <StatusBadge status={detail.blocked ? 'blocked' : 'active'} />
      </div>

      {/* Edit form */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Edit User</h2>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">New Password</label>
              <input className="input" type="password" value={newPassword}
                onChange={e => setNewPassword(e.target.value)} placeholder="Leave blank to keep current" />
            </div>
            <div>
              <label className="label">Confirm Password</label>
              <input className="input" type="password" value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)} placeholder="Confirm new password" />
            </div>
          </div>
          <div>
            <label className="label">Simultaneous-Use Limit</label>
            <select className="input w-48" value={simUse} onChange={e => setSimUse(e.target.value)}>
              <option value="1">1 device</option>
              <option value="2">2 devices</option>
              <option value="5">5 devices</option>
              <option value="10">10 devices</option>
            </select>
          </div>
          {formError && <p className="form-error">{formError}</p>}
          {success && <p className="text-sm text-green-600">{success}</p>}
          <div className="flex items-center gap-3">
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
            <button
              type="button"
              className={detail.blocked ? 'btn-secondary' : 'btn-danger'}
              onClick={toggleBlock}
            >
              {detail.blocked ? 'Unblock User' : 'Block User'}
            </button>
          </div>
        </form>
      </div>

      {/* Active sessions */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Active Sessions ({detail.active_sessions.length})</h2>
        </div>
        {detail.active_sessions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-400">No active sessions</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['NAS IP', 'SSID', 'IP', 'Started', 'Duration', ''].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.active_sessions.map(s => (
                <tr key={s.radacctid} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-900">{s.nasipaddress}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{s.calledstationid ?? '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">{s.framedipaddress ?? '—'}</td>
                  <td className="px-4 py-2 text-sm text-gray-600">
                    {s.acctstarttime ? new Date(s.acctstarttime).toLocaleString() : '—'}
                  </td>
                  <td className="px-4 py-2 text-sm text-gray-600">{Math.floor(s.duration_seconds / 60)}m</td>
                  <td className="px-4 py-2">
                    <button className="btn-danger btn-sm" onClick={() => handleDisconnect(s.radacctid)}>
                      Disconnect
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Auth history */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-700">Recent Auth History</h2>
        </div>
        {detail.auth_history.length === 0 ? (
          <p className="px-5 py-4 text-sm text-gray-400">No auth history</p>
        ) : (
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['Date', 'Reply'].map(h => (
                  <th key={h} className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {detail.auth_history.map(h => (
                <tr key={h.id} className="hover:bg-gray-50">
                  <td className="px-4 py-2 text-sm text-gray-600">
                    {new Date(h.authdate).toLocaleString()}
                  </td>
                  <td className="px-4 py-2">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded ${
                      h.reply === 'Access-Accept' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                    }`}>
                      {h.reply}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
