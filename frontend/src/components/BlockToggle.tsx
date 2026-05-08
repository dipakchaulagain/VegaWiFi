import { useState } from 'react'
import ConfirmDialog from './ConfirmDialog'

interface Props {
  username: string
  blocked: boolean
  source?: 'local' | 'ldap'
  onToggle: (blocked: boolean, reason?: string) => Promise<void>
}

export default function BlockToggle({ username, blocked, onToggle }: Props) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)

  async function handleConfirm() {
    setLoading(true)
    try {
      await onToggle(!blocked)
    } finally {
      setLoading(false)
      setShowConfirm(false)
    }
  }

  return (
    <>
      <button
        className={`btn btn-sm ${blocked ? 'btn-secondary' : 'btn-danger'}`}
        onClick={() => setShowConfirm(true)}
        disabled={loading}
      >
        {loading ? '...' : blocked ? 'Unblock' : 'Block'}
      </button>
      {showConfirm && (
        <ConfirmDialog
          title={blocked ? `Unblock ${username}?` : `Block ${username}?`}
          message={
            blocked
              ? `This will allow ${username} to authenticate again.`
              : `This will immediately prevent ${username} from authenticating.`
          }
          confirmLabel={blocked ? 'Unblock' : 'Block'}
          danger={!blocked}
          onConfirm={handleConfirm}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </>
  )
}
