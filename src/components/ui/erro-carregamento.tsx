// =============================================================================
// <ErroCarregamento> — faixa vermelha "Não foi possível carregar. [Tentar de novo]"
// (auditoria 28/09/2026, X-05)
//
// PROBLEMA QUE RESOLVE: em muitas telas o erro da consulta era engolido e a tela
// mostrava lista vazia ("Nenhum item encontrado") — a pessoa achava que não
// havia dados quando na verdade o banco falhou ou a sessão caiu.
//
// COMO USAR (API mínima: erro + onTentar):
//
//   import { ErroCarregamento } from '@/components/ui/erro-carregamento'
//
//   const [erro, setErro] = useState<unknown>(null)
//   async function carregar() {
//     setErro(null)
//     const { data, error } = await supabase.from('x').select('*')
//     if (error) { setErro(error); return }      // NÃO faça setLista([]) aqui
//     setLista(data ?? [])
//   }
//
//   return (
//     <>
//       <ErroCarregamento erro={erro} onTentar={carregar} />
//       {!erro && lista.length === 0 && <p>Nenhum registro.</p>}   // vazio só sem erro
//       ...
//     </>
//   )
//
// - `erro`: qualquer coisa (Error, PostgrestError, string, null). Falsy => não
//   renderiza nada, então pode ficar sempre no JSX.
// - `onTentar` (opcional): mostra o botão "Tentar de novo".
// - `titulo` (opcional): troca o "Não foi possível carregar." (ex.: "Não foi
//   possível carregar as solicitações.").
// - `className` (opcional): margens extras.
// A mensagem técnica aparece pequena embaixo (ajuda o suporte).
// =============================================================================

import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useState } from 'react'

interface ErroCarregamentoProps {
  erro: unknown
  onTentar?: () => unknown
  titulo?: string
  className?: string
}

/** Texto legível de qualquer erro (Error, PostgrestError, string...). */
export function mensagemDeErro(erro: unknown): string {
  if (!erro) return ''
  if (typeof erro === 'string') return erro
  if (erro instanceof Error) return erro.message
  if (typeof erro === 'object' && erro !== null && 'message' in erro) {
    const m = (erro as { message?: unknown }).message
    if (typeof m === 'string') return m
  }
  return 'Erro desconhecido'
}

function explicar(tecnica: string): string | null {
  const t = tecnica.toLowerCase()
  if (t.includes('failed to fetch') || t.includes('network') || t.includes('timeout') || t.includes('abort')) {
    return 'Falha de conexão com o servidor. Verifique a internet.'
  }
  if (t.includes('jwt') || t.includes('permission denied') || t.includes('row-level security')) {
    return 'Sem permissão ou sessão expirada.'
  }
  return null
}

export function ErroCarregamento({ erro, onTentar, titulo, className = '' }: ErroCarregamentoProps) {
  const [tentando, setTentando] = useState(false)
  if (!erro) return null
  const tecnica = mensagemDeErro(erro)
  const dica = explicar(tecnica)

  async function tentar() {
    if (!onTentar || tentando) return
    setTentando(true)
    try {
      await onTentar()
    } finally {
      setTentando(false)
    }
  }

  return (
    <div role="alert" className={`flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800 ${className}`}>
      <AlertTriangle className="w-5 h-5 mt-0.5 shrink-0 text-red-600" />
      <div className="flex-1 min-w-0">
        <p className="font-medium">{titulo ?? 'Não foi possível carregar.'}{dica ? ` ${dica}` : ''}</p>
        {tecnica && <p className="text-xs text-red-700/80 mt-0.5 break-words">{tecnica}</p>}
      </div>
      {onTentar && (
        <button
          type="button"
          onClick={tentar}
          disabled={tentando}
          className="shrink-0 inline-flex items-center gap-1 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${tentando ? 'animate-spin' : ''}`} />
          {tentando ? 'Tentando...' : 'Tentar de novo'}
        </button>
      )}
    </div>
  )
}
