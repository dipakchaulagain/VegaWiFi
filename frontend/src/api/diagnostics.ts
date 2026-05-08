import client from './client'

export async function testAuth(username: string, password: string): Promise<{ success: boolean; output: string }> {
  const { data } = await client.post('/diagnostics/test-auth', { username, password })
  return data
}

export async function testLdap(): Promise<{
  success: boolean
  error?: string
  vendor?: string
  naming_contexts?: string[]
  member_count?: number
  sample_members?: { username: string; display_name: string }[]
}> {
  const { data } = await client.post('/diagnostics/test-ldap', { use_saved: true })
  return data
}
