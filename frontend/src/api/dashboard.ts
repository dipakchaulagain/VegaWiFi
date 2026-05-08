import client from './client'

export interface DashboardSummary {
  active_sessions: number
  auth_attempts_last_hour: number
  failed_auths_last_hour: number
  blocked_users: number
  recent_sessions: RecentSession[]
}

export interface RecentSession {
  username: string
  nasipaddress: string
  calledstationid: string | null
  acctstarttime: string
  duration_seconds: number
}

export async function getDashboardSummary(): Promise<DashboardSummary> {
  const { data } = await client.get('/dashboard/summary')
  return data
}
