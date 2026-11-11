import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { installCrossTabSessionSync } from './lib/session'

// Keep sessions consistent across tabs (token rotation, sign-out).
installCrossTabSessionSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
