import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Hunt #2: replace `document.getElementById('root')!` with an
// explicit existence check. index.html ships the #root div, so the
// failure mode here is a misconfigured build, not normal operation —
// throw with a clear message instead of letting React's mount throw
// against null.
const rootEl = document.getElementById('root')
if (!rootEl) {
  throw new Error("Missing #root element in index.html — can't mount React.")
}
createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
