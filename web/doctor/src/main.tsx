import { createRoot } from 'react-dom/client'
import App from './app/App.tsx'
import { ensurePortalRole } from './lib/portalSession'
import './styles/index.css'

const PORTAL_URL = import.meta.env.VITE_PORTAL_URL || 'http://localhost:5170'

if (ensurePortalRole('doctor', PORTAL_URL)) {
  createRoot(document.getElementById('root')!).render(<App />)
}
  