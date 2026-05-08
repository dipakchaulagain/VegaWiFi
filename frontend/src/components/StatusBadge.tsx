interface Props {
  status: 'active' | 'blocked' | 'inactive' | string
}

const MAP: Record<string, string> = {
  active: 'bg-green-100 text-green-800',
  blocked: 'bg-red-100 text-red-800',
  inactive: 'bg-gray-100 text-gray-600',
}

export default function StatusBadge({ status }: Props) {
  const classes = MAP[status] ?? 'bg-gray-100 text-gray-600'
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${classes}`}>
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}
