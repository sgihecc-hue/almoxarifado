import { supabase } from '../supabase'
import { saveAs } from 'file-saver'
import * as XLSX from 'xlsx'

export type ItemCategory = 
  | 'Medicamentos'
  | 'Material Hospitalar'
  | 'Material de Escritório'
  | 'Material de Limpeza'
  | 'Equipamentos'
  | 'Outros'

export type UnitType = 
  | 'Un'    // Unidade
  | 'Pc'    // Peça
  | 'Cx'    // Caixa
  | 'Fr'    // Frasco
  | 'Amp'   // Ampola
  | 'Tb'    // Tubo
  | 'Rl'    // Rolo
  | 'Lt'    // Litro
  | 'Kg'    // Quilograma
  | 'Gl'    // Galão
  | 'ml'    // Mililitro
  | 'g'     // Grama
  | 'Pr'    // Par
  | 'Cj'    // Conjunto
  | 'Sc'    // Saco
  | 'Rm'    // Resma
  | 'Ct'    // Cento
  | 'FL'    // Folha

export interface Item {
  id: string
  code: string
  name: string
  description?: string
  category: ItemCategory
  unit: UnitType
  min_stock: number
  current_stock: number
  created_at: string
  updated_at: string
  price?: number
  expiry_date?: string
  invoice_number?: string
  supplier_cnpj?: string
  supplier_name?: string
  afm_number?: string
  invoice_total_value?: number
  consumption_history?: Array<{
    month: string
    quantity: number
    type?: string
  }>
  last_consumption_update?: string
  reorder_status?: 'normal' | 'reorder_point' | 'reordering' | 'critical'
  last_reorder_date?: string
  lead_time_days?: number
  is_active?: boolean
}

interface StockEntry {
  id: string
  quantity: number
  type: 'addition' | 'request'
  description: string
  created_by: string
  created_at: string
  reference_id?: string
  batch_number?: string
  expiry_date?: string
  supplier?: string
  unit_price?: number
  status?: string
  invoice_number?: string
  invoice_date?: string
  delivery_date?: string
  afm_number?: string
  supplier_cnpj?: string
  supplier_name?: string
  invoice_total_value?: number
}

interface CreateItemData {
  code: string
  name: string
  description?: string
  category: ItemCategory
  unit: UnitType
  min_stock?: number
  current_stock?: number
  price?: number
  expiry_date?: string
  invoice_number?: string
  supplier_cnpj?: string
  supplier_name?: string
  afm_number?: string
  invoice_total_value?: number
}

interface PaginationOptions {
  page?: number
  limit?: number
  offset?: number
}

interface UpdateItemData {
  name?: string
  description?: string
  category?: ItemCategory
  unit?: UnitType
  min_stock?: number
  current_stock?: number
  price?: number
  expiry_date?: string
  invoice_number?: string
  supplier_cnpj?: string
  supplier_name?: string
  afm_number?: string
  invoice_total_value?: number
  lead_time_days?: number
  is_active?: boolean
}

export interface ImportItemData {
  code: string
  name: string
  description?: string
  category: ItemCategory
  unit: UnitType
  current_stock: number
  min_stock?: number
  price?: number
}

export interface FilterOptions {
  minStock?: number
  maxStock?: number
  minPrice?: number
  maxPrice?: number
  minConsumption?: number
  maxConsumption?: number
  categories: string[]
  status: ('normal' | 'low' | 'critical')[]
  suppliers?: string[]
  expiryDateRange?: {
    start?: Date
    end?: Date
  }
  lastUpdated?: {
    start?: Date
    end?: Date
  }
  locations?: string[]
  tags?: string[]
}

// Add interface for audit history entry
export interface AuditHistoryEntry {
  id: string
  action_type: 'stock_change' | 'price_update' | 'description_edit' | 'category_change' | 'general_edit'
  old_value?: any
  new_value?: any
  user_name: string
  created_at: string
  reason?: string
}

class ItemsService {
  private static instance: ItemsService
  private static lastRequestTime = 0
  private static readonly REQUEST_INTERVAL = 1000 // 1 second between requests
  
  private constructor() {}

  public static getInstance(): ItemsService {
    if (!ItemsService.instance) {
      ItemsService.instance = new ItemsService()
    }
    return ItemsService.instance
  }

  // Add rate limiting
  private async checkRateLimit(): Promise<void> {
    const now = Date.now()
    const timeSinceLastRequest = now - ItemsService.lastRequestTime
    
    if (timeSinceLastRequest < ItemsService.REQUEST_INTERVAL) {
      await new Promise(resolve => 
        setTimeout(resolve, ItemsService.REQUEST_INTERVAL - timeSinceLastRequest)
      )
    }
    
    ItemsService.lastRequestTime = Date.now()
  }

  private getTableName(type: 'pharmacy' | 'warehouse'): string {
    return type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
  }

  async getAll(filters?: FilterOptions, pagination?: PaginationOptions) {
    try {
      await this.checkRateLimit()
      
      // Query both pharmacy and warehouse items
      const [pharmacyData, warehouseData] = await Promise.all([
        this.getAllFromTable('pharmacy_items', filters, pagination),
        this.getAllFromTable('warehouse_items', filters, pagination)
      ])

      const allItems = [...(pharmacyData || []), ...(warehouseData || [])]
      return allItems
    } catch (error) {
      console.error('Error fetching items:', error)
      return []
    }
  }

  private async getAllFromTable(table: string, filters?: FilterOptions, pagination?: PaginationOptions) {
    try {
      let query = supabase
        .from(table)
        .select('*')

      // Apply filters if provided
      if (filters) {
        if (filters.minStock !== undefined) {
          query = query.gte('current_stock', filters.minStock)
        }
        if (filters.maxStock !== undefined) {
          query = query.lte('current_stock', filters.maxStock)
        }
        if (filters.categories?.length > 0) {
          query = query.in('category', filters.categories)
        }
        if (filters.status?.length > 0) {
          const statusMap = {
            'low': 'reorder_point',
            'normal': 'normal',
            'critical': 'critical'
          }
          const mappedStatus = filters.status.map(s => statusMap[s]).filter(Boolean)
          if (mappedStatus.length > 0) {
            query = query.in('reorder_status', mappedStatus)
          }
        }
      }

      // Apply pagination
      if (pagination) {
        const limit = pagination.limit || 100
        const offset = pagination.offset || ((pagination.page || 1) - 1) * limit
        query = query.range(offset, offset + limit - 1)
      }

      const { data, error } = await query.order('name')

      if (error) {
        console.error('Database query error:', error)
        throw error
      }

      return data
    } catch (error) {
      console.error(`Error fetching items from ${table}:`, error)
      throw error
    }
  }

  async getById(id: string, type: 'pharmacy' | 'warehouse') {
    try {
      // Input validation
      if (!id || typeof id !== 'string' || id.trim() === '' || id.length > 100) {
        throw new Error('ID do item é obrigatório')
      }
      
      if (!id || typeof id !== 'string') {
        throw new Error('ID do item é obrigatório')
      }
      
      if (type !== 'pharmacy' && type !== 'warehouse') {
        throw new Error('Tipo de item inválido')
      }

      // Validate UUID format
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(id)) {
        console.warn('Invalid UUID format:', id)
        throw new Error('Formato de ID inválido')
      }

      // Rate limiting check
      await this.checkRateLimit()

      const { data, error } = await supabase
        .from(this.getTableName(type))
        .select('*')
        .eq('id', id)
        .single()

      if (error) {
        console.error('Database error:', error)
        if (error.code === 'PGRST116') {
          throw new Error('Item não encontrado')
        }
        throw new Error('Erro ao carregar item')
      }
      
      if (!data) {
        throw new Error('Item não encontrado')
      }
      
      return data as Item
    } catch (error) {
      console.error(`Error fetching item with id ${id}:`, error)
      throw error
    }
  }

  async getStockHistory(id: string, type: 'pharmacy' | 'warehouse'): Promise<StockEntry[]> {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        return []
      }
      
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(id)) {
        return []
      }

      const stockHistory: StockEntry[] = [];
      
      // Get stock additions from expiry tracking
      let expiryData: any[] | null = null
      const { data: expiryResult, error: expiryError } = await supabase
        .from('expiry_tracking')
        .select(`
          id,
          batch_number,
          expiry_date,
          initial_quantity,
          current_quantity,
          created_at,
          created_by,
          created_by_user:users!expiry_tracking_created_by_fkey(full_name),
          invoice_number,
          invoice_date,
          delivery_date,
          afm_number,
          supplier_cnpj,
          supplier_name,
          invoice_total_value
        `)
        .eq('item_id', id)
        .order('created_at', { ascending: false })

      if (expiryError) {
        if (expiryError.code === 'PGRST205' || expiryError.message?.includes('not find the table')) {
          console.warn('Table expiry_tracking does not exist yet')
        } else {
          console.error('Error fetching expiry data:', expiryError)
        }
      } else {
        expiryData = expiryResult
      }

      // Get audit logs for stock updates
      let auditLogs: any[] | null = null
      const { data: auditResult, error: auditError } = await supabase
        .from('audit_logs')
        .select(`
          id,
          action,
          old_data,
          new_data,
          changed_by,
          created_at
        `)
        .eq('table_name', this.getTableName(type))
        .eq('record_id', id)
        .order('created_at', { ascending: false })

      if (auditError) {
        if (auditError.code === 'PGRST200' || auditError.message?.includes('Could not find a relationship')) {
          console.warn('audit_logs relationship not configured yet')
        } else {
          console.error('Error fetching audit logs:', auditError)
        }
      } else {
        auditLogs = auditResult
      }

      // Get requests that include this item
      let requestItems: any[] | null = null
      const { data: requestResult, error: requestError } = await supabase
        .from('request_items')
        .select(`
          id,
          request_id,
          quantity,
          approved_quantity,
          created_at,
          requests!request_items_request_id_fkey (
            id,
            status,
            requester_id
          )
        `)
        .eq(type === 'pharmacy' ? 'pharmacy_item_id' : 'warehouse_item_id', id)
        .order('created_at', { ascending: false })

      if (requestError) {
        if (requestError.code === '42703' || requestError.message?.includes('does not exist')) {
          console.warn('Column or table issue in request_items query')
        } else {
          console.error('Error fetching requests:', requestError)
        }
      } else {
        requestItems = requestResult
      }

      // Fetch user details for requests separately to avoid ambiguous relationships
      const userIds = requestItems?.map(item => {
        if (!item.requests) return null;
        if (!item.requests) return null;
        const request = item.requests as any;
        return request.requester_id;
      }).filter(Boolean) || [];

      const { data: users, error: usersError } = await supabase
        .from('users')
        .select('id, full_name')
        .in('id', userIds)

      if (usersError) {
        console.error('Error fetching users:', usersError);
        throw usersError;
      }

      // Create a map of user IDs to names
      const userMap = new Map(users?.map(user => [user.id, user.full_name]));

      // Add expiry tracking entries to stock history
      if (expiryData) {
        expiryData.forEach(entry => {
          const createdByUser = entry.created_by_user as unknown as { full_name: string } | null;
          stockHistory.push({
            id: entry.id,
            type: 'addition',
            quantity: entry.initial_quantity,
            description: 'Adição de estoque',
            created_by: createdByUser?.full_name || 'Sistema',
            created_at: entry.created_at,
            batch_number: entry.batch_number,
            expiry_date: entry.expiry_date,
            invoice_number: entry.invoice_number || undefined,
            invoice_date: entry.invoice_date || undefined,
            delivery_date: entry.delivery_date || undefined,
            afm_number: entry.afm_number || undefined,
            supplier_cnpj: entry.supplier_cnpj || undefined,
            supplier_name: entry.supplier_name || undefined,
            invoice_total_value: entry.invoice_total_value || undefined
          });
        });
      }

      // Add audit log entries for stock updates
      if (auditLogs) {
        auditLogs.forEach(log => {
          const oldData = log.old_data as any;
          const newData = log.new_data as any;

          if (log.action === 'UPDATE' && oldData?.current_stock !== newData?.current_stock) {
            const quantity = newData?.current_stock - oldData?.current_stock;
            if (quantity !== 0 && !expiryData?.some(e => e.created_at === log.created_at)) {
              stockHistory.push({
                id: log.id,
                type: quantity > 0 ? 'addition' : 'request',
                quantity: Math.abs(quantity),
                description: quantity > 0 ? 'Ajuste de estoque (aumento)' : 'Ajuste de estoque (redução)',
                created_by: 'Sistema',
                created_at: log.created_at
              })
            }
          }
        });
      }

      // Add request entries to stock history
      if (requestItems) {
        requestItems.forEach(request => {
          if (!request.requests) return;
          const requestData = request.requests as any;
          if (requestData.status !== 'cancelled') {
            stockHistory.push({
              id: request.id,
              type: 'request',
              quantity: request.approved_quantity || request.quantity,
              description: `Solicitação #${request.request_id}`,
              created_by: userMap.get(requestData.requester_id) || 'Sistema',
              created_at: request.created_at,
              reference_id: request.request_id,
              status: requestData.status
            });
          }
        });
      }
      
      // Enhanced error handling and data validation for requests
      if (requestItems && Array.isArray(requestItems)) {
        requestItems.forEach(request => {
          try {
            if (!request || !request.requests) return;
            
            const requestData = request.requests as any;
            if (!requestData.status || requestData.status === 'cancelled') return;
            
            const quantity = request.approved_quantity || request.quantity;
            if (typeof quantity !== 'number' || quantity <= 0) return;

            const userName = userMap.get(requestData.requester_id) || 'Sistema';
            
            stockHistory.push({
              id: `${request.id}_item`,
              type: 'request',
              quantity: quantity,
              description: `Solicitação #${request.request_id}`,
              created_by: userName,
              created_at: request.created_at,
              reference_id: request.request_id,
              status: requestData.status
            });
          } catch (error) {
            console.warn('Error processing request item:', error);
          }
        });
      }

      // Sort by date (newest first)
      const uniqueHistory = stockHistory.filter((item, index, self) => 
        index === self.findIndex(t => t.id === item.id)
      );
      
      return uniqueHistory.sort((a, b) => 
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    } catch (error) {
      console.error('Error fetching stock history:', error)
      // Return empty array instead of throwing to prevent crashes
      return []
    }
  }

  async addStock(
    id: string, 
    type: 'pharmacy' | 'warehouse',
    data: {
      quantity: number
      batch_number: string
      expiry_date: string
      supplier: string
      unit_price: number
      description: string
      invoice_number?: string
      invoice_date?: string
      delivery_date?: string
      afm_number?: string
    }
  ) {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error('User not authenticated')

    // Input validation
    if (!id || typeof id !== 'string') {
      throw new Error('ID do item é obrigatório')
    }
    
    if (!data.quantity || data.quantity <= 0) {
      throw new Error('Quantidade deve ser maior que zero')
    }

    try {
      // First, call the increment_stock RPC function
      const { data: newStock, error: rpcError } = await supabase.rpc('increment_stock', {
        p_id: id,
        p_quantity: data.quantity,
        p_table: this.getTableName(type)
      })

      if (rpcError) {
        console.error('Error incrementing stock:', rpcError)
        throw rpcError
      }

      // Get the current reorder status
      const { data: reorderStatus, error: reorderError } = await supabase.rpc('update_reorder_status', {
        p_id: id,
        p_table: this.getTableName(type)
      })

      if (reorderError) {
        console.error('Error getting reorder status:', reorderError)
        throw reorderError
      }

      // Ensure reorder status is valid, default to 'normal' if not
      const validStatus = reorderStatus && ['normal', 'reorder_point', 'reordering', 'critical'].includes(reorderStatus)
        ? reorderStatus
        : 'normal'

      // Update the item with the new stock value and other fields
      const { data: updatedItem, error: updateError } = await supabase
        .from(this.getTableName(type))
        .update({ 
          current_stock: newStock,
          reorder_status: validStatus,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single()

      if (updateError) {
        console.error('Error updating stock:', updateError)
        throw updateError
      }

      // Add the expiry tracking entry
      const { error: expiryError } = await supabase
        .from('expiry_tracking')
        .insert({
          item_id: id,
          batch_number: data.batch_number,
          expiry_date: data.expiry_date,
          initial_quantity: data.quantity,
          current_quantity: data.quantity,
          created_by: user.id,
          invoice_number: data.invoice_number,
          invoice_date: data.invoice_date,
          delivery_date: data.delivery_date,
          afm_number: data.afm_number
        })

      if (expiryError) {
        console.error('Error adding expiry tracking:', expiryError)
        throw expiryError
      }

      // Update consumption history
      const { error: historyError } = await supabase.rpc('update_consumption_history', {
        p_id: id,
        p_quantity: data.quantity,
        p_type: 'addition',
        p_table: this.getTableName(type)
      })

      if (historyError) {
        console.error('Error updating consumption history:', historyError)
        throw historyError
      }

      return updatedItem as Item
    } catch (error) {
      console.error('Error adding stock:', error)
      throw error
    }
  }

  async getAuditHistory(id: string, type: 'pharmacy' | 'warehouse', filters?: {
    actionType?: string
    startDate?: string
    endDate?: string
    limit?: number
  }): Promise<AuditHistoryEntry[]> {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('ID do item é obrigatório')
      }
      
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      if (!uuidRegex.test(id)) {
        throw new Error('Formato de ID inválido')
      }

      const limit = Math.min(filters?.limit || 100, 500) // Cap at 500 records

      let query = supabase
        .from('audit_logs')
        .select(`
          id,
          action,
          old_data,
          new_data,
          created_at,
          changed_by,
          changed_by_user:users!audit_logs_changed_by_fkey(full_name)
        `)
        .eq('table_name', this.getTableName(type))
        .eq('record_id', id)
        .order('created_at', { ascending: false })
        .limit(limit)

      // Apply filters if provided
      if (filters?.startDate) {
        query = query.gte('created_at', filters.startDate)
      }
      if (filters?.endDate) {
        query = query.lte('created_at', filters.endDate)
      }

      const { data, error } = await query

      if (error) {
        console.error('Error fetching audit history:', error)
        throw error
      }

      return this.processAuditLogs(data || [])
    } catch (error) {
      console.error('Error getting audit history:', error)
      return []
    }
  }

  private processAuditLogs(logs: any[]): AuditHistoryEntry[] {
    return logs.map(log => {
      const changedByUser = log.changed_by_user as unknown as { full_name: string } | null
      let actionType: AuditHistoryEntry['action_type'] = 'general_edit'
      let oldValue: any = null
      let newValue: any = null

      try {
        const oldData = log.old_data || {}
        const newData = log.new_data || {}

        // Determine action type based on what changed
        if (oldData.current_stock !== newData.current_stock) {
          actionType = 'stock_change'
          oldValue = oldData.current_stock
          newValue = newData.current_stock
        } else if (oldData.price !== newData.price) {
          actionType = 'price_update'
          oldValue = oldData.price
          newValue = newData.price
        } else if (oldData.description !== newData.description) {
          actionType = 'description_edit'
          oldValue = oldData.description
          newValue = newData.description
        } else if (oldData.category !== newData.category) {
          actionType = 'category_change'
          oldValue = oldData.category
          newValue = newData.category
        }

        return {
          id: log.id,
          action_type: actionType,
          old_value: oldValue,
          new_value: newValue,
          user_name: changedByUser?.full_name || 'Sistema',
          created_at: log.created_at,
          reason: this.extractReasonFromAction(oldData, newData)
        }
      } catch (error) {
        console.error('Error processing audit log:', error)
        return {
          id: log.id,
          action_type: 'general_edit' as AuditHistoryEntry['action_type'],
          user_name: changedByUser?.full_name || 'Sistema',
          created_at: log.created_at
        }
      }
    }).filter(Boolean)
  }

  private extractReasonFromAction(oldData: any, newData: any): string {
    // Generate automatic reasons based on the type of change
    if (oldData.current_stock !== newData.current_stock) {
      const diff = (newData.current_stock || 0) - (oldData.current_stock || 0)
      return diff > 0 ? 'Entrada de estoque' : 'Saída de estoque'
    }
    if (oldData.price !== newData.price) {
      return 'Atualização de preço'
    }
    if (oldData.category !== newData.category) {
      return 'Mudança de categoria'
    }
    return 'Atualização geral'
  }

  async exportAuditHistory(id: string, type: 'pharmacy' | 'warehouse', itemName: string): Promise<void> {
    try {
      const history = await this.getAuditHistory(id, type)
      
      if (history.length === 0) {
        throw new Error('Nenhum histórico encontrado para exportar')
      }

      // Create CSV content
      const headers = [
        'Data/Hora',
        'Usuário',
        'Tipo de Alteração',
        'Valor Anterior',
        'Novo Valor',
        'Motivo'
      ]

      const rows = history.map(entry => [
        new Date(entry.created_at).toLocaleString('pt-BR'),
        entry.user_name,
        this.getActionTypeLabel(entry.action_type),
        entry.old_value || '-',
        entry.new_value || '-',
        entry.reason || '-'
      ])

      const csvContent = [
        `# Histórico de Alterações - ${itemName}`,
        `# Gerado em: ${new Date().toLocaleString('pt-BR')}`,
        `# Total de registros: ${history.length}`,
        '',
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n')

      // Create and download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `historico_${itemName.replace(/[^a-zA-Z0-9]/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      
      URL.revokeObjectURL(url)
    } catch (error) {
      console.error('Error exporting audit history:', error)
      throw new Error('Erro ao exportar histórico')
    }
  }

  async getByCategory(category: ItemCategory) {
    const table = ['Medicamentos', 'Material Hospitalar'].includes(category)
      ? 'pharmacy_items'
      : 'warehouse_items'

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .eq('category', category)
      .order('name')

    if (error) throw error
    return data as Item[]
  }

  async search(query: string, type: 'pharmacy' | 'warehouse') {
    try {
      // Input validation and sanitization
      if (!query || typeof query !== 'string') {
        return []
      }

      // Sanitize search query
      query = query.trim().substring(0, 100)
      if (query.length < 2) return []

      const searchPattern = '%' + query + '%'

      const { data, error } = await supabase
        .from(this.getTableName(type))
        .select('*')
        .or(`name.ilike.${searchPattern},code.ilike.${searchPattern}`)
        .order('name')

      if (error) {
        console.error('Search error:', error)
        throw error
      }

      return data as Item[]
    } catch (error) {
      console.error('Error searching items:', error)
      throw error
    }
  }

  async create(data: CreateItemData) {
    try {
      // Check authentication first
      const { data: { user }, error: authError } = await supabase.auth.getUser()

      if (authError) {
        console.error('Auth error:', authError)
        throw new Error('Erro de autenticação')
      }

      if (!user) {
        throw new Error('Usuário não autenticado')
      }

      console.log('User authenticated:', user.id, user.email)

      // Enhanced input validation
      if (!data.name || data.name.trim().length < 3) {
        throw new Error('Nome deve ter pelo menos 3 caracteres')
      }

      if (!data.code || data.code.trim().length === 0) {
        throw new Error('Código é obrigatório')
      }

      if (data.min_stock !== undefined && data.min_stock < 0) {
        throw new Error('Estoque mínimo não pode ser negativo')
      }

      if (data.current_stock !== undefined && data.current_stock < 0) {
        throw new Error('Estoque atual não pode ser negativo')
      }

      const table = ['Medicamentos', 'Material Hospitalar'].includes(data.category)
        ? 'pharmacy_items'
        : 'warehouse_items'

      // Prepare the data object with only the fields we need
      const insertData: any = {
        code: data.code,
        name: data.name,
        category: data.category,
        unit: data.unit,
        min_stock: data.min_stock ?? 0,
        current_stock: data.current_stock ?? 0
      }

      // Add optional fields only if they exist
      if (data.description !== undefined && data.description !== null && data.description.trim() !== '') {
        insertData.description = data.description
      }

      if (data.price !== undefined && data.price !== null) {
        insertData.price = data.price
      }

      if (data.expiry_date !== undefined && data.expiry_date !== null && data.expiry_date.trim() !== '') {
        insertData.expiry_date = data.expiry_date
      }

      if (data.invoice_number !== undefined && data.invoice_number !== null && data.invoice_number.trim() !== '') {
        insertData.invoice_number = data.invoice_number
      }

      if (data.supplier_cnpj !== undefined && data.supplier_cnpj !== null && data.supplier_cnpj.trim() !== '') {
        insertData.supplier_cnpj = data.supplier_cnpj
      }

      if (data.supplier_name !== undefined && data.supplier_name !== null && data.supplier_name.trim() !== '') {
        insertData.supplier_name = data.supplier_name
      }

      if (data.afm_number !== undefined && data.afm_number !== null && data.afm_number.trim() !== '') {
        insertData.afm_number = data.afm_number
      }

      if (data.invoice_total_value !== undefined && data.invoice_total_value !== null) {
        insertData.invoice_total_value = data.invoice_total_value
      }

      console.log('Inserting item into table:', table, 'with data:', insertData)

      const { data: item, error } = await supabase
        .from(table)
        .insert(insertData)
        .select()
        .single()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }

      // Create an entry in expiry_tracking to record the initial stock with all details
      if (item && data.current_stock && data.current_stock > 0) {
        const expiryTrackingData: any = {
          item_id: item.id,
          batch_number: 'INICIAL',
          initial_quantity: data.current_stock,
          current_quantity: data.current_stock,
          created_by: user.id
        }

        // Add optional fields
        if (data.expiry_date) {
          expiryTrackingData.expiry_date = data.expiry_date
        }
        if (data.invoice_number) {
          expiryTrackingData.invoice_number = data.invoice_number
        }
        if (data.afm_number) {
          expiryTrackingData.afm_number = data.afm_number
        }
        if (data.supplier_cnpj) {
          expiryTrackingData.supplier_cnpj = data.supplier_cnpj
        }
        if (data.supplier_name) {
          expiryTrackingData.supplier_name = data.supplier_name
        }
        if (data.invoice_total_value) {
          expiryTrackingData.invoice_total_value = data.invoice_total_value
        }

        const { error: trackingError } = await supabase
          .from('expiry_tracking')
          .insert(expiryTrackingData)

        if (trackingError) {
          console.error('Error creating expiry tracking entry:', trackingError)
          // Don't throw error here, as the item was created successfully
        }
      }

      return item as Item
    } catch (error) {
      console.error('Error creating item:', error)
      throw error
    }
  }

  async update(id: string, data: UpdateItemData, type: 'pharmacy' | 'warehouse') {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('ID do item é obrigatório')
      }
      
      if (data.name && data.name.trim().length < 3) {
        throw new Error('Nome deve ter pelo menos 3 caracteres')
      }

      const { data: item, error } = await supabase
        .from(this.getTableName(type))
        .update(data)
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return item as Item
    } catch (error) {
      console.error('Error updating item:', error)
      throw error
    }
  }

  async updateStock(id: string, quantity: number, type: 'pharmacy' | 'warehouse') {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('ID do item é obrigatório')
      }
      
      if (typeof quantity !== 'number' || quantity < 0) {
        throw new Error('Quantidade deve ser um número não negativo')
      }
      
      if (quantity > 1000000) {
        throw new Error('Quantidade muito alta')
      }

      // Get current item data for audit trail
      const currentItem = await this.getById(id, type)
      const oldStock = currentItem.current_stock
      const stockDifference = quantity - oldStock

      // Get the current reorder status
      const { data: reorderStatus, error: reorderError } = await supabase.rpc('update_reorder_status', {
        p_id: id,
        p_table: this.getTableName(type)
      })

      if (reorderError) {
        console.error('Error getting reorder status:', reorderError)
        throw reorderError
      }

      // Ensure reorder status is valid, default to 'normal' if not
      const validStatus = reorderStatus && ['normal', 'reorder_point', 'reordering', 'critical'].includes(reorderStatus)
        ? reorderStatus
        : 'normal'

      const { data: item, error } = await supabase
        .from(this.getTableName(type))
        .update({ 
          current_stock: quantity,
          reorder_status: validStatus
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error

      // Add manual audit entry for stock changes
      if (stockDifference !== 0) {
        const { data: { user } } = await supabase.auth.getUser()
        if (user) {
          await supabase.from('audit_logs').insert({
            table_name: this.getTableName(type),
            record_id: id,
            action: 'UPDATE',
            old_data: { current_stock: oldStock },
            new_data: { current_stock: quantity },
            changed_by: user.id
          })
        }
      }

      return item as Item
    } catch (error) {
      console.error('Error updating stock:', error)
      throw error
    }
  }

  async delete(id: string, type: 'pharmacy' | 'warehouse') {
    try {
      // Input validation
      if (!id || typeof id !== 'string') {
        throw new Error('ID do item é obrigatório')
      }

      const { error } = await supabase
        .from(this.getTableName(type))
        .delete()
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      console.error('Error deleting item:', error)
      throw error
    }
  }

  // Enhanced file validation
  private async validateImportFile(file: File): Promise<void> {
    // Enhanced file size validation
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('Arquivo muito grande. Tamanho máximo: 50MB')
    }

    // Validate file type more strictly
    const allowedTypes = [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/octet-stream' // Some browsers use this for Excel files
    ]
    
    const hasValidType = allowedTypes.includes(file.type)
    const hasValidExtension = file.name.match(/\.(xlsx|xls)$/i)
    
    if (!hasValidType && !hasValidExtension) {
      throw new Error('Tipo de arquivo inválido. Use apenas arquivos Excel (.xlsx, .xls)')
    }

    // Check for suspicious file characteristics
    if (file.name.includes('../') || file.name.includes('..\\')) {
      throw new Error('Nome de arquivo inválido')
    }

    // Additional security check for file header (magic numbers)
    const buffer = await file.slice(0, 8).arrayBuffer()
    const uint8Array = new Uint8Array(buffer)
    
    // Check for ZIP signature (Excel files are ZIP archives) - More robust check
    const isZip = uint8Array[0] === 0x50 && uint8Array[1] === 0x4B
    const isOLE = uint8Array[0] === 0xD0 && uint8Array[1] === 0xCF // Old Excel format
    
    if (!isZip && !isOLE) {
      throw new Error('Arquivo corrompido ou formato inválido')
    }
  }

  // Enhanced row validation
  private getActionTypeLabel(actionType: AuditHistoryEntry['action_type']): string {
    const labels = {
      'stock_change': 'Alteração de Estoque',
      'price_update': 'Atualização de Preço',
      'description_edit': 'Edição de Descrição',
      'category_change': 'Mudança de Categoria',
      'general_edit': 'Edição Geral'
    }
    return labels[actionType] || actionType
  }
  // Enhanced unit mapping and validation
  private mapAndValidateUnit(unitInput: any): UnitType {
    const trimmedUnit = unitInput?.toString().trim()
    if (!trimmedUnit) {
      throw new Error('Unidade é obrigatória')
    }

    const unitMap: Record<string, UnitType> = {
      'Unidade': 'Un', 'Peça': 'Pc', 'Caixa': 'Cx', 'Frasco': 'Fr',
      'Ampola': 'Amp', 'Tubo': 'Tb', 'Rolo': 'Rl', 'Litro': 'Lt',
      'Quilograma': 'Kg', 'Galão': 'Gl', 'Mililitro': 'ml', 'Grama': 'g',
      'Par': 'Pr', 'Conjunto': 'Cj', 'Saco': 'Sc', 'Resma': 'Rm',
      'Cento': 'Ct', 'Folha': 'FL'
    }

    const validUnitCodes = new Set(Object.values(unitMap))
    
    // Try direct match first
    if (validUnitCodes.has(trimmedUnit as UnitType)) {
      return trimmedUnit as UnitType
    }
    
    // Try mapping from display name
    if (unitMap[trimmedUnit]) {
      return unitMap[trimmedUnit]
    }
    
    // Try case-insensitive match
    const matchedUnit = Array.from(validUnitCodes).find(
      code => code.toLowerCase() === trimmedUnit.toLowerCase()
    )
    
    if (matchedUnit) {
      return matchedUnit
    }
    
    throw new Error(`Unidade inválida: "${trimmedUnit}". Unidades válidas: ${Object.keys(unitMap).join(', ')}`)
  }

  // Enhanced category validation
  private validateAndMapCategory(categoryInput: any, type: 'pharmacy' | 'warehouse'): ItemCategory {
    const category = categoryInput?.toString().trim()
    
    if (type === 'pharmacy') {
      const validCategories = ['Medicamentos', 'Material Hospitalar']
      if (!category || !validCategories.includes(category)) {
        // Default to Medicamentos if not specified or invalid
        return 'Medicamentos'
      }
      return category as ItemCategory
    } else {
      const validCategories = ['Material de Escritório', 'Material de Limpeza', 'Equipamentos', 'Outros']
      if (!category || !validCategories.includes(category)) {
        throw new Error(`Categoria inválida: "${category}". Categorias válidas: ${validCategories.join(', ')}`)
      }
      return category as ItemCategory
    }
  }

  // Get existing item codes to check for duplicates
  private async getExistingItemCodes(type: 'pharmacy' | 'warehouse'): Promise<Set<string>> {
    try {
      const { data, error } = await supabase
        .from(this.getTableName(type))
        .select('code')
      
      if (error) throw error
      
      return new Set(data?.map(item => item.code).filter(Boolean) || [])
    } catch (error) {
      console.error('Error fetching existing codes:', error)
      return new Set()
    }
  }

  // Enhanced database insertion with transaction support
  private async insertItemsWithTransaction(items: ImportItemData[], type: 'pharmacy' | 'warehouse'): Promise<void> {
    const table = this.getTableName(type)
    
    // Use RPC function for better transaction control
    const { error } = await supabase.rpc('insert_items_batch', {
      p_table: table,
      p_items: items
    })
    
    if (error) {
      // Fallback to regular insert if RPC is not available
      const { error: insertError } = await supabase
        .from(table)
        .insert(items)
      
      if (insertError) throw insertError
    }
  }

  // Enhanced error message formatting
  private formatErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      // Sanitize error message to prevent information disclosure
      const message = error.message
      if (message.includes('duplicate key') || message.includes('unique constraint')) {
        return 'Item com código duplicado'
      }
      if (message.includes('foreign key')) {
        return 'Referência inválida'
      }
      return message
    }
    return 'Erro desconhecido'
  }


  // Add input sanitization helper
  private sanitizeInput(value: any): string {
    if (value === null || value === undefined) return ''
    // Enhanced sanitization with proper HTML encoding
    return String(value)
      .trim()
      .replace(/[<>&"']/g, (match) => {
        const entityMap: { [key: string]: string } = {
          '<': '&lt;',
          '>': '&gt;',
          '&': '&amp;',
          '"': '&quot;',
          "'": '&#x27;'
        }
        return entityMap[match] || match
      })
      .replace(/\s+/g, ' ') // Normalize whitespace
      .substring(0, 1000) // Limit length to prevent DoS
  }

  async importFromExcel(file: File, type: 'pharmacy' | 'warehouse'): Promise<{
    success: ImportItemData[]
    errors: { row: number; error: string }[]
    warnings: { row: number; warning: string }[]
    summary: {
      totalRows: number
      processedRows: number
      successfulInserts: number
      duplicatesSkipped: number
    }
  }> {
    try {
      // Critical security check - validate file size first
      if (file.size > 10 * 1024 * 1024) {
        throw new Error('Arquivo muito grande. Tamanho máximo: 10MB')
      }
      
      // Enhanced file validation
      await this.validateImportFile(file)

      const workbook = await this.readExcelFile(file)
      const worksheet = workbook.Sheets[workbook.SheetNames[0]]
      const data = XLSX.utils.sheet_to_json(worksheet)
      
      // Enhanced row limit validation
      if (data.length > 1000) {
        throw new Error('Muitas linhas. Máximo: 1000 itens por importação')
      }

      const results = {
        success: [] as ImportItemData[],
        errors: [] as { row: number; error: string }[],
        warnings: [] as { row: number; warning: string }[],
        summary: {
          totalRows: data.length,
          processedRows: 0,
          successfulInserts: 0,
          duplicatesSkipped: 0
        }
      }

      // Get existing items to check for duplicates
      const existingItems = await this.getExistingItemCodes(type)
      const processedCodes = new Set<string>()

      // Validate and process each row
      for (let i = 0; i < data.length; i++) {
        try {
          const row = data[i] as any
          results.summary.processedRows++

          // Validate required fields
          const requiredFields = ['Código', 'Nome', 'Unidade', 'Estoque Atual']
          const missingFields = requiredFields.filter(field => !row[field])
          
          if (missingFields.length > 0) {
            throw new Error(`Campos obrigatórios ausentes: ${missingFields.join(', ')}`)
          }

          // Validate data types and ranges
          const currentStock = parseInt(row['Estoque Atual'], 10)
          if (isNaN(currentStock) || currentStock < 0) {
            throw new Error('Estoque Atual deve ser um número válido e não negativo')
          }

          // Check for duplicates
          const code = this.sanitizeInput(row['Código'])
          if (existingItems.has(code) || processedCodes.has(code)) {
            results.warnings.push({
              row: i + 2,
              warning: `Item com código "${code}" já existe. Linha ignorada.`
            })
            results.summary.duplicatesSkipped++
            continue
          }

          const unit = this.mapAndValidateUnit(row['Unidade'])
          const category = this.validateAndMapCategory(row['Categoria'], type)

          processedCodes.add(code)

          const item: ImportItemData = {
            code: code,
            name: this.sanitizeInput(row['Nome']),
            description: this.sanitizeInput(row['Descrição']) || undefined,
            category,
            unit: unit as UnitType,
            current_stock: parseInt(row['Estoque Atual'], 10),
            min_stock: row['Estoque Mínimo'] ? parseInt(row['Estoque Mínimo'], 10) : undefined,
            price: row['Valor'] ? parseFloat(row['Valor']) : undefined
          }

          results.success.push(item)
        } catch (error) {
          results.errors.push({
            row: i + 2, // Add 2 to account for header row and 1-based indexing
            error: this.formatErrorMessage(error)
          })
        }
      }

      // Enhanced database insertion with transaction
      if (results.success.length > 0) {
        try {
          await this.insertItemsWithTransaction(results.success, type)
          results.summary.successfulInserts = results.success.length
        } catch (error) {
          // If insertion fails, clear success array
          results.errors.push({
            row: 0,
            error: `Erro ao inserir itens no banco: ${error instanceof Error ? error.message : 'Erro desconhecido'}`
          })
          results.success = []
        }
      }

      return results
    } catch (error) {
      console.error('Error importing items:', error)
      throw error instanceof Error ? error : new Error('Erro ao importar itens')
    }
  }

  private async readExcelFile(file: File): Promise<XLSX.WorkBook> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: 'array' })
          resolve(workbook)
        } catch (error) {
          reject(error)
        }
      }
      reader.onerror = (error) => reject(error)
      reader.readAsArrayBuffer(file)
    })
  }

  async getTemplateWorkbook(type: 'pharmacy' | 'warehouse'): Promise<void> {
    try {
      // Create workbook
      const wb = XLSX.utils.book_new()

      // Create headers
      const headers = [
        'Código',
        'Nome',
        'Descrição',
        'Categoria',
        'Unidade',
        'Estoque Atual',
        'Estoque Mínimo',
        'Valor'
      ]

      // Create example data
      const exampleData = type === 'pharmacy' 
        ? [
          ['65.02.19.00097012-3', 'ACETILCISTEINA 600mg', 'Envelope com 5g', 'Medicamentos', 'Unidade', '100', '50', '2.50'],
          ['65.15.19.00007461-6', 'ABAIXADOR DE LÍNGUA', 'Espátula de madeira', 'Material Hospitalar', 'Peça', '200', '100', '0.15']
        ]
        : [
          ['75.10.00.00180357-3', 'CANETA ESFEROGRÁFICA AZUL', 'Escrita grossa', 'Material de Escritório', 'Unidade', '100', '50', '1.50'],
          ['75.20.00.00123456-7', 'DETERGENTE', 'Detergente líquido neutro', 'Material de Limpeza', 'Litro', '50', '20', '3.75']
        ]

      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleData] as any[])

      // Set column widths
      const colWidths = [
        { wch: 20 }, // Código
        { wch: 40 }, // Nome
        { wch: 30 }, // Descrição
        { wch: 20 }, // Categoria
        { wch: 15 }, // Unidade
        { wch: 15 }, // Estoque Atual
        { wch: 15 }, // Estoque Mínimo
        { wch: 15 }, // Valor
      ]
      ws['!cols'] = colWidths

      // Add notes to the template
      const notesRow = [
        'Obrigatório',
        'Obrigatório',
        'Opcional',
        type === 'pharmacy' ? 'Medicamentos ou Material Hospitalar' : 'Material de Escritório, Material de Limpeza, Equipamentos, Outros',
        'Un, Pc, Cx, Fr, Amp, Tb, Rl, Lt, Kg, Gl, ml, g, Pr, Cj, Sc, Rm, Ct, FL',
        'Obrigatório (número inteiro)',
        'Opcional (número inteiro)',
        'Opcional (número decimal)'
      ];
      
      // Add notes row after the examples
      XLSX.utils.sheet_add_aoa(ws, [notesRow], { origin: -1 });
      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Itens')

      // Generate Excel file
      const excelBuffer = XLSX.write(wb, { 
        bookType: 'xlsx', 
        type: 'array',
        bookSST: false,
        compression: true
      })

      // Create blob and download
      const blob = new Blob(
        [excelBuffer], 
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      )

      saveAs(blob, `modelo_importacao_${type === 'pharmacy' ? 'farmacia' : 'almoxarifado'}.xlsx`)
    } catch (error) {
      console.error('Error generating template:', error)
      throw new Error('Erro ao gerar modelo de importação')
    }
  }

  async exportToExcel(items: Item[], filename: string): Promise<void> {
    try {
      // Create workbook
      const wb = XLSX.utils.book_new()

      // Create headers
      const headers = [
        'Código',
        'Nome',
        'Descrição',
        'Categoria',
        'Unidade',
        'Estoque Atual',
        'Estoque Mínimo',
        'Valor Unitário',
        'Valor Total',
        'Status'
      ]

      // Format data
      const data = items.map(item => [
        item.code,
        item.name,
        item.description || '',
        item.category,
        item.unit,
        item.current_stock,
        item.min_stock,
        item.price || 0,
        (item.price || 0) * item.current_stock,
        item.current_stock === 0 
          ? 'Sem Estoque' 
          : item.current_stock <= item.min_stock 
            ? 'Estoque Baixo' 
            : 'Normal'
      ])

      // Create worksheet
      const ws = XLSX.utils.aoa_to_sheet([headers, ...data])

      // Set column widths
      const colWidths = [
        { wch: 20 }, // Código
        { wch: 40 }, // Nome
        { wch: 30 }, // Descrição
        { wch: 20 }, // Categoria
        { wch: 15 }, // Unidade
        { wch: 15 }, // Estoque Atual
        { wch: 15 }, // Estoque Mínimo
        { wch: 15 }, // Valor Unitário
        { wch: 15 }, // Valor Total
        { wch: 15 }, // Status
      ]
      ws['!cols'] = colWidths

      // Add worksheet to workbook
      XLSX.utils.book_append_sheet(wb, ws, 'Itens')

      // Generate Excel file
      const excelBuffer = XLSX.write(wb, { 
        bookType: 'xlsx', 
        type: 'array',
        bookSST: false,
        compression: true
      })

      // Create blob and download
      const blob = new Blob(
        [excelBuffer], 
        { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      )

      saveAs(blob, `${filename}.xlsx`)
    } catch (error) {
      console.error('Error exporting to Excel:', error)
      throw new Error('Erro ao exportar para Excel')
    }
  }

  async batchCreate(items: CreateItemData[]): Promise<void> {
    try {
      // Group items by type
      const pharmacyItems = items.filter(item => 
        ['Medicamentos', 'Material Hospitalar'].includes(item.category)
      )
      
      const warehouseItems = items.filter(item => 
        ['Material de Escritório', 'Material de Limpeza', 'Equipamentos', 'Outros'].includes(item.category)
      )

      // Insert pharmacy items
      if (pharmacyItems.length > 0) {
        const { error: pharmacyError } = await supabase
          .from('pharmacy_items')
          .insert(pharmacyItems)

        if (pharmacyError) throw pharmacyError
      }

      // Insert warehouse items
      if (warehouseItems.length > 0) {
        const { error: warehouseError } = await supabase
          .from('warehouse_items')
          .insert(warehouseItems)

        if (warehouseError) throw warehouseError
      }
    } catch (error) {
      console.error('Error batch creating items:', error)
      throw error
    }
  }
}

export const itemsService = ItemsService.getInstance()