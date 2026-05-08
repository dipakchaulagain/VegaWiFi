import client from './client'

export interface NasEntry {
  id?: number
  nasname: string
  shortname: string
  type?: string
  secret: string
  description?: string
}

export interface PolicyResponse {
  auth_mode: string
  default_simultaneous_use: number
  ldap_server: string | null
  ldap_bind_dn: string | null
  ldap_bind_pw: string
  ldap_base_dn: string | null
  ldap_group_dn: string | null
  ldap_user_filter: string | null
  radius_shared_secret: string
  nas_list: Omit<NasEntry, 'secret'>[]
}

export async function getPolicy(): Promise<PolicyResponse> {
  const { data } = await client.get('/policy')
  return data
}

export async function updatePolicy(payload: Partial<PolicyResponse> & { ldap_bind_pw?: string }): Promise<void> {
  await client.put('/policy', payload)
}

export async function getNasList(): Promise<Omit<NasEntry, 'secret'>[]> {
  const { data } = await client.get('/nas')
  return data
}

export async function createNas(entry: NasEntry): Promise<void> {
  await client.post('/nas', entry)
}

export async function updateNas(id: number, entry: NasEntry): Promise<void> {
  await client.put(`/nas/${id}`, entry)
}

export async function deleteNas(id: number): Promise<void> {
  await client.delete(`/nas/${id}`)
}
