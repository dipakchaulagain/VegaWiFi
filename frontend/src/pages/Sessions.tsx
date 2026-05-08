import { useEffect, useState } from 'react'
import { getActiveSessions, disconnectSession, ActiveSession } from '../api/sessions'
import ConfirmDialog from '../components/ConfirmDialog'
import StatusBadge from '../components/StatusBadge'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export default function Sessions() {
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [loading, setLoading] = useState(true)
  const [confirm, setConfirm] = useState<ActiveSession | null>(null)
  const [disconnecting, setDisconnecting] = useState<number | null>(null)
  const [error, setError] = useState('')

  async function load() {
    try {
      setSessions(await getActiveSessions())
    } catch {
      setError('Failed to load sessions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function handleDisconnect() {
    if (!confirm) return
    setDisconnecting(confirm.radacctid)
    try {
      await disconnectSession(confirm.radacctid)
      await load()
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Disconnect failed')
    } finally {
      setDisconnecting(null)
      setConfirm(null)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Active Sessions</h1>
        <button className="btn-secondary btn-sm" onClick={load}>Refresh</button>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">{error}</div>}

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  {['Username', 'MAC Address', 'NAS IP', 'SSID', 'IP Address', 'Started', 'Duration', ''].map((h) => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-8 text-center text-sm text-gray-400">No active sessions</td>
                  </tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.radacctid} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.username}</td>
                      <td className="px-4 py-3 text-sm text-gray-600 font-mono text-xs">{s.callingstationid ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.nasipaddress}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.calledstationid ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{s.framedipaddress ?? '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">
                        {s.acctstarttime ? new Date(s.acctstarttime).toLocaleString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-600">{formatDuration(s.duration_seconds)}</td>
                      <td className="px-4 py-3">
                        <button
                          className="btn-danger btn-sm"
                          onClick={() => setConfirm(s)}
                          disabled={disconnecting === s.radacctid}
                        >
                          {disconnecting === s.radacctid ? '…' : 'Disconnect'}
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {confirm && (
        <ConfirmDialog
          title="Disconnect session?"
          message={`This will send a CoA Disconnect-Request to the AC for user "${confirm.username}". The client will be immediately deauthenticated.`}
          confirmLabel="Disconnect"
          danger
          onConfirm={handleDisconnect}
          onCancel={() => setConfirm(null)}
        />
      )}
    </div>
  )
}
