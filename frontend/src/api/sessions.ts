import client from './client'

export interface ActiveSession {
  radacctid: number
  acctsessionid: string
  username: string
  nasipaddress: string
  nasportid: string | null
  calledstationid: string | null
  callingstationid: string | null
  framedipaddress: string | null
  acctstarttime: string | null
  duration_seconds: number
}

export async function getActiveSessions(): Promise<ActiveSession[]> {
  const { data } = await client.get('/sessions/active')
  return data
}

export async function disconnectSession(radacctid: number): Promise<void> {
  await client.delete(`/sessions/${radacctid}`)
}
