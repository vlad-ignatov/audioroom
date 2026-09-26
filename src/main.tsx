import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initLibrary } from './store/libraryPersistence'
import './index.css'

// The library loads asynchronously on desktop (SQLite, via the main process);
// rendering first would flash an empty list.
void initLibrary().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
