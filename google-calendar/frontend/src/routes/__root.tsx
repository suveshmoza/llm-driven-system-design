import { createRootRoute, Outlet, useNavigate } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useAuthStore } from '../stores/authStore'
import { getMe, logout as logoutApi } from '../services/api'
import { CalendarIcon, UserIcon } from '../components/icons'

function RootLayout() {
  const { user, isLoading, setUser, setLoading, logout } = useAuthStore()
  const navigate = useNavigate()

  useEffect(() => {
    getMe()
      .then(({ user }) => setUser(user))
      .catch(() => setUser(null))
  }, [setUser])

  const handleLogout = async () => {
    await logoutApi()
    logout()
    navigate({ to: '/login' })
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
        <div className="flex items-center justify-between h-16 px-4">
          <div className="flex items-center gap-3">
            <CalendarIcon className="w-8 h-8 text-blue-600" />
            <h1 className="text-xl font-semibold text-gray-900">Calendar</h1>
          </div>

          {user && (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-gray-600">
                <UserIcon className="w-5 h-5" />
                <span className="text-sm">{user.email}</span>
              </div>
              <button
                onClick={handleLogout}
                className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                Logout
              </button>
            </div>
          )}
        </div>
      </header>

      <main>
        <Outlet />
      </main>
    </div>
  )
}

export const Route = createRootRoute({
  component: RootLayout,
})
