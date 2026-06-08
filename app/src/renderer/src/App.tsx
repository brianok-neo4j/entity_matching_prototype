import { useEffect } from 'react'
import { useStore } from './store'
import Toast from './components/Toast'
import ConnectScreen from './screens/ConnectScreen'
import SessionListScreen from './screens/SessionListScreen'
import ConfigureScreen from './screens/ConfigureScreen'
import ComputeScreen from './screens/ComputeScreen'
import ReviewScreen from './screens/ReviewScreen'
import SettingsScreen from './screens/SettingsScreen'

export default function App() {
  const { screen, setScreen, toasts, removeToast, connection, setSettings } = useStore()

  // Load settings on startup
  useEffect(() => {
    window.api.settings.get().then(setSettings).catch(() => {})
  }, [])

  return (
    <div className="h-full flex flex-col bg-gray-950 text-gray-100">
      {/* Top nav bar */}
      <header className="flex items-center justify-between px-4 h-10 bg-gray-900 border-b border-gray-800 shrink-0">
        <button
          onClick={() => setScreen(connection ? 'sessions' : 'connect')}
          className="font-semibold text-emerald-400 tracking-wide text-sm hover:text-emerald-300 transition-colors"
        >
          ER Tool
        </button>

        <div className="flex items-center gap-1">
          {connection && (
            <span className="text-xs text-gray-600 mr-3">
              {connection.name}
            </span>
          )}
          {screen !== 'connect' && screen !== 'settings' && (
            <>
              <button
                onClick={() => setScreen('connect')}
                className="btn-ghost text-xs"
              >
                Connections
              </button>
              {connection && (
                <button
                  onClick={() => setScreen('sessions')}
                  className="btn-ghost text-xs"
                >
                  Sessions
                </button>
              )}
            </>
          )}
          <button
            onClick={() => setScreen('settings')}
            className="btn-ghost text-xs"
          >
            Settings
          </button>
        </div>
      </header>

      {/* Screen content */}
      <div className="flex-1 overflow-hidden">
        {screen === 'connect' && <ConnectScreen />}
        {screen === 'sessions' && <SessionListScreen />}
        {screen === 'configure' && <ConfigureScreen />}
        {screen === 'compute' && <ComputeScreen />}
        {screen === 'review' && <ReviewScreen />}
        {screen === 'settings' && <SettingsScreen />}
      </div>

      {/* Toast notifications */}
      <div className="fixed bottom-4 right-4 flex flex-col gap-2 z-[100] pointer-events-none">
        {toasts.map((t) => (
          <div key={t.id} className="pointer-events-auto">
            <Toast toast={t} onClose={() => removeToast(t.id)} />
          </div>
        ))}
      </div>
    </div>
  )
}
