import { validateUUID, sanitizeInput } from '../utils/sanitize'
import { supabase } from '../supabase'
import { buscarTodas } from '../utils/seguro'

export type RequestStatus =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'processing'
  | 'delivered'
  | 'completed'
  | 'cancelled'

type Priority = 'low' | 'medium' | 'high'
export type RequestType = 'pharmacy' | 'warehouse'

/**
 * Filtro das listas de solicitacoes. Tudo e filtrado NO BANCO: antes a lista
 * trazia so os 100 pedidos mais recentes de qualquer tipo/status e filtrava
 * no navegador — pedido mais antigo que os 100 ultimos sumia das telas.
 */
export interface FiltroSolicitacoes {
  type?: RequestType
  statuses?: RequestStatus[]
  /** created_at >= desde */
  desde?: Date | null
  /** created_at <= ate (null = sem limite: pedido novo sempre aparece) */
  ate?: Date | null
  requesterId?: string
  /** Pedidos que saem deste estoque (quem atende: CAF ou satélite). */
  sourceLocationId?: string
}

/** Mensagem quando o pedido mudou entre abrir a tela e clicar. */
export const MSG_PEDIDO_ALTERADO = 'Este pedido já foi alterado por outra pessoa. Recarregue a página para ver a situação atual.'

// Sem cache: o cache de 5 min escondia pedidos novos e mostrava status velho.

export interface Request {
  id: string
  type: RequestType
  status: RequestStatus
  priority: Priority
  department: string
  department_id?: string
  destination_department?: string
  destination_department_id?: string
  justification?: string
  notes?: string
  request_number?: string
  requester_id: string
  source_location_id?: string | null
  target_location_id?: string | null
  created_at: string
  updated_at: string
  approved_at?: string
  approved_by?: string
  rejected_at?: string
  rejected_by?: string
  rejection_reason?: string
  completed_at?: string
  completed_by?: string
  cancelled_at?: string
  cancelled_by?: string
  cancellation_reason?: string
  delivered_at?: string
  delivered_by?: string
  received_at?: string
  received_by?: string
  delivery_notes?: string
  receipt_notes?: string
  requester?: {
    full_name: string
    department: string
  }
  request_items: Array<{
    id: string
    item: {
      id: string
      name: string
      code: string
      category: string
      unit?: string
      current_stock?: number
    }
    quantity: number
    approved_quantity?: number
    supplied_quantity?: number
    observation?: string
    is_checked?: boolean
    status: 'available' | 'low_stock'
  }>
  comments: Array<{
    id: string
    user: string
    text: string
    created_at: string
  }>
  status_history?: Array<{
    id: string
    old_status: RequestStatus | null
    new_status: RequestStatus
    changed_by: string
    changed_at: string
    reason?: string
  }>
}

class RequestService {
  private static instance: RequestService

  private constructor() {}

  static getInstance(): RequestService {
    if (!RequestService.instance) {
      RequestService.instance = new RequestService()
    }
    return RequestService.instance
  }

  // Add rate limiting for requests
  private static lastRequestTime = 0;
  private static readonly REQUEST_INTERVAL = 1000; // 1 second between requests
  
  private async checkRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastRequest = now - RequestService.lastRequestTime;
    
    if (timeSinceLastRequest < RequestService.REQUEST_INTERVAL) {
      await new Promise(resolve => 
        setTimeout(resolve, RequestService.REQUEST_INTERVAL - timeSinceLastRequest)
      );
    }
    
    RequestService.lastRequestTime = Date.now();
  }

  /** Mantido por compatibilidade: nao ha mais cache. */
  clearCache(): void {
    /* sem cache */
  }

  /**
   * Update de status que so vale se o pedido AINDA estiver num dos status
   * esperados. 0 linhas = alguem mudou antes (ou sem permissao): erro claro,
   * nunca "sucesso" silencioso.
   */
  private async atualizarStatus(
    id: string,
    esperados: RequestStatus[],
    valores: Record<string, unknown>,
  ): Promise<void> {
    const { data, error } = await supabase
      .from('requests')
      .update(valores)
      .eq('id', id)
      .in('status', esperados)
      .select('id')
    if (error) throw new Error(error.message)
    if (!data || data.length === 0) {
      const { data: atual } = await supabase.from('requests').select('status').eq('id', id).maybeSingle()
      if (atual && !esperados.includes(atual.status as RequestStatus)) throw new Error(MSG_PEDIDO_ALTERADO)
      throw new Error('Não foi possível alterar a solicitação: sem permissão ou solicitação não encontrada.')
    }
  }

  /**
   * Lista solicitacoes filtrando tipo/status/periodo/solicitante no banco e
   * paginando (buscarTodas passa do teto de 1000 linhas do PostgREST).
   * Erro vira excecao — a tela mostra "nao foi possivel carregar", nunca
   * "nenhuma solicitacao".
   */
  async getAll(filtro: FiltroSolicitacoes = {}): Promise<Request[]> {
    try {
      const montar = (de: number, ate: number) => {
        let q = supabase
        .from('requests')
        .select(`
          *,
          requester:users!requests_requester_id_fkey(
            full_name
          ),
          department:departments!requests_department_id_fkey(
            id,
            name
          ),
          destination_dept:departments!requests_destination_department_id_fkey(
            id,
            name
          ),
          approved_by_user:users!requests_approved_by_fkey(
            full_name
          ),
          delivered_by_user:users!requests_delivered_by_fkey(
            full_name
          ),
          request_items(
            id,
            item_type,
            pharmacy_item:pharmacy_items(
              id,
              name,
              code,
              category,
              unit,
              current_stock
            ),
            warehouse_item:warehouse_items(
              id,
              name,
              code,
              category,
              unit,
              current_stock
            ),
            quantity,
            approved_quantity,
            supplied_quantity,
            almox_batch_number,
            almox_expiry_date,
            observation,
            is_checked
          ),
          request_comments(
            id,
            text,
            created_at,
            user:users(
              full_name
            )
          ),
          request_status_history(
            id,
            old_status,
            new_status,
            changed_at,
            reason,
            changed_by_user:users(
              full_name
            )
          )
        `)
        if (filtro.type) q = q.eq('type', filtro.type)
        if (filtro.statuses && filtro.statuses.length > 0) q = q.in('status', filtro.statuses)
        if (filtro.desde) q = q.gte('created_at', filtro.desde.toISOString())
        if (filtro.ate) q = q.lte('created_at', filtro.ate.toISOString())
        if (filtro.requesterId) q = q.eq('requester_id', filtro.requesterId)
        if (filtro.sourceLocationId) q = q.eq('source_location_id', filtro.sourceLocationId)
        return q
          .order('created_at', { ascending: false })
          .order('id', { ascending: true })
          .range(de, ate)
      }
      const requests = await buscarTodas<any>(montar, { tamanho: 500 })

      const processedRequests = (requests || [])
        .filter(request => request && request.id && typeof request === 'object')
        .map(request => {
          try {
            return {
              ...request,
              requester: {
                full_name: sanitizeInput(request.requester?.full_name || 'Usuário Desconhecido'),
                department: sanitizeInput(request.department?.name || 'Departamento Desconhecido')
              },
              department: sanitizeInput(request.department?.name || 'Departamento Desconhecido'),
              destination_department: request.destination_dept?.name ? sanitizeInput(request.destination_dept.name) : undefined,
              request_items: (request.request_items || [])
                .filter((item: any) => item && typeof item === 'object')
                .map((item: any) => {
                  // Validate item data
                  if (!item || typeof item !== 'object' || !item.id || typeof item.quantity !== 'number') {
                    return null
                  }
                  
                  try {
                    const sourceItem = item.item_type === 'pharmacy' ? item.pharmacy_item : item.warehouse_item

                    if (!sourceItem) {
                      console.warn('No source item found for request item:', item.id)
                      return null
                    }

                    return {
                      id: item.id,
                      quantity: typeof item.quantity !== 'number' ? 0 : Math.max(0, Math.floor(item.quantity)),
                      approved_quantity: item.approved_quantity,
                      supplied_quantity: item.supplied_quantity,
                      almox_batch_number: item.almox_batch_number,
                      almox_expiry_date: item.almox_expiry_date,
                      observation: item.observation,
                      is_checked: item.is_checked || false,
                      status: 'available' as const,
                      item: {
                        id: sourceItem.id || '',
                        name: sanitizeInput(sourceItem.name || 'Item Desconhecido'),
                        code: sanitizeInput(sourceItem.code || ''),
                        category: sanitizeInput(sourceItem.category || ''),
                        unit: sourceItem.unit || 'UN',
                        current_stock: sourceItem.current_stock || 0
                      }
                    }
                  } catch (itemError) {
                    console.error('Error processing request item:', itemError)
                    return null
                  }
                }).filter(Boolean), // Remove null items
              comments: (request.request_comments || [])
                .filter((comment: any) => comment && typeof comment === 'object')
                .map((comment: any) => ({
                id: comment.id,
                user: sanitizeInput(comment.user?.full_name || ''),
                text: sanitizeInput(comment.text || ''),
                created_at: comment.created_at
              })).filter((comment: any) => comment.id), // Remove invalid comments
              status_history: (request.request_status_history || [])
                .filter((history: any) => history && typeof history === 'object')
                .map((history: any) => ({
                id: history.id,
                old_status: history.old_status as RequestStatus | null,
                new_status: history.new_status as RequestStatus,
                changed_by: sanitizeInput(history.changed_by_user?.full_name || ''),
                changed_at: history.changed_at,
                reason: sanitizeInput(history.reason || '')
                })).filter((history: any) => history.id) // Remove invalid history entries
            }
          } catch (itemError) {
            console.error('Error processing request item:', itemError)
            return null
          }
        })
        .filter(request => request) as Request[] // Remove failed processing results

      return processedRequests
    } catch (error) {
      console.error('Error fetching requests:', error)
      const msg = (error as any)?.message ? `: ${(error as any).message}` : ''
      throw new Error(`Não foi possível carregar as solicitações${msg}`)
    }
  }

  async getRecentByDepartment(departmentId: string, limit = 10): Promise<{ id: string; request_number: number; type: string; status: RequestStatus; priority: string; created_at: string; requester_name: string; items: { name: string; quantity: number }[] }[]> {
    try {
      if (!departmentId) return []

      const { data, error } = await supabase
        .from('requests')
        .select(`
          id,
          request_number,
          type,
          status,
          priority,
          created_at,
          requester:users!requests_requester_id_fkey(full_name),
          request_items(
            quantity,
            item_type,
            pharmacy_item:pharmacy_items(name),
            warehouse_item:warehouse_items(name)
          )
        `)
        .eq('department_id', departmentId)
        .in('status', ['pending', 'approved', 'processing'])
        .order('created_at', { ascending: false })
        .limit(limit)

      if (error) {
        console.error('Error fetching department requests:', error)
        return []
      }

      return (data || []).map((r: any) => ({
        id: r.id,
        request_number: r.request_number,
        type: r.type,
        status: r.status,
        priority: r.priority,
        created_at: r.created_at,
        requester_name: r.requester?.full_name || 'Desconhecido',
        items: (r.request_items || []).map((i: any) => {
          const src = i.item_type === 'pharmacy' ? i.pharmacy_item : i.warehouse_item
          return { name: src?.name || 'Item', quantity: i.quantity }
        }),
      }))
    } catch (error) {
      console.error('Error fetching department requests:', error)
      return []
    }
  }

  async getById(id: string): Promise<Request> {
    try {
      // Validate UUID format
      if (!validateUUID(id)) {
        throw new Error('Invalid request ID format')
      }

      const { data: request, error } = await supabase
        .from('requests')
        .select(`
          *,
          requester:users!requests_requester_id_fkey(
            full_name
          ),
          department:departments!requests_department_id_fkey(
            id,
            name
          ),
          destination_dept:departments!requests_destination_department_id_fkey(
            id,
            name
          ),
          approved_by_user:users!requests_approved_by_fkey(
            full_name
          ),
          delivered_by_user:users!requests_delivered_by_fkey(
            full_name
          ),
          request_items(
            id,
            item_type,
            pharmacy_item:pharmacy_items(
              id,
              name,
              code,
              category,
              unit,
              current_stock
            ),
            warehouse_item:warehouse_items(
              id,
              name,
              code,
              category,
              unit,
              current_stock
            ),
            quantity,
            approved_quantity,
            supplied_quantity,
            almox_batch_number,
            almox_expiry_date,
            observation,
            is_checked
          ),
          request_comments(
            id,
            text,
            created_at,
            user:users(
              full_name
            )
          ),
          request_status_history(
            id,
            old_status,
            new_status,
            changed_at,
            reason,
            changed_by_user:users(
              full_name
            )
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      if (!request) throw new Error('Request not found')

      const processedRequest = {
        ...request,
        requester: {
          full_name: sanitizeInput(request.requester?.full_name || 'Unknown'),
          department: sanitizeInput(request.department?.name || 'Unknown')
        },
        department: sanitizeInput(request.department?.name || 'Unknown'),
        destination_department: request.destination_dept?.name ? sanitizeInput(request.destination_dept.name) : undefined,
        request_items: request.request_items.map((item: any) => {
          const source = item.item_type === 'pharmacy' ? item.pharmacy_item : item.warehouse_item
          return {
            id: item.id,
            quantity: item.quantity,
            approved_quantity: item.approved_quantity,
            supplied_quantity: item.supplied_quantity,
            // Lote/validade informados pelo almoxarifado ao atender. Precisam
            // atravessar este map: sem eles o campo na tela nasce vazio e um
            // blur acidental gravaria null por cima do que ja estava salvo.
            almox_batch_number: item.almox_batch_number,
            almox_expiry_date: item.almox_expiry_date,
            observation: item.observation,
            is_checked: item.is_checked || false,
            status: 'available' as const,
            item: {
              id: source?.id || '',
              name: sanitizeInput(source?.name || 'Unknown Item'),
              code: sanitizeInput(source?.code || ''),
              category: sanitizeInput(source?.category || ''),
              unit: source?.unit || 'UN',
              current_stock: source?.current_stock || 0
            }
          }
        }),
        comments: request.request_comments.map((comment: any) => ({
          id: comment.id,
          user: sanitizeInput(comment.user?.full_name || 'Unknown User'),
          text: sanitizeInput(comment.text),
          created_at: comment.created_at
        })),
        status_history: request.request_status_history?.map((history: any) => ({
          id: history.id,
          old_status: history.old_status as RequestStatus | null,
          new_status: history.new_status as RequestStatus,
          changed_by: sanitizeInput(history.changed_by_user?.full_name || 'Unknown User'),
          changed_at: history.changed_at,
          reason: sanitizeInput(history.reason || '')
        }))
      }

      return processedRequest
    } catch (error) {
      console.error('Error fetching request:', error)
      throw error
    }
  }

  /**
   * Cria a solicitacao numa transacao so (RPC criar_solicitacao): cabecalho e
   * itens juntos. Antes eram duas gravacoes — se a dos itens falhasse ficava
   * um pedido vazio na fila. `chave` (uuid gerado uma vez por formulario)
   * impede pedido duplicado por duplo clique/reenvio.
   */
  async create(data: {
    type: RequestType
    priority: Priority
    department: string
    destination_department?: string
    justification?: string
    notes?: string
    created_by: string
    /**
     * Local de origem do estoque. Se omitido, eh deduzido do departamento
     * do solicitante via departments.default_pharmacy_location_id (ou _warehouse).
     */
    source_location_id?: string | null
    chave?: string
    items: Array<{
      item_id: string
      quantity: number
    }>
  }): Promise<Request> {
    try {
      // Input validation
      if (!data.type || !['pharmacy', 'warehouse'].includes(data.type)) {
        throw new Error('Tipo de solicitação inválido')
      }

      if (!data.priority || !['low', 'medium', 'high'].includes(data.priority)) {
        throw new Error('Prioridade inválida')
      }

      if (!data.department || sanitizeInput(data.department).trim() === '') {
        throw new Error('Departamento é obrigatório')
      }

      if (!data.created_by || !validateUUID(data.created_by)) {
        throw new Error('Usuário criador é obrigatório')
      }

      if (!data.items || data.items.length === 0) {
        throw new Error('Pelo menos um item deve ser solicitado')
      }

      if (data.items.length > 50) {
        throw new Error('Máximo de 50 itens por solicitação')
      }

      for (const item of data.items) {
        if (!item || typeof item !== 'object' || !item.item_id || !validateUUID(item.item_id)) {
          throw new Error('Item inválido na solicitação')
        }
        if (!Number.isInteger(item.quantity) || item.quantity <= 0 || item.quantity > 10000) {
          throw new Error('Quantidade deve ser um número inteiro de 1 a 10000')
        }
      }

      const { data: r, error } = await supabase.rpc('criar_solicitacao', {
        p_type: data.type,
        p_priority: data.priority,
        p_department_id: data.department,
        p_items: data.items.map((i) => ({ item_id: i.item_id, quantity: i.quantity })),
        p_destination_department_id: data.destination_department || null,
        p_justification: sanitizeInput(data.justification || ''),
        p_notes: data.notes ? sanitizeInput(data.notes) : null,
        p_source_location_id: data.source_location_id ?? null,
        p_chave: data.chave ?? null,
      })
      if (error) throw new Error(error.message)
      const requestId = (r as { request_id?: string } | null)?.request_id
      if (!requestId) throw new Error('O banco não devolveu a solicitação criada.')

      return this.getById(requestId)
    } catch (error) {
      console.error('Error creating request:', error)
      throw error
    }
  }

  /**
   * Aprovar.
   * - Farmacia: RPC atender_solicitacao_farmacia (uma transacao): grava o
   *   fornecido de cada item, confere lotes x fornecido e marca como entregue.
   *   O solicitante confirma o recebimento depois (ai o estoque se move).
   *   `itemQuantities` = quantidade FORNECIDA por item.
   * - Almoxarifado: so passa para 'approved' (se ainda estiver pendente) e
   *   registra a quantidade aprovada. A baixa acontece ao entregar.
   */
  async approve(
    id: string,
    itemQuantities: Record<string, number>,
    comments?: string
  ): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('Invalid request ID format')
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('Usuário não autenticado')

      for (const [itemId, quantity] of Object.entries(itemQuantities)) {
        if (!validateUUID(itemId)) {
          throw new Error('Item inválido na solicitação')
        }
        if (!Number.isInteger(quantity) || quantity < 0 || quantity > 10000) {
          throw new Error('Quantidade inválida: use número inteiro de 0 a 10000')
        }
      }

      const { data: atual, error: atualErr } = await supabase
        .from('requests').select('type, status').eq('id', id).maybeSingle()
      if (atualErr) throw new Error(atualErr.message)
      if (!atual) throw new Error('Solicitação não encontrada')
      if (atual.status !== 'pending') throw new Error(MSG_PEDIDO_ALTERADO)

      if (atual.type === 'pharmacy') {
        const { error } = await supabase.rpc('atender_solicitacao_farmacia', {
          p_request_id: id,
          p_itens: Object.entries(itemQuantities).map(([request_item_id, q]) => ({
            request_item_id, supplied_quantity: q,
          })),
          p_notes: comments ? sanitizeInput(comments) : null,
        })
        if (error) throw new Error(error.message)
      } else {
        await this.atualizarStatus(id, ['pending'], {
          status: 'approved',
          approved_at: new Date().toISOString(),
          approved_by: user.id,
        })
        // Quantidade aprovada e so referencia (a baixa usa o FORNECIDO).
        for (const [itemId, approvedQuantity] of Object.entries(itemQuantities)) {
          const { error: itemError } = await supabase
            .from('request_items')
            .update({ approved_quantity: approvedQuantity })
            .eq('id', itemId)
            .eq('request_id', id)
          if (itemError) throw new Error(itemError.message)
        }
      }

      if (comments) {
        try {
          await this.addComment(id, sanitizeInput(comments))
        } catch (commentErr) {
          console.warn('Comment failed but approval was successful:', commentErr)
        }
      }

      return this.getById(id)
    } catch (error) {
      console.error('Error approving request:', error)
      throw error
    }
  }

  async reject(id: string, reason: string): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('ID da solicitação inválido')
      }

      if (!reason || sanitizeInput(reason).trim().length === 0) {
        throw new Error('Motivo da rejeição é obrigatório')
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error('Erro de autenticação: ' + authError.message)
      if (!user) throw new Error('Usuário não autenticado')

      await this.atualizarStatus(id, ['pending'], {
        status: 'rejected',
        rejected_at: new Date().toISOString(),
        rejected_by: user.id,
        rejection_reason: sanitizeInput(reason)
      })

      // Add comment (non-blocking)
      try {
        await this.addComment(id, `Solicitação rejeitada: ${sanitizeInput(reason)}`)
      } catch (commentErr) {
        console.warn('Comment failed but rejection was successful:', commentErr)
      }

      return this.getById(id)
    } catch (error) {
      console.error('Error rejecting request:', error)
      throw error
    }
  }

  async startProcessing(id: string): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('ID da solicitação inválido')
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error('Erro de autenticação: ' + authError.message)
      if (!user) throw new Error('Usuário não autenticado')

      await this.atualizarStatus(id, ['approved'], { status: 'processing' })

      try {
        await this.addComment(id, 'Iniciado o processamento da solicitação')
      } catch (commentErr) {
        console.warn('Comment failed but processing started:', commentErr)
      }

      return this.getById(id)
    } catch (error) {
      console.error('Error starting request processing:', error)
      throw error
    }
  }

  /**
   * Entrega do ALMOXARIFADO: fecha o pedido direto ('completed'). A baixa do
   * estoque e feita no banco (gatilho) pela quantidade FORNECIDA de cada item
   * — fornecido vazio ou saldo insuficiente fazem o banco recusar, com a
   * mensagem do item. Farmacia nao passa por aqui (entrega = Aprovar).
   */
  async markAsDelivered(id: string, deliveryNotes?: string, receivedByEmployeeId?: string): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('ID da solicitação inválido')
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error('Erro de autenticação: ' + authError.message)
      if (!user) throw new Error('Usuário não autenticado')

      const { data: atual, error: atualErr } = await supabase
        .from('requests').select('type').eq('id', id).maybeSingle()
      if (atualErr) throw new Error(atualErr.message)
      if (!atual) throw new Error('Solicitação não encontrada')
      if (atual.type === 'pharmacy') {
        throw new Error('Solicitação da farmácia é entregue pelo botão Aprovar.')
      }

      const now = new Date().toISOString()
      const updateData: Record<string, any> = {
        status: 'completed',
        delivered_at: now,
        delivered_by: user.id,
        completed_at: now,
        completed_by: user.id,
      }
      if (deliveryNotes) updateData.delivery_notes = sanitizeInput(deliveryNotes)
      if (receivedByEmployeeId) updateData.received_by_employee_id = receivedByEmployeeId

      await this.atualizarStatus(id, ['approved', 'processing'], updateData)

      // Add comment (non-blocking)
      try {
        const message = deliveryNotes
          ? `Itens entregues. Obs: ${sanitizeInput(deliveryNotes)}`
          : 'Itens entregues.'
        await this.addComment(id, message)
      } catch (commentErr) {
        console.warn('Comment failed but delivery was successful:', commentErr)
      }

      return this.getById(id)
    } catch (error) {
      console.error('Error marking request as delivered:', error)
      throw error
    }
  }

  async confirmReceipt(id: string, receiptNotes?: string): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('ID da solicitação inválido')
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error('Erro de autenticação: ' + authError.message)
      if (!user) throw new Error('Usuário não autenticado')

      // Confirma o recebimento via RPC atômica: para solicitações de FARMÁCIA gera
      // os movimentos de estoque pelo ledger (saída no CAF + entrada no estoque do
      // satélite solicitante, quando for o caso); para ALMOXARIFADO apenas conclui
      // (a baixa já ocorreu na entrega). Registra received_by/completed_by.
      // O banco confere quem pode confirmar e se os lotes batem com o fornecido.
      const { error } = await supabase.rpc('confirmar_recebimento_solicitacao', {
        p_request_id: id,
        p_notes: receiptNotes ? sanitizeInput(receiptNotes) : null,
      })

      if (error) throw new Error(error.message)

      const message = receiptNotes
        ? `Recebimento confirmado. Observações: ${sanitizeInput(receiptNotes)}`
        : 'Recebimento confirmado.'

      try {
        await this.addComment(id, message)
      } catch (commentErr) {
        console.warn('Comment failed but receipt confirmed:', commentErr)
      }

      return this.getById(id)
    } catch (error) {
      console.error('Error confirming receipt:', error)
      throw error
    }
  }

  /**
   * "Concluir" da tela Em Processamento (almoxarifado): mesma entrega do
   * markAsDelivered, sem recebedor. So vale para pedido aprovado/em
   * processamento; a baixa e conferida no banco.
   */
  async complete(id: string, comments?: string): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('Invalid request ID format')
      }
      return await this.markAsDelivered(id, comments)
    } catch (error) {
      console.error('Error completing request:', error)
      throw error
    }
  }

  /**
   * Cancelar: o solicitante so cancela pedido PENDENTE (regra da policy);
   * quem atende cancela pendente ou aprovado.
   */
  async cancel(id: string, reason: string, statusPermitidos: RequestStatus[] = ['pending', 'approved']): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('ID da solicitação inválido')
      }

      if (!reason || sanitizeInput(reason).trim().length === 0) {
        throw new Error('Motivo do cancelamento é obrigatório')
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error('Erro de autenticação: ' + authError.message)
      if (!user) throw new Error('Usuário não autenticado')

      await this.atualizarStatus(id, statusPermitidos, {
        status: 'cancelled',
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
        cancellation_reason: sanitizeInput(reason)
      })

      try {
        await this.addComment(id, `Solicitação cancelada: ${sanitizeInput(reason)}`)
      } catch (commentErr) {
        console.warn('Comment failed but cancel was successful:', commentErr)
      }

      return this.getById(id)
    } catch (error) {
      console.error('Error cancelling request:', error)
      throw error
    }
  }

  async addComment(
    requestId: string,
    text: string,
    userId?: string
  ): Promise<Request> {
    try {
      if (!validateUUID(requestId)) {
        throw new Error('Invalid request ID format')
      }

      if (!text || sanitizeInput(text).trim().length === 0) {
        throw new Error('Comentário não pode estar vazio')
      }

      if (text.length > 1000) {
        throw new Error('Comentário muito longo (máximo 1000 caracteres)')
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user && !userId) throw new Error('User not authenticated')

      const commenterId = userId || user!.id
      
      if (!validateUUID(commenterId)) {
        throw new Error('Invalid user ID format')
      }

      await this.checkRateLimit()
      

      // Get the request to access owner information
      const request = await this.getById(requestId)
      if (!request) throw new Error('Request not found')

      const { error } = await supabase
        .from('request_comments')
        .insert({
          request_id: requestId,
          user_id: commenterId,
          text: sanitizeInput(text)
        })
        .select()

      if (error) throw error

      return this.getById(requestId)
    } catch (error) {
      console.error('Error adding comment:', error)
      throw error
    }
  }
}

export const requestService = RequestService.getInstance()