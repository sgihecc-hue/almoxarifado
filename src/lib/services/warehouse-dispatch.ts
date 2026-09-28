import { supabase } from '../supabase'

export type DispatchType =
  | 'consumo'
  | 'emprestimo'
  | 'doacao'
  | 'permuta'
  | 'transferencia'
  | 'vencimento'
  | 'outro'

export const DISPATCH_TYPE_LABELS: Record<DispatchType, string> = {
  consumo: 'Consumo interno',
  emprestimo: 'Empréstimo',
  doacao: 'Doação',
  permuta: 'Permuta',
  transferencia: 'Transferência',
  vencimento: 'Saída por vencimento',
  outro: 'Outro',
}

export interface WarehouseDispatchItemInput {
  item_id: string
  quantity: number
}

export interface CreateWarehouseDispatchData {
  destination_department_id?: string
  destination_department_text?: string
  dispatch_type?: DispatchType
  notes?: string
  items: WarehouseDispatchItemInput[]
}

export interface WarehouseDispatchSummary {
  id: string
  dispatch_number: number
  destination_department_id: string | null
  destination_department_text: string | null
  destination_department_name?: string | null
  dispatch_type: DispatchType
  notes: string | null
  status: 'completed' | 'cancelled'
  created_at: string
  created_by: string
  created_by_name?: string | null
  items_count?: number
  total_quantity?: number
  cancelled_at?: string | null
  cancellation_reason?: string | null
}

export interface WarehouseDispatchItemDetail {
  id: string
  item_id: string
  item_name: string
  item_code: string | null
  item_unit: string | null
  quantity: number
}

export interface WarehouseDispatchDetail extends WarehouseDispatchSummary {
  items: WarehouseDispatchItemDetail[]
}

class WarehouseDispatchService {
  private static instance: WarehouseDispatchService
  static getInstance() {
    if (!WarehouseDispatchService.instance) {
      WarehouseDispatchService.instance = new WarehouseDispatchService()
    }
    return WarehouseDispatchService.instance
  }

  async list(): Promise<WarehouseDispatchSummary[]> {
    const { data, error } = await supabase
      .from('warehouse_dispatches')
      .select(
        `id, dispatch_number, destination_department_id, destination_department_text,
         dispatch_type, notes, status, created_at, created_by,
         cancelled_at, cancellation_reason,
         departments:destination_department_id (name),
         users:created_by (full_name),
         warehouse_dispatch_items ( quantity )`
      )
      .order('created_at', { ascending: false })
      .limit(200)

    if (error) {
      console.error('Error listing warehouse dispatches:', error)
      throw new Error('Erro ao carregar as saídas diretas: ' + error.message)
    }

    return (data || []).map((row: any) => ({
      id: row.id,
      dispatch_number: row.dispatch_number,
      destination_department_id: row.destination_department_id,
      destination_department_text: row.destination_department_text,
      destination_department_name: row.departments?.name ?? null,
      dispatch_type: row.dispatch_type || 'consumo',
      notes: row.notes,
      status: row.status,
      created_at: row.created_at,
      created_by: row.created_by,
      created_by_name: row.users?.full_name ?? null,
      items_count: row.warehouse_dispatch_items?.length || 0,
      total_quantity:
        row.warehouse_dispatch_items?.reduce(
          (acc: number, it: any) => acc + (it.quantity || 0),
          0
        ) || 0,
      cancelled_at: row.cancelled_at ?? null,
      cancellation_reason: row.cancellation_reason ?? null,
    }))
  }

  async getById(id: string): Promise<WarehouseDispatchDetail | null> {
    const { data, error } = await supabase
      .from('warehouse_dispatches')
      .select(
        `id, dispatch_number, destination_department_id, destination_department_text,
         dispatch_type, notes, status, created_at, created_by,
         cancelled_at, cancellation_reason,
         departments:destination_department_id (name),
         users:created_by (full_name),
         warehouse_dispatch_items (
           id, item_id, quantity,
           warehouse_items:item_id ( name, code, unit )
         )`
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('Error loading warehouse dispatch:', error)
      throw new Error(error.message)
    }
    if (!data) return null

    const row: any = data
    const items: WarehouseDispatchItemDetail[] = (row.warehouse_dispatch_items || []).map((it: any) => ({
      id: it.id,
      item_id: it.item_id,
      item_name: it.warehouse_items?.name ?? '(item removido)',
      item_code: it.warehouse_items?.code ?? null,
      item_unit: it.warehouse_items?.unit ?? null,
      quantity: it.quantity || 0,
    }))

    return {
      id: row.id,
      dispatch_number: row.dispatch_number,
      destination_department_id: row.destination_department_id,
      destination_department_text: row.destination_department_text,
      destination_department_name: row.departments?.name ?? null,
      dispatch_type: row.dispatch_type || 'consumo',
      notes: row.notes,
      status: row.status,
      created_at: row.created_at,
      created_by: row.created_by,
      created_by_name: row.users?.full_name ?? null,
      items_count: items.length,
      total_quantity: items.reduce((acc, it) => acc + (it.quantity || 0), 0),
      cancelled_at: row.cancelled_at ?? null,
      cancellation_reason: row.cancellation_reason ?? null,
      items,
    }
  }

  /**
   * Cria a saida numa transacao no banco (RPC criar_saida_direta_almox): confere
   * papel/modulo, trava o item, recusa saldo insuficiente e baixa o estoque.
   * `chave` identifica a rodada: repetir (duplo clique/timeout) nao duplica.
   */
  async create(data: CreateWarehouseDispatchData, chave: string): Promise<{ id: string; dispatch_number: number }> {
    if (!data.items || data.items.length === 0) {
      throw new Error('Adicione pelo menos um item')
    }
    if (!data.destination_department_id && !data.destination_department_text?.trim()) {
      throw new Error('Informe o destino')
    }
    const { data: result, error } = await supabase.rpc('criar_saida_direta_almox', {
      p_itens: data.items.map((it) => ({ item_id: it.item_id, quantity: it.quantity })),
      p_destino_departamento: data.destination_department_id || null,
      p_destino_texto: data.destination_department_text?.trim() || null,
      p_tipo: data.dispatch_type || 'consumo',
      p_observacao: data.notes?.trim() || null,
      p_chave: chave,
    })
    if (error) {
      console.error('Error creating warehouse dispatch:', error)
      throw error
    }
    const r = result as { id: string; dispatch_number: number }
    return { id: r.id, dispatch_number: r.dispatch_number }
  }

  /** Estorno (so gestor/admin do almox): devolve SO o que a saida efetivamente baixou, uma unica vez. */
  async cancel(id: string, reason: string): Promise<{ quantidade_devolvida: number; linhas_sem_baixa: number }> {
    if (!reason || reason.trim().length < 3) {
      throw new Error('Informe um motivo (mínimo 3 caracteres) para o estorno')
    }
    const { data, error } = await supabase.rpc('estornar_saida_direta_almox', {
      p_id: id,
      p_motivo: reason.trim(),
    })
    if (error) {
      console.error('Error cancelling warehouse dispatch:', error)
      throw error
    }
    return data as { quantidade_devolvida: number; linhas_sem_baixa: number }
  }
}

export const warehouseDispatchService = WarehouseDispatchService.getInstance()
