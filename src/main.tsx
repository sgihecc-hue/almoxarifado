import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'
import { registrarErro } from '@/lib/registro-erros'

window.addEventListener('error', (event) => {
  console.error('Global error:', event.error)
  registrarErro(event.error ?? event.message, { tipo: 'navegador' })
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason)
  registrarErro(event.reason, { tipo: 'navegador' })
})

// Renderiza na hora. Antes o app esperava até 8 s um "health check" do banco
// antes de desenhar qualquer coisa (tela branca com banco lento). Agora a
// própria tela mostra "Verificando sua sessão..." e tenta de novo sozinha
// (contexts/auth.tsx) antes de declarar erro de conexão.
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
