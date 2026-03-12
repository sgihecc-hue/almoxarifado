import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { checkSupabaseHealth } from '@/lib/supabase'

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
})

async function initializeApp() {
  try {
    const healthCheckPromise = checkSupabaseHealth()
    const timeoutPromise = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error('Health check timeout')), 8000)
    )

    try {
      await Promise.race([healthCheckPromise, timeoutPromise])
    } catch (error) {
      // Continue with app initialization even if health check fails
    }

    ReactDOM.createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
  } catch (error) {
    console.error('Failed to initialize app:', error)

    document.getElementById('root')!.innerHTML = `
      <div style="
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        font-family: system-ui;
        background: #f9fafb;
      ">
        <div style="
          background: white;
          padding: 2rem;
          border-radius: 0.5rem;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
          text-align: center;
          max-width: 400px;
          width: 100%;
        ">
          <h1 style="color: #dc2626; margin-bottom: 1rem;">Erro de Inicialização</h1>
          <p style="color: #6b7280; margin-bottom: 1.5rem;">
            Não foi possível conectar com o servidor. Verifique sua conexão e tente novamente.
          </p>
          <div style="margin-bottom: 1.5rem; padding: 1rem; background: #fef3c7; border-radius: 0.375rem; border: 1px solid #f59e0b;">
            <p style="color: #92400e; font-size: 0.875rem;">
              Se o problema persistir, entre em contato com o suporte técnico.
            </p>
          </div>
          <button
            onclick="window.location.reload()"
            style="
              background: #3b82f6;
              color: white;
              padding: 0.5rem 1rem;
              border: none;
              border-radius: 0.375rem;
              margin-right: 0.5rem;
              cursor: pointer;
            "
          >
            Recarregar Página
          </button>
          <button
            onclick="window.location.href='/login'"
            style="
              background: #6b7280;
              color: white;
              padding: 0.5rem 1rem;
              border: none;
              border-radius: 0.375rem;
              cursor: pointer;
            "
          >
            Ir para Login
          </button>
        </div>
      </div>
    `
  }
}

initializeApp()
