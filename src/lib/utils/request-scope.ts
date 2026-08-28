// =====================================================================
// Quem pode ATENDER uma solicitação.
//
// Regra: o operador só atende solicitação do PRÓPRIO módulo. Quem é lotado
// no Almoxarifado atende pedido de almoxarifado; quem é lotado no CAF ou
// numa satélite atende pedido de farmácia. Isso apenas escreve no código o
// que a operação já faz na prática — no histórico do sistema nenhum
// aprovador cruzou a fronteira: ALM aprovou 520 pedidos, todos de
// almoxarifado; CAF/satélites aprovaram 78, todos de farmácia.
//
// Antes disso, a permissão olhava SÓ o papel (`atendente` liberava tudo), e
// por isso um atendente da farmácia abria a tela de atendimento de um pedido
// do almoxarifado — com quantidade fornecida editável e botões de aprovar e
// rejeitar. Era esse o defeito.
//
// homeModule = null significa "sem vínculo de módulo" (administrador,
// Supervisão Administrativa, usuário sem setor). Esses seguem sem restrição,
// senão a supervisão fica trancada fora do sistema.
// =====================================================================

import type { ModuleType } from '@/contexts/module'

export type RequestKind = 'pharmacy' | 'warehouse'

/** Converte o tipo da solicitação no módulo correspondente. */
export function moduloDaSolicitacao(type?: RequestKind | string | null): ModuleType {
  if (type === 'pharmacy') return 'farmacia'
  if (type === 'warehouse') return 'almoxarifado'
  return null
}

/**
 * O usuário deste módulo pode atender uma solicitação deste tipo?
 *
 * Só responde NÃO quando há certeza dos dois lados: o usuário tem módulo
 * definido E a solicitação tem tipo conhecido E eles divergem. Qualquer
 * dúvida libera — bloquear quem precisa trabalhar é pior que o defeito.
 */
export function podeAtenderSolicitacao(
  homeModule: ModuleType,
  type?: RequestKind | string | null,
): boolean {
  if (!homeModule) return true
  const doPedido = moduloDaSolicitacao(type)
  if (!doPedido) return true
  return homeModule === doPedido
}
