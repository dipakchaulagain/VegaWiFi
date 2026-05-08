import { useEffect, useState } from 'react'
import { getDashboardSummary, DashboardSummary } from '../api/dashboard'

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

interface MetricCardProps {
  label: string
  value: number | string
  color?: string
}

function MetricCard({ label, value, color = 'text-blue-600' }: MetricCardProps) {
  return (
    <div className="card p-5">
      <p className="text-sm text-gray-500">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
    </div>
  )
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardSummary | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const d = await getDashboardSummary()
      setData(d)
      setLastUpdated(new Date())
    } catch {
      // handled by axios interceptor
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [])

  if (loading) {
    return (
      <div className="grid grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card p-5 h-24 animate-pulse bg-gray-100" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        {lastUpdated && (
          <span className="text-xs text-gray-400">
            Last updated: {lastUpdated.toLocaleTimeString()}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <MetricCard label="Active Sessions" value={data?.active_sessions ?? 0} color="text-blue-600" />
        <MetricCard label="Auth Attempts (1h)" value={data?.auth_attempts_last_hour ?? 0} color="text-green-600" />
        <MetricCard label="Failed Auths (1h)" value={data?.failed_auths_last_hour ?? 0} color="text-red-600" />
        <MetricCard label="Blocked Users" value={data?.blocked_users ?? 0} color="text-orange-600" />
      </div>

      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-medium text-gray-700">Recent Active Sessions</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-100">
            <thead className="bg-gray-50">
              <tr>
                {['Username', 'NAS IP', 'SSID', 'Started', 'Duration'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {!data?.recent_sessions.length ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-gray-400">
                    No active sessions
                  </td>
                </tr>
              ) : (
                data.recent_sessions.map((s, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{s.username}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.nasipaddress}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{s.calledstationid ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {s.acctstarttime ? new Date(s.acctstarttime).toLocaleString() : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDuration(s.duration_seconds)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
