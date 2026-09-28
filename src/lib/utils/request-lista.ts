// =============================================================================
// Carregamento das listas de solicitacoes (Caixa de Entrada, Pendencias, Em
// Processamento, Historico, Minhas Solicitacoes).
//
// - Filtro no BANCO (tipo, status, periodo, solicitante), sem teto de 100.
// - Sem cache: pedido novo aparece; atualizacao periodica opcional (60s).
// - Erro NAO vira lista vazia: `erro` vem preenchido e a tela mostra
//   "Nao foi possivel carregar" com "Tentar de novo".
// =============================================================================
import { useCallback, useEffect, useRef, useState } from 'react'
import { requestService } from '@/lib/services/requests'
import type { FiltroSolicitacoes, Request } from '@/lib/services/requests'

export function useListaSolicitacoes(
  filtro: FiltroSolicitacoes | null,
  opts: { atualizarCadaMs?: number } = {},
) {
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [erro, setErro] = useState<string | null>(null)
  const seq = useRef(0)
  const chave = JSON.stringify(filtro)

  const recarregar = useCallback(async (silencioso = false) => {
    if (!filtro) return
    const meu = ++seq.current
    if (!silencioso) setLoading(true)
    try {
      const data = await requestService.getAll(filtro)
      if (meu !== seq.current) return
      setRequests(data)
      setErro(null)
    } catch (e) {
      if (meu !== seq.current) return
      // Atualizacao silenciosa que falha mantem a lista que ja estava na tela.
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as solicitações.')
    } finally {
      if (meu === seq.current && !silencioso) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave])

  useEffect(() => {
    recarregar()
    const ms = opts.atualizarCadaMs
    if (!ms) return
    const t = window.setInterval(() => recarregar(true), ms)
    return () => window.clearInterval(t)
  }, [recarregar, opts.atualizarCadaMs])

  return { requests, loading, erro, recarregar }
}

/** Fim do intervalo para o banco: null = aberto (ate agora). */
export function periodoParaFiltro(periodo: { startDate: Date; endDate: Date | null }) {
  return { desde: periodo.startDate, ate: periodo.endDate }
}
