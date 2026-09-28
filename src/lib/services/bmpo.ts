// =====================================================================
// BMPO — Balanço de Medicamentos Psicoativos
// Portaria SVS/MS 344/98, Art. 64 — balanço periódico de controlados.
//
// Lê movimentações da tabela imutável `stock_movements` (livro-razão)
// e perdas de `medication_losses`, agregando por item controlado.
//
// Colunas reais usadas de stock_movements (ver src/lib/types/stock.ts):
//   item_id, movement_type, direction ('in' | 'out'), quantity,
//   performed_at (timestamp da movimentação)
// =====================================================================

import { supabase } from '@/lib/supabase'
import { buscarTodas, fimDiaISO, inicioDiaISO } from '@/lib/utils/seguro'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface BalancoRow {
  item_id: string
  item_nome: string
  lista: string
  estoque_anterior: number
  entradas: number
  saidas: number
  perdas: number
  saldo_final: number
}

export type BmpoTipo = 'trimestral' | 'anual'

export interface BmpoBalanco {
  id: string
  tipo: BmpoTipo | string
  ano: number
  trimestre: number | null
  lista: string | null
  data_inicio: string | null
  data_fim: string | null
  status: string
  dados: BalancoRow[] | null
  observacao: string | null
  gerado_por: string | null
  gerado_em: string
}

export interface SaveBalancoPayload {
  tipo: BmpoTipo
  ano: number
  trimestre: number | null
  lista: string | null
  data_inicio: string
  data_fim: string
  dados: BalancoRow[]
  observacao?: string | null
}

// ---------------------------------------------------------------------------
// Internal row shapes (raw selects)
// ---------------------------------------------------------------------------
interface ControlledItem {
  id: string
  name: string
  controlled_subclass: string | null
}

interface MovementRow {
  item_id: string | null
  direction: 'in' | 'out' | string
  quantity: number | null
  performed_at: string | null
}

interface LossRow {
  item_id: string | null
  quantity: number | null
  created_at: string | null
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------
class BmpoService {
  /**
   * Computa o balanço de psicoativos no período informado.
   * @param dataInicio  data inicial inclusiva (YYYY-MM-DD)
   * @param dataFim     data final inclusiva (YYYY-MM-DD)
   */
  async computeBalanco(dataInicio: string, dataFim: string): Promise<BalancoRow[]> {
    // Fuso -03:00: sem fuso o banco entende UTC e o corte do dia andava 3h
    // (saida das 21h-23h59 do ultimo dia ficava de fora; a do dia anterior entrava).
    const inicioTs = inicioDiaISO(dataInicio)
    const fimTs = fimDiaISO(dataFim)
    const inicioMs = new Date(inicioTs).getTime()

    // 1) Itens controlados da farmácia (medication_class === 'controlados')
    const { data: itemsData, error: itemsErr } = await supabase
      .from('pharmacy_items')
      .select('id, name, controlled_subclass')
      .eq('medication_class', 'controlados')
      .order('name')
      .limit(2000)
    if (itemsErr) throw itemsErr

    const items = (itemsData || []) as ControlledItem[]
    if (items.length === 0) return []

    const itemIds = items.map((i) => i.id)

    // Acumuladores por item
    const estoqueAnterior = new Map<string, number>()
    const entradas = new Map<string, number>()
    const saidas = new Map<string, number>()
    const perdas = new Map<string, number>()

    // 2) Movimentações até o FIM do período (uma só leitura),
    //    separando as anteriores ao início (estoque anterior) das do período.
    //    Paginado (o .limit(100000) antigo parava em 1000, sem ordem).
    //    Movimentos INTERNOS da farmacia ficam de fora: a reposicao CAF ->
    //    satelite (SOLICITACAO) e a transferencia entre estoques internos
    //    geram um par saida+entrada do mesmo produto dentro do hospital; o
    //    BMPO e o balanco do estabelecimento, e o par inflava entradas e
    //    saidas (saldo igual, colunas erradas).
    const movData = await buscarTodas<MovementRow & { id: string }>((de, ate) =>
      supabase
        .from('stock_movements')
        .select('id, item_id, direction, quantity, performed_at, movement_type, destino_tipo')
        .in('item_id', itemIds)
        .eq('item_type', 'pharmacy')
        .lte('performed_at', fimTs)
        .neq('movement_type', 'SOLICITACAO')
        .or('movement_type.neq.TRANSFERENCIA,destino_tipo.is.null,destino_tipo.neq.estoque_interno')
        .order('performed_at', { ascending: true })
        .order('id', { ascending: true })
        .range(de, ate) as unknown as PromiseLike<{ data: (MovementRow & { id: string })[] | null; error: unknown }>
    )

    for (const m of movData) {
      if (!m.item_id) continue
      const qty = Number(m.quantity ?? 0)
      if (!qty) continue
      const isAntes = m.performed_at != null && new Date(m.performed_at).getTime() < inicioMs

      if (isAntes) {
        // estoque anterior = entradas - saídas antes do período
        const signed = m.direction === 'in' ? qty : -qty
        estoqueAnterior.set(m.item_id, (estoqueAnterior.get(m.item_id) ?? 0) + signed)
      } else {
        // dentro do período
        if (m.direction === 'in') {
          entradas.set(m.item_id, (entradas.get(m.item_id) ?? 0) + qty)
        } else {
          saidas.set(m.item_id, (saidas.get(m.item_id) ?? 0) + qty)
        }
      }
    }

    // 3) Perdas controladas no período (medication_losses)
    const lossData = await buscarTodas<LossRow & { id: string }>((de, ate) =>
      supabase
        .from('medication_losses')
        .select('id, item_id, quantity, created_at')
        .eq('is_controlado', true)
        .gte('created_at', inicioTs)
        .lte('created_at', fimTs)
        .order('id')
        .range(de, ate) as unknown as PromiseLike<{ data: (LossRow & { id: string })[] | null; error: unknown }>
    )

    for (const l of lossData) {
      if (!l.item_id) continue
      const qty = Number(l.quantity ?? 0)
      if (!qty) continue
      perdas.set(l.item_id, (perdas.get(l.item_id) ?? 0) + qty)
    }

    // 4) Monta as linhas do balanço
    const rows: BalancoRow[] = items.map((it) => {
      const ant = estoqueAnterior.get(it.id) ?? 0
      const ent = entradas.get(it.id) ?? 0
      const sai = saidas.get(it.id) ?? 0
      const per = perdas.get(it.id) ?? 0
      return {
        item_id: it.id,
        item_nome: it.name,
        lista: it.controlled_subclass ?? '—',
        estoque_anterior: ant,
        entradas: ent,
        saidas: sai,
        perdas: per,
        saldo_final: ant + ent - sai - per,
      }
    })

    return rows
  }

  /** Lista os balanços já salvos (snapshots), mais recentes primeiro. */
  async getSaved(): Promise<BmpoBalanco[]> {
    const { data, error } = await supabase
      .from('bmpo_balancos')
      .select('*')
      .order('gerado_em', { ascending: false })
    if (error) throw error
    return (data || []) as BmpoBalanco[]
  }

  /** Salva (fecha) o snapshot de um balanço computado. */
  async saveBalanco(payload: SaveBalancoPayload): Promise<BmpoBalanco> {
    const { data, error } = await supabase
      .from('bmpo_balancos')
      .insert({
        tipo: payload.tipo,
        ano: payload.ano,
        trimestre: payload.trimestre,
        lista: payload.lista,
        data_inicio: payload.data_inicio,
        data_fim: payload.data_fim,
        status: 'fechado',
        dados: payload.dados,
        observacao: payload.observacao ?? null,
      })
      .select('*')
      .single()
    if (error) throw error
    return data as BmpoBalanco
  }
}

export const bmpoService = new BmpoService()
