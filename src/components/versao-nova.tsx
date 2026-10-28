import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'

// Versao nova no ar (Andressa 28/10: atualizou e seguiu na tela velha). Confere
// o /version.json de tempos em tempos e quando a pessoa volta pra aba. Achou
// versao nova: mostra a faixa e recarrega sozinho na proxima troca de tela
// (nunca no meio de um formulario aberto).
const INTERVALO_MS = 2 * 60 * 1000

async function buildNoAr(): Promise<string | null> {
  try {
    const r = await fetch(`/version.json?t=${Date.now()}`, { cache: 'no-store' })
    if (!r.ok) return null
    const j = await r.json()
    return typeof j?.build === 'string' ? j.build : null
  } catch {
    return null
  }
}

async function recarregar() {
  // Busca a pagina sem cache antes do reload: o navegador troca a copia
  // guardada e o reload ja vem com o index.html novo.
  try { await fetch(window.location.pathname + window.location.search, { cache: 'reload' }) } catch { /* segue */ }
  window.location.reload()
}

export function VersaoNova() {
  const location = useLocation()
  const [temNova, setTemNova] = useState(false)
  const caminhoRef = useRef(location.pathname)

  useEffect(() => {
    if (import.meta.env.DEV) return
    let ativo = true
    const conferir = async () => {
      const b = await buildNoAr()
      if (ativo && b && b !== __BUILD_ID__) setTemNova(true)
    }
    conferir()
    const t = window.setInterval(conferir, INTERVALO_MS)
    const aoVoltar = () => { if (document.visibilityState === 'visible') conferir() }
    document.addEventListener('visibilitychange', aoVoltar)
    return () => {
      ativo = false
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', aoVoltar)
    }
  }, [])

  // Troca de tela com versao nova pendente: recarrega
  useEffect(() => {
    if (location.pathname === caminhoRef.current) return
    caminhoRef.current = location.pathname
    if (temNova) recarregar()
  }, [location.pathname, temNova])

  if (!temNova) return null
  return (
    <div className="bg-emerald-50 border-b border-emerald-200 text-emerald-800 text-sm px-4 py-2 flex flex-wrap items-center gap-3 print:hidden">
      <span>Saiu uma versão nova do sistema.</span>
      <button
        type="button"
        onClick={recarregar}
        className="inline-flex items-center gap-1 font-semibold underline"
      >
        <RefreshCw size={14} /> Atualizar agora
      </button>
    </div>
  )
}
