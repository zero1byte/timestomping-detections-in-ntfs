import { useState, useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, Link, useLocation } from 'react-router-dom'

const routeModules = import.meta.glob('./routes/*.jsx', { eager: true })

function toPath(filePath) {
  const fileName = filePath.split('/').pop()?.replace('.jsx', '') || ''
  if (fileName.toLowerCase() === 'home' || fileName.toLowerCase() === 'index') return '/'
  return `/${fileName.toLowerCase()}`
}

function buildRoutes() {
  const routes = []

  Object.entries(routeModules).forEach(([filePath, mod]) => {
    const Page = mod.default
    if (!Page) return
    routes.push({ path: toPath(filePath), Component: Page })
  })

  return routes
}

function NotFound() {
  return (
    <main style={{ padding: '2rem' }}>
      <h1>404 - Page not found</h1>
      <p>Create a new file in src/routes to add a new page.</p>
    </main>
  )
}

/* ── Theme toggle hook ── */
function useTheme() {
  const [dark, setDark] = useState(() => {
    try { return localStorage.getItem('theme') === 'dark' } catch { return false }
  })

  useEffect(() => {
    const root = document.documentElement
    if (dark) root.classList.add('dark')
    else root.classList.remove('dark')
    try { localStorage.setItem('theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])

  return [dark, () => setDark((d) => !d)]
}

/* ── Fixed Header ── */
function AppHeader({ dark, toggleTheme }) {
  const location = useLocation()

  const NAV = [
    { path: '/', label: 'Home' },
    { path: '/partitions', label: 'Partitions' },
    { path: '/about', label: 'About' },
  ]

  return (
    <header className="fixed inset-x-0 top-0 z-[100] flex h-14 items-center justify-between border-b border-theme-border bg-theme-surface/80 px-5 backdrop-blur-md">
      {/* Left — tool name + nav */}
      <div className="flex items-center gap-6">
        <Link to="/" className="flex items-center gap-2 text-sm font-bold tracking-tight text-theme-fg transition hover:text-theme-accent">
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-theme-accent">
            <rect x="3" y="3" width="18" height="18" rx="3" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 9h18M9 9v12" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="6" cy="6" r="1.2" fill="currentColor" />
          </svg>
          NTFS Timestomping Detector
        </Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {NAV.map((n) => {
            const active = location.pathname === n.path
            return (
              <Link
                key={n.path}
                to={n.path}
                className={`rounded-lg px-2.5 py-1.5 text-xs font-medium transition ${
                  active
                    ? 'bg-theme-accent/10 text-theme-accent'
                    : 'text-theme-fg/50 hover:bg-theme-accent/5 hover:text-theme-fg/80'
                }`}
              >
                {n.label}
              </Link>
            )
          })}
        </nav>
      </div>

      {/* Right — theme toggle */}
      <button
        onClick={toggleTheme}
        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-theme-border text-theme-fg/60 transition hover:bg-theme-accent/10 hover:text-theme-accent"
        title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
      >
        {dark ? (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
            <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
          </svg>
        )}
      </button>
    </header>
  )
}

export default function App() {
  const routes = buildRoutes()
  const hasHome = routes.some((route) => route.path === '/')
  const [dark, toggleTheme] = useTheme()

  return (
    <BrowserRouter>
      <AppHeader dark={dark} toggleTheme={toggleTheme} />
      <div className="pt-14">
        <Routes>
          {routes.map(({ path, Component }) => (
            <Route key={path} path={path} element={<Component />} />
          ))}
          {!hasHome && <Route path="/" element={<Navigate to={routes[0]?.path || '/404'} replace />} />}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </BrowserRouter>
  )
}
