import { FormEvent, useEffect, useRef, useState } from 'react'
import { testAuth, testLdap } from '../api/diagnostics'

function classifyLine(line: string): string {
  if (line.includes('Access-Accept')) return 'text-green-400'
  if (line.includes('Access-Reject')) return 'text-red-400'
  if (line.includes('Access-Challenge')) return 'text-yellow-400'
  return 'text-gray-300'
}

export default function Diagnostics() {
  // Test auth
  const [authUser, setAuthUser] = useState('')
  const [authPass, setAuthPass] = useState('')
  const [authResult, setAuthResult] = useState<{ success: boolean; output: string } | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState('')

  // Test LDAP
  const [ldapResult, setLdapResult] = useState<any | null>(null)
  const [ldapLoading, setLdapLoading] = useState(false)
  const [ldapError, setLdapError] = useState('')

  // Log stream
  const [logLines, setLogLines] = useState<string[]>([])
  const [logConnected, setLogConnected] = useState(false)
  const logRef = useRef<HTMLDivElement>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => {
    const es = new EventSource('/api/v1/diagnostics/log-stream', { withCredentials: true })
    esRef.current = es
    setLogConnected(true)

    es.onmessage = (e) => {
      setLogLines(prev => {
        const next = [...prev, e.data]
        return next.slice(-500) // keep last 500 lines
      })
    }

    es.onerror = () => {
      setLogConnected(false)
    }

    return () => {
      es.close()
      setLogConnected(false)
    }
  }, [])

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logLines])

  async function handleTestAuth(e: FormEvent) {
    e.preventDefault()
    setAuthError('')
    setAuthResult(null)
    setAuthLoading(true)
    try {
      setAuthResult(await testAuth(authUser, authPass))
    } catch (err: any) {
      setAuthError(err.response?.data?.detail ?? 'Test failed')
    } finally {
      setAuthLoading(false)
    }
  }

  async function handleTestLdap() {
    setLdapError('')
    setLdapResult(null)
    setLdapLoading(true)
    try {
      setLdapResult(await testLdap())
    } catch (err: any) {
      setLdapError(err.response?.data?.detail ?? 'LDAP test failed')
    } finally {
      setLdapLoading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <h1 className="text-xl font-semibold text-gray-900">Diagnostics</h1>

      {/* Test Auth */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Test Authentication</h2>
        <form onSubmit={handleTestAuth} className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="label">Username</label>
            <input className="input w-48" value={authUser} onChange={e => setAuthUser(e.target.value)} required />
          </div>
          <div>
            <label className="label">Password</label>
            <input className="input w-48" type="password" value={authPass}
              onChange={e => setAuthPass(e.target.value)} required />
          </div>
          <button type="submit" className="btn-primary" disabled={authLoading}>
            {authLoading ? 'Testing…' : 'Test'}
          </button>
        </form>

        {authError && <p className="form-error mt-2">{authError}</p>}

        {authResult && (
          <div className="mt-4">
            <div className={`text-sm font-medium mb-2 ${authResult.success ? 'text-green-600' : 'text-red-600'}`}>
              {authResult.success ? '✓ Access-Accept' : '✗ Access-Reject'}
            </div>
            <pre className="bg-gray-900 text-gray-200 text-xs rounded p-3 overflow-auto max-h-48">
              {authResult.output}
            </pre>
          </div>
        )}
      </div>

      {/* Test LDAP */}
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-gray-700 mb-4">Test LDAP Connection</h2>
        <button className="btn-primary" onClick={handleTestLdap} disabled={ldapLoading}>
          {ldapLoading ? 'Testing…' : 'Run Test'}
        </button>

        {ldapError && <p className="form-error mt-2">{ldapError}</p>}

        {ldapResult && (
          <div className="mt-4 space-y-3">
            <div className={`text-sm font-medium ${ldapResult.success ? 'text-green-600' : 'text-red-600'}`}>
              {ldapResult.success ? '✓ Connection successful' : `✗ Failed: ${ldapResult.error}`}
            </div>
            {ldapResult.success && (
              <>
                <p className="text-sm text-gray-600">
                  Vendor: <span className="font-medium">{ldapResult.vendor}</span>
                  {' · '}
                  Group members: <span className="font-medium">{ldapResult.member_count}</span>
                </p>
                {ldapResult.sample_members?.length > 0 && (
                  <div>
                    <p className="text-xs text-gray-500 mb-1">First 5 members:</p>
                    <ul className="text-sm space-y-1">
                      {ldapResult.sample_members.map((m: any) => (
                        <li key={m.username} className="text-gray-700">
                          {m.display_name} <span className="text-gray-400">({m.username})</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {/* Live log */}
      <div className="card overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
          <h2 className="text-sm font-semibold text-gray-700">Live FreeRADIUS Log</h2>
          <span className={`inline-block w-2 h-2 rounded-full ${logConnected ? 'bg-green-500' : 'bg-red-400'}`} />
          <span className="text-xs text-gray-400">{logConnected ? 'Connected' : 'Disconnected'}</span>
        </div>
        <div
          ref={logRef}
          className="bg-gray-950 text-gray-300 text-xs font-mono p-4 overflow-auto"
          style={{ height: '400px' }}
        >
          {logLines.length === 0 ? (
            <span className="text-gray-600">Waiting for log output…</span>
          ) : (
            logLines.map((line, i) => (
              <div key={i} className={classifyLine(line)}>
                {line}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
