import client from './client'

export interface LocalUser {
  username: string
  simultaneous_use: number
  blocked: boolean
  last_seen: string | null
}

export interface LdapUser {
  username: string
  display_name: string | null
  email: string | null
  distinguished_name: string | null
  current_sessions: number
  last_seen: string | null
  blocked: boolean
}

export interface UserDetail {
  username: string
  blocked: boolean
  simultaneous_use: number
  auth_history: AuthHistoryEntry[]
  active_sessions: UserSession[]
}

export interface AuthHistoryEntry {
  id: number
  username: string
  pass: string
  reply: string
  authdate: string
}

export interface UserSession {
  radacctid: number
  acctsessionid: string
  nasipaddress: string
  calledstationid: string | null
  framedipaddress: string | null
  acctstarttime: string | null
  duration_seconds: number
}

export async function getLocalUsers(): Promise<LocalUser[]> {
  const { data } = await client.get('/users/local')
  return data
}

export async function createLocalUser(payload: {
  username: string
  password: string
  simultaneous_use?: number
}): Promise<void> {
  await client.post('/users/local', payload)
}

export async function updateLocalUser(
  username: string,
  payload: { password?: string; simultaneous_use?: number }
): Promise<void> {
  await client.put(`/users/local/${username}`, payload)
}

export async function deleteLocalUser(username: string): Promise<void> {
  await client.delete(`/users/local/${username}`)
}

export async function blockUser(username: string, source: 'local' | 'ldap', reason?: string): Promise<void> {
  await client.post(`/users/${source}/${username}/block`, { reason })
}

export async function unblockUser(username: string, source: 'local' | 'ldap'): Promise<void> {
  await client.post(`/users/${source}/${username}/unblock`)
}

export async function getUserDetail(username: string): Promise<UserDetail> {
  const { data } = await client.get(`/users/local/${username}/detail`)
  return data
}

export async function getLdapUsers(): Promise<{ group_dn: string; members: LdapUser[] }> {
  const { data } = await client.get('/users/ldap')
  return data
}
