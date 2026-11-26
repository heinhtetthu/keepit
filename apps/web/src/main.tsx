import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BrowserRouter } from 'react-router-dom'
import { CoreProvider } from '@workspace/core'
import App from './App'
import { coreApi } from './lib/core'
import '@fontsource-variable/inter'
import './index.css'
import './store/theme'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
})

// Makes it obvious in DevTools which build the browser is running.
console.info('[app] bundle:', import.meta.url.split('/').pop())

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <CoreProvider api={coreApi}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </CoreProvider>
    </QueryClientProvider>
  </React.StrictMode>,
)
