import { useEffect, useState } from 'react'
import { getAccounting, getExportUrl, AccountingRecord, AccountingFilters } from '../api/accounting'
import { getNasList } from '../api/policy'

function formatBytes(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function Accounting() {
  const [records, setRecords] = useState<AccountingRecord[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const perPage = 50
  const [loading, setLoading] = useState(false)
  const [nasList, setNasList] = useState<{ id: number; nasname: string; shortname: string }[]>([])

  const [filters, setFilters] = useState<AccountingFilters>({})
  const [draft, setDraft] = useState<AccountingFilters>({})

  useEffect(() => {
    getNasList().then(setNasList).catch(() => {})
  }, [])

  async function load(f = filters, p = page) {
    setLoading(true)
    try {
      const res = await getAccounting({ ...f, page: p, per_page: perPage })
      setRecords(res.items)
      setTotal(res.total)
    } catch {
      // handled upstream
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page])

  function applyFilters() {
    setFilters(draft)
    setPage(1)
    load(draft, 1)
  }

  function resetFilters() {
    const empty = {}
    setDraft(empty)
    setFilters(empty)
    setPage(1)
    load(empty, 1)
  }

  const totalPages = Math.ceil(total / perPage)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Accounting Log</h1>
        <a
          href={getExportUrl(filters)}
          className="btn-secondary btn-sm"
          download
        >
          Export CSV
        </a>
      </div>

      {/* Filters */}
      <div className="card p-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div>
            <label className="label">Username</label>
            <input
              className="input"
              value={draft.username ?? ''}
              onChange={(e) => setDraft({ ...draft, username: e.target.value })}
              placeholder="Filter…"
            />
          </div>
          <div>
            <label className="label">NAS IP</label>
            <select
              className="input"
              value={draft.nas_ip ?? ''}
              onChange={(e) => setDraft({ ...draft, nas_ip: e.target.value })}
            >
              <option value="">All</option>
              {nasList.map((n) => (
                <option key={n.id} value={n.nasname}>{n.shortname} ({n.nasname})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">SSID</label>
            <input
              className="input"
              value={draft.ssid ?? ''}
              onChange={(e) => setDraft({ ...draft, ssid: e.target.value })}
              placeholder="Filter…"
            />
          </div>
          <div>
            <label className="label">From</label>
            <input
              className="input"
              type="date"
              value={draft.from_date ?? ''}
              onChange={(e) => setDraft({ ...draft, from_date: e.target.value })}
            />
          </div>
          <div>
            <label className="label">To</label>
            <input
              className="input"
              type="date"
              value={draft.to_date ?? ''}
              onChange={(e) => setDraft({ ...draft, to_date: e.target.value })}
            />
          </div>
        </div>
        <div className="flex gap-2 mt-3">
          <button className="btn-primary btn-sm" onClick={applyFilters}>Apply</button>
          <button className="btn-secondary btn-sm" onClick={resetFilters}>Reset</button>
        </div>
      </div>

      <div className="card overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-sm text-gray-400">Loading…</div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    {['Username', 'NAS IP', 'SSID', 'MAC', 'IP', 'Start', 'Stop', 'Duration', 'In', 'Out', 'Cause'].map((h) => (
                      <th key={h} className="px-3 py-3 text-left text-xs font-medium text-gray-500 uppercase whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-100">
                  {records.length === 0 ? (
                    <tr><td colSpan={11} className="px-4 py-8 text-center text-gray-400">No records</td></tr>
                  ) : (
                    records.map((r) => (
                      <tr key={r.radacctid} className="hover:bg-gray-50">
                        <td className="px-3 py-2 font-medium text-gray-900">{r.username}</td>
                        <td className="px-3 py-2 text-gray-600">{r.nasipaddress}</td>
                        <td className="px-3 py-2 text-gray-600 truncate max-w-[120px]">{r.calledstationid ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-600 font-mono text-xs">{r.callingstationid ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-600">{r.framedipaddress ?? '—'}</td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {r.acctstarttime ? new Date(r.acctstarttime).toLocaleString() : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                          {r.acctstoptime ? new Date(r.acctstoptime).toLocaleString() : <span className="text-green-600">Active</span>}
                        </td>
                        <td className="px-3 py-2 text-gray-600">
                          {r.acctsessiontime != null ? `${Math.floor(r.acctsessiontime / 60)}m` : '—'}
                        </td>
                        <td className="px-3 py-2 text-gray-600">{formatBytes(r.acctinputoctets)}</td>
                        <td className="px-3 py-2 text-gray-600">{formatBytes(r.acctoutputoctets)}</td>
                        <td className="px-3 py-2 text-gray-600">{r.acctterminatecause ?? '—'}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between text-sm text-gray-600">
                <span>
                  Showing {(page - 1) * perPage + 1}–{Math.min(page * perPage, total)} of {total}
                </span>
                <div className="flex gap-2">
                  <button className="btn-secondary btn-sm" disabled={page === 1} onClick={() => setPage(p => p - 1)}>
                    Prev
                  </button>
                  <button className="btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)}>
                    Next
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
