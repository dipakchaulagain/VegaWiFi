import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom'
import client from '../api/client'

const NAV = [
  { to: '/', label: 'Dashboard', icon: '⬛' },
  { to: '/sessions', label: 'Active Sessions', icon: '📡' },
  { to: '/accounting', label: 'Accounting', icon: '📋' },
  { to: '/users', label: 'Users', icon: '👤' },
  { to: '/policy', label: 'Policy', icon: '⚙️' },
  { to: '/diagnostics', label: 'Diagnostics', icon: '🔬' },
]

export default function Layout() {
  const navigate = useNavigate()

  async function handleLogout() {
    await client.post('/auth/logout')
    navigate('/login')
  }

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className="w-56 bg-gray-900 text-gray-100 flex flex-col flex-shrink-0">
        <div className="px-4 py-5 border-b border-gray-700">
          <h1 className="text-base font-semibold text-white">Wi-Fi AAA Portal</h1>
          <p className="text-xs text-gray-400 mt-0.5">802.1X Management</p>
        </div>
        <nav className="flex-1 px-2 py-4 space-y-0.5">
          {NAV.map(({ to, label, icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-300 hover:bg-gray-800 hover:text-white'
                }`
              }
            >
              <span className="text-base">{icon}</span>
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="px-2 py-4 border-t border-gray-700">
          <button
            onClick={handleLogout}
            className="w-full text-left flex items-center gap-2.5 px-3 py-2 rounded-md text-sm text-gray-300 hover:bg-gray-800 hover:text-white transition-colors"
          >
            <span>🚪</span> Sign out
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between">
          <div className="text-sm text-gray-500">
            FreeRADIUS + Huawei AC — 802.1X Management
          </div>
        </header>
        <main className="flex-1 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
