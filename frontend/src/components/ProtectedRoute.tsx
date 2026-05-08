import { useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import client from '../api/client'

interface Props {
  children: React.ReactNode
}

type State = 'loading' | 'setup' | 'unauth' | 'ok'

export default function ProtectedRoute({ children }: Props) {
  const [state, setState] = useState<State>('loading')

  useEffect(() => {
    async function check() {
      try {
        // First check if setup is complete
        const setup = await client.get('/setup/status')
        if (!setup.data.setup_complete) {
          setState('setup')
          return
        }
        // Check auth by hitting a lightweight endpoint
        await client.get('/dashboard/summary')
        setState('ok')
      } catch (err: any) {
        if (err.response?.status === 401) {
          setState('unauth')
        } else if (err.response?.status === 403) {
          setState('setup')
        } else {
          setState('unauth')
        }
      }
    }
    check()
  }, [])

  if (state === 'loading') {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
      </div>
    )
  }
  if (state === 'setup') return <Navigate to="/setup" replace />
  if (state === 'unauth') return <Navigate to="/login" replace />
  return <>{children}</>
}
