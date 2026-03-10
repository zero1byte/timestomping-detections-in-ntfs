import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'

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

export default function App() {
  const routes = buildRoutes()
  const hasHome = routes.some((route) => route.path === '/')

  return (
    <BrowserRouter>
      <Routes>
        {routes.map(({ path, Component }) => (
          <Route key={path} path={path} element={<Component />} />
        ))}
        {!hasHome && <Route path="/" element={<Navigate to={routes[0]?.path || '/404'} replace />} />}
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  )
}
