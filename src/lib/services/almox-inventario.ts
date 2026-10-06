// =============================================================================
// Modo Inventario do Almoxarifado (migrations 20261005120000..120200).
// Toda gravacao passa pelas RPCs almox_inventario_* (atomicas, com checagem de
// papel no banco). As tabelas so sao lidas daqui.
// =============================================================================
import { supabase } from '@/lib/supabase'
import { buscarTodas } from '@/lib/utils/seguro'

export type Bloqueio = 'todos' | 'novos'
export type NaoContados = 'manter' | 'zerar'

export interface ResumoInventario {
  numero: number
  aberto_em: string
  fechado_em: string
  bloqueio: Bloqueio
  nao_contados: NaoContados
  permite_liberacao_urgente: boolean
  itens_total: number
  itens_contados: number
  itens_nao_contados: number
  itens_nao_contados_zerados: number
  itens_sem_diferenca: number
  itens_com_sobra: number
  itens_com_falta: number
  qtd_sobra: number
  qtd_falta: number
  valor_sobra: number
  valor_falta: number
  valor_liquido: number
  valor_total_contado: number
  valor_estoque_final: number
  itens_sem_preco: number
  linhas_contagem: number
  liberacoes: number
}

export interface Inventario {
  id: string
  numero: number
  status: 'aberto' | 'fechado' | 'cancelado'
  aberto_por: string
  aberto_em: string
  fechado_por: string | null
  fechado_em: string | null
  cancelado_por: string | null
  cancelado_em: string | null
  motivo_cancelamento: string | null
  bloqueio: Bloqueio
  permite_liberacao_urgente: boolean
  nao_contados: NaoContados
  observacao: string | null
  resumo: ResumoInventario | null
}

export interface StatusInventario {
  aberto: boolean
  id?: string
  numero?: number
  desde?: string
  bloqueio?: Bloqueio
  permite_liberacao_urgente?: boolean
  mensagem?: string
}

export interface LinhaContagem {
  id: string
  item_id: string
  lote: string | null
  validade: string | null
  quantidade: number
  contado_por: string
  contado_em: string
}

/** Linha da conferencia (previa) e do resultado gravado no fechamento. */
export interface LinhaResultado {
  item_id: string
  item_nome: string | null
  item_codigo: string | null
  unidade: string | null
  contado: boolean
  quantidade_contada: number | null
  saldo_sistema_contagem: number | null
  saldo_antes: number
  diferenca: number
  saldo_depois: number
  valor_unitario: number
  valor_diferenca: number
  valor_final: number
  lotes?: { lote: string | null; validade: string | null; quantidade: number }[] | null
}

export interface PedidoParado {
  request_id: string
  request_number: number
  status: string
  priority: string | null
  created_at: string
  setor: string | null
  solicitante: string | null
  itens: number
  liberado: boolean
  liberado_por: string | null
  liberado_em: string | null
  motivo_liberacao: string | null
}

export interface ItemInventario {
  id: string
  name: string
  code: string | null
  unit: string | null
  category: string | null
  current_stock?: number | null
}

export interface InfoLotes {
  lotes: { lote: string | null; validade: string | null }[]
  referencia: number | null
  ultimaCompra: number | null
}

export interface Liberacao {
  id: string
  request_id: string
  liberado_por: string
  liberado_em: string
  motivo: string
}

function erro(e: { message?: string } | null): never {
  throw new Error(e?.message || 'Erro ao falar com o servidor.')
}

export const almoxInventarioService = {
  async status(): Promise<StatusInventario> {
    const { data, error } = await supabase.rpc('almox_inventario_status')
    if (error) erro(error)
    return (data ?? { aberto: false }) as StatusInventario
  },

  async listar(): Promise<Inventario[]> {
    const { data, error } = await supabase
      .from('almox_inventarios')
      .select('*')
      .order('aberto_em', { ascending: false })
      .limit(200)
    if (error) erro(error)
    return (data ?? []) as Inventario[]
  },

  async buscar(id: string): Promise<Inventario | null> {
    const { data, error } = await supabase.from('almox_inventarios').select('*').eq('id', id).maybeSingle()
    if (error) erro(error)
    return (data ?? null) as Inventario | null
  },

  async nomesUsuarios(ids: string[]): Promise<Record<string, string>> {
    const unicos = [...new Set(ids.filter(Boolean))]
    if (unicos.length === 0) return {}
    const { data, error } = await supabase.rpc('get_requester_names', { ids: unicos })
    if (error) return {}
    const mapa: Record<string, string> = {}
    for (const r of (data ?? []) as { id: string; full_name: string }[]) mapa[r.id] = r.full_name
    return mapa
  },

  async abrir(p: { bloqueio: Bloqueio; permiteLiberacao: boolean; naoContados: NaoContados; observacao: string }) {
    const { data, error } = await supabase.rpc('almox_inventario_abrir', {
      p_bloqueio: p.bloqueio,
      p_permite_liberacao: p.permiteLiberacao,
      p_nao_contados: p.naoContados,
      p_observacao: p.observacao.trim() || null,
    })
    if (error) erro(error)
    return data as { id: string; numero: number }
  },

  /** Todas as linhas de contagem do inventario (sem o saldo do sistema). */
  async contagens(inventarioId: string): Promise<LinhaContagem[]> {
    return buscarTodas<LinhaContagem>((de, ate) =>
      supabase
        .from('almox_inventario_contagens')
        .select('id, item_id, lote, validade, quantidade, contado_por, contado_em')
        .eq('inventario_id', inventarioId)
        .order('id')
        .range(de, ate) as any,
    )
  },

  async salvarItem(inventarioId: string, itemId: string, linhas: { quantidade: string; lote: string; validade: string }[]) {
    const { data, error } = await supabase.rpc('almox_inventario_salvar_item', {
      p_inventario: inventarioId,
      p_item: itemId,
      p_linhas: linhas.map((l) => ({
        quantidade: l.quantidade.trim(),
        lote: l.lote.trim() || null,
        validade: l.validade || null,
      })),
    })
    if (error) erro(error)
    return data as { linhas: number; total: number; contado: boolean }
  },

  /** Conferencia (gestor/admin). Pagina de 1000 em 1000: o PostgREST corta RPC tambem. */
  async previa(inventarioId: string): Promise<LinhaResultado[]> {
    return buscarTodas<LinhaResultado>((de, ate) =>
      supabase.rpc('almox_inventario_previa', { p_inventario: inventarioId }).range(de, ate) as any,
    )
  },

  /** Itens ativos do almox para a contagem. O saldo do sistema so vem para gestor/admin. */
  async itensAtivos(comSaldo: boolean): Promise<ItemInventario[]> {
    const campos = comSaldo ? 'id, name, code, unit, category, current_stock' : 'id, name, code, unit, category'
    return buscarTodas<ItemInventario>((de, ate) =>
      supabase
        .from('warehouse_items')
        .select(campos)
        .eq('is_active', true)
        .order('name')
        .order('id')
        .range(de, ate) as any,
    )
  },

  /**
   * Lotes que o sistema conhece de cada item do almox (para a lista impressa e
   * para sugerir lote/validade na contagem). Fonte: lotes do ALMOX com saldo e,
   * para item sem lote cadastrado, o lote/validade antigo gravado no proprio item.
   * Preco de referencia e ultima compra vem junto (so gestor/admin pede).
   */
  async lotesSistema(comPreco: boolean): Promise<Record<string, InfoLotes>> {
    const campos = comPreco
      ? 'id, batch_number, expiry_date, reference_price, last_purchase_price'
      : 'id, batch_number, expiry_date'
    const [itens, almox] = await Promise.all([
      buscarTodas<{ id: string; batch_number: string | null; expiry_date: string | null; reference_price?: number | null; last_purchase_price?: number | null }>((de, ate) =>
        supabase.from('warehouse_items').select(campos).eq('is_active', true).order('id').range(de, ate) as any),
      supabase.from('stock_locations').select('id').eq('code', 'ALMOX').maybeSingle(),
    ])
    const lotes = almox.data?.id
      ? await buscarTodas<{ item_id: string; batch_number: string | null; expiry_date: string | null }>((de, ate) =>
          supabase.from('expiry_tracking').select('item_id, batch_number, expiry_date')
            .eq('location_id', almox.data!.id).gt('current_quantity', 0)
            .order('expiry_date', { ascending: true, nullsFirst: false }).order('id').range(de, ate) as any)
      : []
    const mapa: Record<string, InfoLotes> = {}
    for (const i of itens) {
      mapa[i.id] = { lotes: [], referencia: i.reference_price ?? null, ultimaCompra: i.last_purchase_price ?? null }
    }
    for (const l of lotes) {
      const lote = l.batch_number === 'SEMLOTE' ? null : l.batch_number
      mapa[l.item_id]?.lotes.push({ lote, validade: l.expiry_date })
    }
    for (const i of itens) {
      if (mapa[i.id].lotes.length === 0 && (i.batch_number || i.expiry_date)) {
        mapa[i.id].lotes.push({ lote: i.batch_number, validade: i.expiry_date })
      }
    }
    return mapa
  },

  async liberacoes(inventarioId: string): Promise<Liberacao[]> {
    const { data, error } = await supabase
      .from('almox_inventario_liberacoes')
      .select('id, request_id, liberado_por, liberado_em, motivo')
      .eq('inventario_id', inventarioId)
      .order('liberado_em')
    if (error) erro(error)
    return (data ?? []) as Liberacao[]
  },

  async resultado(inventarioId: string): Promise<LinhaResultado[]> {
    return buscarTodas<LinhaResultado>((de, ate) =>
      supabase
        .from('almox_inventario_resultado')
        .select('*')
        .eq('inventario_id', inventarioId)
        .order('item_nome')
        .order('item_id')
        .range(de, ate) as any,
    )
  },

  async pedidosParados(inventarioId: string): Promise<PedidoParado[]> {
    const { data, error } = await supabase.rpc('almox_inventario_pedidos_parados', { p_inventario: inventarioId })
    if (error) erro(error)
    return (data ?? []) as PedidoParado[]
  },

  async liberarSaida(inventarioId: string, requestId: string, motivo: string) {
    const { error } = await supabase.rpc('almox_inventario_liberar_saida', {
      p_inventario: inventarioId,
      p_request_id: requestId,
      p_motivo: motivo.trim(),
    })
    if (error) erro(error)
  },

  async fechar(inventarioId: string): Promise<ResumoInventario> {
    const { data, error } = await supabase.rpc('almox_inventario_fechar', { p_inventario: inventarioId })
    if (error) erro(error)
    return data as ResumoInventario
  },

  async cancelar(inventarioId: string, motivo: string) {
    const { error } = await supabase.rpc('almox_inventario_cancelar', {
      p_inventario: inventarioId,
      p_motivo: motivo.trim(),
    })
    if (error) erro(error)
  },
}
