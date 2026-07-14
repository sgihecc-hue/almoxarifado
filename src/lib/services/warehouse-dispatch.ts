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
      return []
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

  async create(data: CreateWarehouseDispatchData): Promise<{ id: string }> {
    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user) throw new Error('Usuário não autenticado')

    if (!data.items || data.items.length === 0) {
      throw new Error('Adicione pelo menos um item')
    }

    if (!data.destination_department_id && !data.destination_department_text?.trim()) {
      throw new Error('Informe o destino')
    }

    const { data: dispatch, error: dispatchError } = await supabase
      .from('warehouse_dispatches')
      .insert({
        destination_department_id: data.destination_department_id || null,
        destination_department_text: data.destination_department_text?.trim() || null,
        dispatch_type: data.dispatch_type || 'consumo',
        notes: data.notes?.trim() || null,
        created_by: authData.user.id,
      })
      .select('id')
      .single()

    if (dispatchError) {
      console.error('Error creating warehouse dispatch:', dispatchError)
      throw new Error(dispatchError.message)
    }
    if (!dispatch) throw new Error('Falha ao criar saída')

    const itemsToInsert = data.items.map((it) => ({
      dispatch_id: dispatch.id,
      item_id: it.item_id,
      quantity: it.quantity,
    }))

    const { error: itemsError } = await supabase
      .from('warehouse_dispatch_items')
      .insert(itemsToInsert)

    if (itemsError) {
      // Rollback
      await supabase.from('warehouse_dispatches').delete().eq('id', dispatch.id)
      console.error('Error inserting dispatch items:', itemsError)
      throw new Error(itemsError.message)
    }

    return { id: dispatch.id }
  }

  async cancel(id: string, reason: string): Promise<void> {
    const { data: authData } = await supabase.auth.getUser()
    if (!authData?.user) throw new Error('Usuário não autenticado')

    if (!reason || reason.trim().length < 3) {
      throw new Error('Informe um motivo (mínimo 3 caracteres) para o estorno')
    }

    const { error } = await supabase
      .from('warehouse_dispatches')
      .update({
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: authData.user.id,
        cancellation_reason: reason.trim(),
      })
      .eq('id', id)
      .eq('status', 'completed') // só permite cancelar saídas concluídas

    if (error) {
      console.error('Error cancelling warehouse dispatch:', error)
      throw new Error(error.message)
    }
  }
}

export const warehouseDispatchService = WarehouseDispatchService.getInstance()
