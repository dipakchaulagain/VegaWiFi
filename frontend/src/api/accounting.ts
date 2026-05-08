import client from './client'

export interface AccountingRecord {
  radacctid: number
  acctsessionid: string
  username: string
  realm: string | null
  nasipaddress: string
  calledstationid: string | null
  callingstationid: string | null
  framedipaddress: string | null
  acctstarttime: string | null
  acctstoptime: string | null
  acctsessiontime: number | null
  acctinputoctets: number | null
  acctoutputoctets: number | null
  acctterminatecause: string | null
}

export interface AccountingFilters {
  username?: string
  nas_ip?: string
  ssid?: string
  from_date?: string
  to_date?: string
  page?: number
  per_page?: number
}

export interface AccountingResponse {
  total: number
  page: number
  per_page: number
  items: AccountingRecord[]
}

export async function getAccounting(filters: AccountingFilters): Promise<AccountingResponse> {
  const { data } = await client.get('/accounting', { params: filters })
  return data
}

export function getExportUrl(filters: Omit<AccountingFilters, 'page' | 'per_page'>): string {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([k, v]) => {
    if (v) params.set(k, v)
  })
  return `/api/v1/accounting/export?${params.toString()}`
}
