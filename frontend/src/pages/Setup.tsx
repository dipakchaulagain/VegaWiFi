import { FormEvent, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import client from '../api/client'

type AuthMode = 'db' | 'ldap' | 'hybrid'

interface SetupForm {
  auth_mode: AuthMode
  ldap_server: string
  ldap_bind_dn: string
  ldap_bind_pw: string
  ldap_base_dn: string
  ldap_group_dn: string
  ldap_user_filter: string
  radius_shared_secret: string
  nas_ip: string
  nas_shortname: string
  nas_description: string
  eap_cert_path: string
  generate_cert: boolean
  admin_username: string
  admin_password: string
  admin_confirm: string
}

const INITIAL: SetupForm = {
  auth_mode: 'db',
  ldap_server: 'ldaps://',
  ldap_bind_dn: '',
  ldap_bind_pw: '',
  ldap_base_dn: '',
  ldap_group_dn: '',
  ldap_user_filter: '(&(objectClass=user)(sAMAccountName=%u))',
  radius_shared_secret: '',
  nas_ip: '',
  nas_shortname: 'huawei-ac',
  nas_description: 'Huawei AC6508',
  eap_cert_path: '',
  generate_cert: true,
  admin_username: 'admin',
  admin_password: '',
  admin_confirm: '',
}

const STEPS = ['Auth Mode', 'LDAP Config', 'RADIUS / AC', 'EAP Certificate', 'Admin Account']

function StepIndicator({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} className="flex items-center gap-2">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
              i < current
                ? 'bg-blue-600 text-white'
                : i === current
                ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-500'
                : 'bg-gray-100 text-gray-400'
            }`}
          >
            {i < current ? '✓' : i + 1}
          </div>
          {i < total - 1 && (
            <div className={`h-0.5 w-8 ${i < current ? 'bg-blue-600' : 'bg-gray-200'}`} />
          )}
        </div>
      ))}
    </div>
  )
}

export default function Setup() {
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  const [form, setForm] = useState<SetupForm>(INITIAL)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [ldapTested, setLdapTested] = useState(false)
  const [certGenerating, setCertGenerating] = useState(false)
  const [certPath, setCertPath] = useState('')

  useEffect(() => {
    client.get('/setup/status').then(res => {
      if (res.data.setup_complete) navigate('/', { replace: true })
    }).catch(() => {})
  }, [navigate])

  const needsLdap = form.auth_mode !== 'db'
  const totalSteps = STEPS.length

  function f(key: keyof SetupForm) {
    return (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
      setForm(prev => ({ ...prev, [key]: e.target.value }))
    }
  }

  async function testLdap() {
    setError('')
    setLoading(true)
    try {
      await client.post('/setup/test-ldap', {
        ldap_server: form.ldap_server,
        ldap_bind_dn: form.ldap_bind_dn,
        ldap_bind_pw: form.ldap_bind_pw,
        ldap_base_dn: form.ldap_base_dn,
      })
      setLdapTested(true)
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'LDAP test failed')
    } finally {
      setLoading(false)
    }
  }

  async function generateCert() {
    setCertGenerating(true)
    setError('')
    try {
      const res = await client.post('/setup/generate-eap-cert')
      setCertPath(res.data.cert_path)
      setForm(prev => ({ ...prev, eap_cert_path: res.data.cert_path }))
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Certificate generation failed')
    } finally {
      setCertGenerating(false)
    }
  }

  function validateStep(): string {
    if (step === 0) return ''
    if (step === 1 && needsLdap) {
      if (!form.ldap_server || !form.ldap_bind_dn || !form.ldap_bind_pw || !form.ldap_base_dn)
        return 'All LDAP fields are required'
      if (!ldapTested) return 'Please test the LDAP connection before proceeding'
    }
    if (step === 2) {
      if (!form.radius_shared_secret) return 'Shared secret is required'
      if (!form.nas_ip) return 'AC IP address is required'
      if (!form.nas_shortname) return 'Shortname is required'
    }
    if (step === 3) {
      if (!form.generate_cert && !form.eap_cert_path) return 'Provide a certificate path or generate one'
    }
    if (step === 4) {
      if (!form.admin_username) return 'Username is required'
      if (form.admin_password.length < 8) return 'Password must be at least 8 characters'
      if (form.admin_password !== form.admin_confirm) return 'Passwords do not match'
    }
    return ''
  }

  function next() {
    const err = validateStep()
    if (err) { setError(err); return }
    setError('')
    if (step === 0 && !needsLdap) {
      setStep(2) // skip LDAP step
    } else {
      setStep(s => s + 1)
    }
  }

  function back() {
    setError('')
    if (step === 2 && !needsLdap) {
      setStep(0)
    } else {
      setStep(s => s - 1)
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const err = validateStep()
    if (err) { setError(err); return }

    setLoading(true)
    setError('')
    try {
      await client.post('/setup/init', {
        auth_mode: form.auth_mode,
        ldap_server: needsLdap ? form.ldap_server : undefined,
        ldap_bind_dn: needsLdap ? form.ldap_bind_dn : undefined,
        ldap_bind_pw: needsLdap ? form.ldap_bind_pw : undefined,
        ldap_base_dn: needsLdap ? form.ldap_base_dn : undefined,
        ldap_group_dn: needsLdap ? form.ldap_group_dn : undefined,
        ldap_user_filter: form.ldap_user_filter,
        radius_shared_secret: form.radius_shared_secret,
        nas_ip: form.nas_ip,
        nas_shortname: form.nas_shortname,
        nas_description: form.nas_description || undefined,
        eap_cert_path: form.generate_cert ? certPath || undefined : form.eap_cert_path || undefined,
        admin_username: form.admin_username,
        admin_password: form.admin_password,
      })
      navigate('/', { replace: true })
    } catch (err: any) {
      setError(err.response?.data?.detail ?? 'Setup failed')
    } finally {
      setLoading(false)
    }
  }

  const currentStepIdx = needsLdap ? step : step === 0 ? 0 : step - 1

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center py-12">
      <div className="card p-8 w-full max-w-2xl">
        <h1 className="text-2xl font-bold text-gray-900 text-center mb-1">Wi-Fi AAA Portal Setup</h1>
        <p className="text-sm text-gray-500 text-center mb-8">Configure your 802.1X authentication infrastructure</p>

        <StepIndicator current={step} total={totalSteps} />

        <h2 className="text-base font-semibold text-gray-800 mb-4">{STEPS[step]}</h2>

        <form onSubmit={submit} className="space-y-4">
          {/* Step 0: Auth Mode */}
          {step === 0 && (
            <div className="space-y-3">
              {(
                [
                  ['db', 'Local DB only', 'Users are stored in the FreeRADIUS database. No AD integration.'],
                  ['ldap', 'LDAP / Active Directory only', 'Authenticate against an AD group. No local RADIUS users.'],
                  ['hybrid', 'Hybrid (DB + LDAP fallback)', 'Try local DB first, then LDAP.'],
                ] as [AuthMode, string, string][]
              ).map(([val, label, desc]) => (
                <label key={val} className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  form.auth_mode === val ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-300'
                }`}>
                  <input
                    type="radio"
                    name="auth_mode"
                    value={val}
                    checked={form.auth_mode === val}
                    onChange={f('auth_mode')}
                    className="mt-0.5"
                  />
                  <div>
                    <p className="text-sm font-medium text-gray-900">{label}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          )}

          {/* Step 1: LDAP Config */}
          {step === 1 && needsLdap && (
            <div className="space-y-3">
              <div>
                <label className="label">LDAP Server URL</label>
                <input className="input" value={form.ldap_server} onChange={f('ldap_server')}
                  placeholder="ldaps://dc.domain.com" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Bind DN</label>
                  <input className="input" value={form.ldap_bind_dn} onChange={f('ldap_bind_dn')}
                    placeholder="cn=radius-bind,ou=service,dc=domain,dc=com" />
                </div>
                <div>
                  <label className="label">Bind Password</label>
                  <input className="input" type="password" value={form.ldap_bind_pw} onChange={f('ldap_bind_pw')} />
                </div>
              </div>
              <div>
                <label className="label">Base DN</label>
                <input className="input" value={form.ldap_base_dn} onChange={f('ldap_base_dn')}
                  placeholder="dc=domain,dc=com" />
              </div>
              <div>
                <label className="label">Group DN</label>
                <input className="input" value={form.ldap_group_dn} onChange={f('ldap_group_dn')}
                  placeholder="cn=WiFi-Users,ou=Groups,dc=domain,dc=com" />
              </div>
              <div>
                <label className="label">User Filter</label>
                <input className="input" value={form.ldap_user_filter} onChange={f('ldap_user_filter')} />
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={testLdap}
                  disabled={loading}
                >
                  {loading ? 'Testing…' : 'Test Connection'}
                </button>
                {ldapTested && (
                  <span className="text-sm text-green-600 font-medium">✓ Connection successful</span>
                )}
              </div>
            </div>
          )}

          {/* Step 2: RADIUS / AC */}
          {step === 2 && (
            <div className="space-y-3">
              <div>
                <label className="label">RADIUS Shared Secret</label>
                <input className="input" type="password" value={form.radius_shared_secret}
                  onChange={f('radius_shared_secret')} placeholder="min 8 characters" required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Huawei AC IP Address</label>
                  <input className="input" value={form.nas_ip} onChange={f('nas_ip')}
                    placeholder="192.168.1.1" required />
                </div>
                <div>
                  <label className="label">Shortname</label>
                  <input className="input" value={form.nas_shortname} onChange={f('nas_shortname')} required />
                </div>
              </div>
              <div>
                <label className="label">Description</label>
                <input className="input" value={form.nas_description} onChange={f('nas_description')} />
              </div>
            </div>
          )}

          {/* Step 3: EAP Certificate */}
          {step === 3 && (
            <div className="space-y-4">
              <div className="space-y-3">
                <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  form.generate_cert ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}>
                  <input type="radio" name="cert_mode" checked={form.generate_cert}
                    onChange={() => setForm(p => ({ ...p, generate_cert: true }))} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Generate self-signed CA with easy-rsa</p>
                    <p className="text-xs text-gray-500">Recommended for new deployments. Creates a local CA and server certificate.</p>
                  </div>
                </label>
                <label className={`flex items-start gap-3 p-4 rounded-lg border cursor-pointer transition-colors ${
                  !form.generate_cert ? 'border-blue-500 bg-blue-50' : 'border-gray-200'
                }`}>
                  <input type="radio" name="cert_mode" checked={!form.generate_cert}
                    onChange={() => setForm(p => ({ ...p, generate_cert: false }))} className="mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">Use existing certificate</p>
                    <p className="text-xs text-gray-500">Provide the path to an existing PEM certificate.</p>
                  </div>
                </label>
              </div>

              {form.generate_cert ? (
                <div>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={generateCert}
                    disabled={certGenerating}
                  >
                    {certGenerating ? 'Generating…' : certPath ? 'Regenerate Certificate' : 'Generate Certificate'}
                  </button>
                  {certPath && (
                    <p className="text-sm text-green-600 mt-2">
                      ✓ Certificate generated: <code className="font-mono text-xs">{certPath}</code>
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="label">Certificate Path (PEM)</label>
                  <input className="input" value={form.eap_cert_path} onChange={f('eap_cert_path')}
                    placeholder="/etc/freeradius/3.0/certs/server.pem" />
                </div>
              )}
            </div>
          )}

          {/* Step 4: Admin Account */}
          {step === 4 && (
            <div className="space-y-4">
              <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1 text-gray-600">
                <p className="font-medium text-gray-800 mb-2">Configuration Summary</p>
                <p>Auth mode: <span className="font-medium">{form.auth_mode}</span></p>
                <p>AC IP: <span className="font-medium">{form.nas_ip}</span></p>
                {needsLdap && <p>LDAP server: <span className="font-medium">{form.ldap_server}</span></p>}
                {needsLdap && <p>Group DN: <span className="font-medium">{form.ldap_group_dn || '(not set)'}</span></p>}
                <p>EAP cert: <span className="font-medium">{form.generate_cert ? 'self-signed (auto-generated)' : form.eap_cert_path}</span></p>
              </div>
              <div>
                <label className="label">Admin Username</label>
                <input className="input w-64" value={form.admin_username} onChange={f('admin_username')} required />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Password</label>
                  <input className="input" type="password" value={form.admin_password}
                    onChange={f('admin_password')} required />
                </div>
                <div>
                  <label className="label">Confirm Password</label>
                  <input className="input" type="password" value={form.admin_confirm}
                    onChange={f('admin_confirm')} required />
                </div>
              </div>
            </div>
          )}

          {error && (
            <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex justify-between pt-4">
            <button
              type="button"
              className="btn-secondary"
              onClick={back}
              disabled={step === 0}
            >
              Back
            </button>
            {step < totalSteps - 1 ? (
              <button type="button" className="btn-primary" onClick={next}>
                Next
              </button>
            ) : (
              <button type="submit" className="btn-primary" disabled={loading}>
                {loading ? 'Setting up…' : 'Complete Setup'}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  )
}
