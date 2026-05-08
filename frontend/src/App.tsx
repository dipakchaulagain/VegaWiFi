import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'
import Setup from './pages/Setup'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Sessions from './pages/Sessions'
import Accounting from './pages/Accounting'
import Users from './pages/Users'
import UserDetail from './pages/UserDetail'
import Policy from './pages/Policy'
import Diagnostics from './pages/Diagnostics'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/setup" element={<Setup />} />
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="sessions" element={<Sessions />} />
          <Route path="accounting" element={<Accounting />} />
          <Route path="users" element={<Users />} />
          <Route path="users/local/:username" element={<UserDetail />} />
          <Route path="policy" element={<Policy />} />
          <Route path="diagnostics" element={<Diagnostics />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
