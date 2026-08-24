import { validateUUID, sanitizeInput } from '../utils/sanitize'
import { supabase } from '../supabase'

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

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache duration

// Request cache to prevent duplicate requests and improve performance
const requestCache = new Map<string, { data: any; timestamp: number }>()

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

  // Add cache helper methods
  private getCachedData(key: string): any | null {
    const cached = requestCache.get(key)
    if (!cached) return null
    
    if (Date.now() - cached.timestamp > CACHE_DURATION) {
      requestCache.delete(key)
      return null
    }
    
    return cached.data
  }

  clearCache(): void {
    requestCache.clear()
  }

  private setCachedData(key: string, data: any): void {
    requestCache.set(key, { data, timestamp: Date.now() })
  }

  async getAll(): Promise<Request[]> {
    try {
      // Check cache first
      const cacheKey = 'all_requests'
      const cached = this.getCachedData(cacheKey)
      if (cached) return cached

      const { data: requests, error } = await supabase
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
        .order('created_at', { ascending: false })
        .limit(100) // Reasonable limit for better performance

      if (error) {
        console.error('Database error:', error)
        return []
      }

      if (!Array.isArray(requests)) {
        console.error('Invalid requests data format')
        return []
      }

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
        .filter(request => request) // Remove failed processing results
      
      // Cache the results
      this.setCachedData('all_requests', processedRequests)
      return processedRequests
    } catch (error) {
      console.error('Error fetching requests:', error)
      // Return empty array instead of throwing to prevent app crashes
      return []
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

      await this.checkRateLimit()
      
      // Check cache first
      const cacheKey = `request_${id}`
      const cached = this.getCachedData(cacheKey)
      if (cached) return cached

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
      
      // Cache the result
      this.setCachedData(cacheKey, processedRequest)
      return processedRequest
    } catch (error) {
      console.error('Error fetching request:', error)
      throw error
    }
  }

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
      
      // Validate items
      for (const item of data.items) {
        if (!item || typeof item !== 'object' || !item.item_id) {
          throw new Error('Item é obrigatório')
        }
        if (!validateUUID(item.item_id)) {
          throw new Error('ID do item é obrigatório')
        }
        if (typeof item.quantity !== 'number' || item.quantity <= 0) {
          throw new Error('Quantidade deve ser maior que zero')
        }
        if (item.quantity > 10000) {
          throw new Error('Quantidade deve ser maior que zero')
        }
      }

      await this.checkRateLimit()
      
      // Clear cache after creating new request
      requestCache.clear()

      // Deduz o estoque de origem a partir do departamento, se nao veio explicito.
      // Regra: departments.default_pharmacy_location_id (type='pharmacy') ou
      //        departments.default_warehouse_location_id (type='warehouse').
      let resolvedSourceLocationId: string | null = data.source_location_id ?? null
      if (!resolvedSourceLocationId && data.department) {
        const { data: dept, error: deptErr } = await supabase
          .from('departments')
          .select('default_pharmacy_location_id, default_warehouse_location_id')
          .eq('id', data.department)
          .maybeSingle()
        if (deptErr) {
          console.warn('Falha ao buscar default location do departamento:', deptErr)
        } else if (dept) {
          resolvedSourceLocationId =
            data.type === 'pharmacy'
              ? (dept.default_pharmacy_location_id as string | null) ?? null
              : (dept.default_warehouse_location_id as string | null) ?? null
        }
      }

      // First, create the request
      const insertData: any = {
        type: data.type,
        priority: data.priority,
        department_id: data.department,
        justification: sanitizeInput(data.justification || ''),
        requester_id: data.created_by,
        status: 'pending',
        source_location_id: resolvedSourceLocationId,
      }
      if (data.destination_department) {
        insertData.destination_department_id = data.destination_department
      }
      if (data.notes) {
        insertData.notes = sanitizeInput(data.notes)
      }

      const { data: request, error: requestError } = await supabase
        .from('requests')
        .insert(insertData)
        .select()
        .single()

      if (requestError) throw requestError

      // Fetch item names for the request items
      const table = data.type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
      const itemIds = data.items.map(item => item.item_id)
      const { data: itemsData } = await supabase
        .from(table)
        .select('id, name')
        .in('id', itemIds)
      const itemNamesMap = new Map((itemsData || []).map(i => [i.id, i.name]))

      // Then, create the request items
      const { error: itemsError } = await supabase
        .from('request_items')
        .insert(
          data.items.map(item => ({
            request_id: request.id,
            item_type: data.type,
            [data.type === 'pharmacy' ? 'pharmacy_item_id' : 'warehouse_item_id']: item.item_id,
            item_name: itemNamesMap.get(item.item_id) || 'Item',
            quantity: item.quantity
          }))
        )

      if (itemsError) throw itemsError

      // Return the newly created request
      return this.getById(request.id)
    } catch (error) {
      console.error('Error creating request:', error)
      throw error
    }
  }

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
      if (!user) throw new Error('User not authenticated')

      await this.checkRateLimit()
      
      // Clear cache after approval
      requestCache.clear()

      // Get the request to access item information
      const request = await this.getById(id)
      if (!request) throw new Error('Request not found')

      // Validate item quantities
      for (const [itemId, quantity] of Object.entries(itemQuantities)) {
        if (!validateUUID(itemId)) {
          throw new Error(`Invalid item ID: ${itemId}`)
        }
        if (typeof quantity !== 'number' || quantity < 0 || quantity > 10000) {
          throw new Error(`Invalid quantity for item ${itemId}`)
        }
      }

      // Aprovar tem dois comportamentos, dependendo do tipo:
      // - Farmacia: aprovar ja marca como entregue (delivered_at/by = agora).
      //   Fluxo: pending -> approve -> delivered -> confirm receipt -> completed.
      //   O solicitante confirma recebimento no fim.
      // - Almoxarifado: aprovar so seta 'approved'. Staff depois clica
      //   "Marcar como Entregue" e o pedido vai direto pra 'completed'
      //   (nao ha confirmacao de recebimento pra almox).
      const now = new Date().toISOString()
      const isPharmacy = request.type === 'pharmacy'
      const approvalUpdate = isPharmacy
        ? {
            status: 'delivered' as const,
            approved_at: now,
            approved_by: user.id,
            delivered_at: now,
            delivered_by: user.id,
          }
        : {
            status: 'approved' as const,
            approved_at: now,
            approved_by: user.id,
          }
      const { data: updatedRequest, error: requestError } = await supabase
        .from('requests')
        .update(approvalUpdate)
        .eq('id', id)
        .select()
        .single()

      if (requestError) throw requestError

      // Fetch all original request items to preserve their data
      const { data: originalItems, error: originalItemsError } = await supabase
        .from('request_items')
        .select('*')
        .eq('request_id', id)

      if (originalItemsError) throw originalItemsError
      if (!originalItems) throw new Error('Original request items not found')

      // Create a map of original items for easy lookup
      const originalItemsMap = originalItems.reduce((acc, item) => {
        acc[item.id] = item
        return acc
      }, {} as Record<string, any>)

      // Update approved_quantity de cada item. Antes usava .upsert() que
      // dispara semantica INSERT+UPDATE — e o RLS de INSERT em
      // request_items exige que o user seja o requester original, o que
      // faz o approve falhar com HTTP 400 quando quem aprova NAO eh quem
      // criou a solicitacao. UPDATE simples so passa pela policy
      // "Managers can update request items" (isso ja permite admin/gestor/
      // atendente). Nada mais precisa ser preservado — os outros campos
      // ja existem no banco.
      for (const [itemId, approvedQuantity] of Object.entries(itemQuantities)) {
        const originalItem = originalItemsMap[itemId]
        if (!originalItem) {
          throw new Error(`Request item ${itemId} not found`)
        }
        const { error: itemError } = await supabase
          .from('request_items')
          .update({ approved_quantity: approvedQuantity })
          .eq('id', itemId)
        if (itemError) throw itemError
      }

      // Add approval comment if provided
      if (comments) {
        await this.addComment(id, sanitizeInput(comments))
      }

      return this.getById(updatedRequest.id)
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

      requestCache.clear()

      const { data: updatedRequest, error } = await supabase
        .from('requests')
        .update({
          status: 'rejected',
          rejected_at: new Date().toISOString(),
          rejected_by: user.id,
          rejection_reason: sanitizeInput(reason)
        })
        .eq('id', id)
        .select('id, status')
        .maybeSingle()

      if (error) {
        console.error('reject: update error', error)
        throw new Error('Erro ao rejeitar: ' + error.message)
      }

      if (!updatedRequest) {
        throw new Error('Solicitação não encontrada ou sem permissão')
      }

      // Add comment (non-blocking)
      try {
        await this.addComment(id, `Solicitação rejeitada: ${sanitizeInput(reason)}`)
      } catch (commentErr) {
        console.warn('Comment failed but rejection was successful:', commentErr)
      }

      return this.getById(updatedRequest.id)
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

      requestCache.clear()

      const { data: updatedRequest, error } = await supabase
        .from('requests')
        .update({ status: 'processing' })
        .eq('id', id)
        .select('id, status')
        .maybeSingle()

      if (error) throw new Error('Erro ao processar: ' + error.message)
      if (!updatedRequest) throw new Error('Solicitação não encontrada ou sem permissão')

      try {
        await this.addComment(id, 'Iniciado o processamento da solicitação')
      } catch (commentErr) {
        console.warn('Comment failed but processing started:', commentErr)
      }

      return this.getById(updatedRequest.id)
    } catch (error) {
      console.error('Error starting request processing:', error)
      throw error
    }
  }

  async markAsDelivered(id: string, deliveryNotes?: string, receivedByEmployeeId?: string): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('ID da solicitação inválido')
      }

      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError) throw new Error('Erro de autenticação: ' + authError.message)
      if (!user) throw new Error('Usuário não autenticado')

      requestCache.clear()

      // Diferenca por tipo:
      // - Almoxarifado: nao ha confirmacao de recebimento — "entregue" fecha
      //   o pedido direto (status='completed').
      // - Farmacia: fica 'delivered' pra o solicitante confirmar recebimento.
      const existing = await this.getById(id)
      const isPharmacy = existing?.type === 'pharmacy'
      const now = new Date().toISOString()
      const updateData: Record<string, any> = isPharmacy
        ? {
            status: 'delivered',
            delivered_at: now,
            delivered_by: user.id,
          }
        : {
            status: 'completed',
            delivered_at: now,
            delivered_by: user.id,
            completed_at: now,
            completed_by: user.id,
          }

      if (deliveryNotes) {
        updateData.delivery_notes = sanitizeInput(deliveryNotes)
      }

      if (receivedByEmployeeId) {
        updateData.received_by_employee_id = receivedByEmployeeId
      }

      console.log('markAsDelivered: updating request', id, 'with', updateData)

      const { data: updatedRequest, error } = await supabase
        .from('requests')
        .update(updateData)
        .eq('id', id)
        .select('id, status')
        .maybeSingle()

      if (error) {
        console.error('markAsDelivered: update error', error)
        throw new Error('Erro ao atualizar: ' + error.message)
      }

      if (!updatedRequest) {
        throw new Error('Solicitação não encontrada ou sem permissão')
      }

      console.log('markAsDelivered: update OK, status =', updatedRequest.status)

      // Add comment (non-blocking)
      try {
        const message = deliveryNotes
          ? `Itens entregues. Obs: ${sanitizeInput(deliveryNotes)}`
          : 'Itens entregues.'
        await this.addComment(id, message)
      } catch (commentErr) {
        console.warn('Comment failed but delivery was successful:', commentErr)
      }

      return this.getById(updatedRequest.id)
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

      requestCache.clear()

      // Confirma o recebimento via RPC atômica: para solicitações de FARMÁCIA gera
      // os movimentos de estoque pelo ledger (saída no CAF + entrada no estoque do
      // satélite solicitante, quando for o caso); para ALMOXARIFADO apenas conclui
      // (a baixa já ocorreu na entrega). Registra received_by/completed_by.
      const { error } = await supabase.rpc('confirmar_recebimento_solicitacao', {
        p_request_id: id,
        p_notes: receiptNotes ? sanitizeInput(receiptNotes) : null,
      })

      if (error) throw new Error('Erro ao confirmar: ' + error.message)

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

  async complete(id: string, comments?: string): Promise<Request> {
    try {
      if (!validateUUID(id)) {
        throw new Error('Invalid request ID format')
      }

      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      await this.checkRateLimit()

      requestCache.clear()

      const request = await this.getById(id)
      if (!request) throw new Error('Request not found')

      const { data: updatedRequest, error } = await supabase
        .from('requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          completed_by: user.id
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      if (comments) {
        await this.addComment(id, sanitizeInput(comments))
      }

      return this.getById(updatedRequest.id)
    } catch (error) {
      console.error('Error completing request:', error)
      throw error
    }
  }

  async cancel(id: string, reason: string): Promise<Request> {
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

      requestCache.clear()

      const { data: updatedRequest, error } = await supabase
        .from('requests')
        .update({
          status: 'cancelled',
          cancelled_at: new Date().toISOString(),
          cancelled_by: user.id,
          cancellation_reason: sanitizeInput(reason)
        })
        .eq('id', id)
        .select('id, status')
        .maybeSingle()

      if (error) throw new Error('Erro ao cancelar: ' + error.message)
      if (!updatedRequest) throw new Error('Solicitação não encontrada ou sem permissão')

      try {
        await this.addComment(id, `Solicitação cancelada: ${sanitizeInput(reason)}`)
      } catch (commentErr) {
        console.warn('Comment failed but cancel was successful:', commentErr)
      }

      return this.getById(updatedRequest.id)
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
      
      // Clear cache after adding comment
      requestCache.clear()

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