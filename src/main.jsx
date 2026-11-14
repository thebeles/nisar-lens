import React, { Suspense, lazy, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import './vercel-linear.css'

const ExplorerPage = lazy(() => import('./features/explorer/ExplorerPage.jsx'))

function AppRouter() {
  useEffect(() => {
    if (window.location.pathname !== '/') {
      window.history.replaceState({}, '', '/')
    }
  }, [])

  return <div>
    <Suspense fallback={<main className="min-h-screen bg-[#040406] px-6 py-16 text-[#F4F4F6] flex items-center justify-center font-mono text-xs tracking-[0.24em] uppercase" role="status"><span className="inline-flex items-center gap-3 px-5 py-3 rounded-full frosted-glass-pill"><span className="w-1.5 h-1.5 rounded-full bg-[#E11D48] animate-pulse" />Loading NISAR data dashboard…</span></main>}><ExplorerPage /></Suspense>
  </div>
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <AppRouter />
  </React.StrictMode>,
)
