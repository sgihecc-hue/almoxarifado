// Entradas de estoque: rodada unica, trava de envio e leitura dos avisos do
// banco. Ver supabase/migrations/20260921180000_almox_entradas_seguras.sql.
//
// Por que existe: em 17/09 a NF 1599 foi gravada duas vezes com 1s de
// diferenca (duplo clique), e em 28/08 a mesma compra de mascaras entrou duas
// vezes. A tela manda um id de RODADA; o banco recusa a mesma rodada de novo.

import { useCallback, useRef } from 'react'
import { dataBR as dataBRSeguro } from '@/lib/utils/seguro'

/** Id novo de rodada. Um por abertura de tela/dialogo; o banco nao aceita repetido. */
export function novaRodadaId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  // Navegador antigo: uuid v4 a mao.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * Trava de envio que fecha NA HORA do clique. O `disabled={submitting}` so vale
 * depois que a tela redesenha — um segundo clique nesse intervalo passava.
 */
export function useTravaEnvio() {
  const travado = useRef(false)
  const tentar = useCallback(() => {
    if (travado.current) return false
    travado.current = true
    return true
  }, [])
  const liberar = useCallback(() => { travado.current = false }, [])
  return { tentar, liberar }
}

export interface EntradaParecida {
  entrada_id: string
  data: string
  quantidade: number
  nf: string | null
  lote?: string | null
  por?: string | null
  motivo?: 'mesma_nf' | 'mesmo_lote_quantidade'
}

export type AvisoEntrada =
  | { tipo: 'ja_registrada' }
  | { tipo: 'parecida'; info: EntradaParecida }
  | { tipo: 'nf_ja_usada'; info: EntradaParecida }

/** Le os avisos que o banco devolve como erro com prefixo conhecido. */
export function lerAvisoEntrada(e: unknown): AvisoEntrada | null {
  const msg = String((e as any)?.message ?? e ?? '')
  if (msg.includes('ENTRADA_JA_REGISTRADA')) return { tipo: 'ja_registrada' }
  const json = (prefixo: string) => {
    const i = msg.indexOf(prefixo)
    if (i < 0) return null
    try { return JSON.parse(msg.slice(i + prefixo.length).trim()) } catch { return null }
  }
  const parecida = json('ENTRADA_PARECIDA:')
  if (parecida) return { tipo: 'parecida', info: parecida }
  const nf = json('NF_JA_USADA:')
  if (nf) return { tipo: 'nf_ja_usada', info: nf }
  return null
}

/**
 * Data para exibir. Coluna date ('YYYY-MM-DD') vai pelo dataBR de seguro.ts:
 * new Date('YYYY-MM-DD') e meia-noite UTC e aparecia UM DIA ANTES na tela
 * (validade, data da NF). Timestamp com hora segue pelo relogio local.
 */
export function dataBR(iso: string | null | undefined, comHora = false): string {
  if (!iso) return '—'
  if (!comHora || /^\d{4}-\d{2}-\d{2}$/.test(iso.trim())) return dataBRSeguro(iso)
  const d = new Date(iso)
  return isNaN(d.getTime()) ? '—' : d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
}

/** Aviso para validade anterior a data da entrada (vencido ou digitado errado). */
export function avisoValidade(validade: string | null | undefined, dataEntrada: string): string | null {
  if (!validade) return null
  const ano = Number(validade.slice(0, 4))
  const teto = new Date().getFullYear() + 30
  if (!(ano >= 2015 && ano <= teto)) return `Validade ${dataBRSeguro(validade)} parece digitada errada. Confira o ano.`
  if (validade < dataEntrada) return `Validade ${dataBRSeguro(validade)} é anterior à data da entrada: o produto já chega vencido. Confira.`
  return null
}

/** Frase curta para o aviso de entrada parecida. */
export function descreverParecida(info: EntradaParecida): string {
  const quando = dataBR(info.data, true)
  const nf = info.nf && !['—', '-'].includes(info.nf) ? `NF ${info.nf}` : 'sem NF'
  const porque = info.motivo === 'mesma_nf' ? 'com a mesma nota fiscal' : `com o mesmo lote${info.lote ? ` (${info.lote})` : ''} e a mesma quantidade`
  return `Já existe uma entrada deste item ${porque}: ${info.quantidade} un em ${quando}, ${nf}${info.por ? `, por ${info.por}` : ''}.`
}
