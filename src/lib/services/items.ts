import { supabase } from '../supabase'
import { termoIlike, normalizarBusca } from '../utils/seguro'
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
  last_purchase_price?: number
  reference_price?: number
  expiry_date?: string
  batch_number?: string
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
  barcode?: string | null
  // Campos novos da farmacia (F1):
  supplier_id?: string | null
  medication_class?: 'uso_geral' | 'antimicrobianos' | 'controlados' | 'mav' | 'sgv' | 'curativo' | 'anticoagulante'
  // F2: classificação múltipla (array). medication_class é mantido em sync com
  // a primeira classe pra back-compat com a RPC criar_dispensacao em prod.
  medication_classes?: Array<'uso_geral' | 'antimicrobianos' | 'controlados' | 'mav' | 'sgv' | 'curativo' | 'anticoagulante'>
  controlled_subclass?: 'A1' | 'A2' | 'A3' | 'B1' | 'B2' | 'C1' | 'C2' | 'C3' | 'C4' | null
  presentation?:
    | 'comprimidos' | 'injetaveis' | 'ampola' | 'solucoes_orais' | 'topicos' | 'aerosol'
    | 'xarope' | 'supositorio' | 'gotas' | 'outros'
  is_mav?: boolean
  padronizado?: boolean
  // Consumo médio mensal informado no cadastro (un/mês). Null/undefined =>
  // a tela cai no cálculo por consumption_history.
  avg_monthly_consumption?: number | null
  // Almox: consumo médio diário informado (un/dia), fallback quando não há
  // saídas nos últimos 30 dias. Ponto de ressuprimento usa isto + lead_time.
  avg_daily_consumption?: number | null
  allowed_department_ids?: string[]
}

interface StockEntry {
  id: string
  quantity: number
  // 'movement' = linha vinda do livro-razão (stock_movements): dispensação,
  // devolução, transferência, baixa, ajuste. Só a farmácia produz essas —
  // ver getStockHistory.
  type: 'addition' | 'request' | 'movement'
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
  max_stock?: number
  current_stock?: number
  price?: number
  last_purchase_price?: number
  reference_price?: number
  // Setores autorizados a solicitar o item; vazio = todos. Padronizado (farmácia).
  allowed_department_ids?: string[]
  padronizado?: boolean
  expiry_date?: string
  batch_number?: string
  invoice_number?: string
  invoice_date?: string
  supplier_cnpj?: string
  supplier_name?: string
  afm_number?: string
  invoice_total_value?: number
  unit_price?: number
  acquisition_type?: 'Compra' | 'Empréstimo' | 'Doação' | 'Permuta' | 'Inventário'
  barcode?: string | null
  // Campos novos (farmacia multi-estoque):
  supplier_id?: string | null
  medication_class?: 'uso_geral' | 'antimicrobianos' | 'controlados' | 'mav' | 'sgv' | 'curativo' | 'anticoagulante'
  medication_classes?: Array<'uso_geral' | 'antimicrobianos' | 'controlados' | 'mav' | 'sgv' | 'curativo' | 'anticoagulante'>
  controlled_subclass?: 'A1' | 'A2' | 'A3' | 'B1' | 'B2' | 'C1' | 'C2' | 'C3' | 'C4' | null
  presentation?:
    | 'comprimidos' | 'injetaveis' | 'ampola' | 'solucoes_orais' | 'topicos' | 'aerosol'
    | 'xarope' | 'supositorio' | 'gotas' | 'outros'
  is_mav?: boolean
  // Consumo médio mensal informado (un/mês) — só farmácia.
  avg_monthly_consumption?: number | null
  // Almox: prazo de reposição (dias) e consumo diário informado (fallback).
  lead_time_days?: number
  avg_daily_consumption?: number | null
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
  last_purchase_price?: number
  reference_price?: number
  expiry_date?: string
  batch_number?: string
  invoice_number?: string
  supplier_cnpj?: string
  supplier_name?: string
  afm_number?: string
  invoice_total_value?: number
  lead_time_days?: number
  is_active?: boolean
  barcode?: string | null
  // Campos novos (farmacia multi-estoque):
  supplier_id?: string | null
  medication_class?: 'uso_geral' | 'antimicrobianos' | 'controlados' | 'mav' | 'sgv' | 'curativo' | 'anticoagulante'
  medication_classes?: Array<'uso_geral' | 'antimicrobianos' | 'controlados' | 'mav' | 'sgv' | 'curativo' | 'anticoagulante'>
  controlled_subclass?: 'A1' | 'A2' | 'A3' | 'B1' | 'B2' | 'C1' | 'C2' | 'C3' | 'C4' | null
  presentation?:
    | 'comprimidos' | 'injetaveis' | 'ampola' | 'solucoes_orais' | 'topicos' | 'aerosol'
    | 'xarope' | 'supositorio' | 'gotas' | 'outros'
  is_mav?: boolean
  padronizado?: boolean
  avg_monthly_consumption?: number | null
  avg_daily_consumption?: number | null
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
  // 'out' = Sem Estoque (saldo 0 no local). 'critical' hoje é usado como
  // "Ponto de Pedido" na tela de farmácia.
  status: ('normal' | 'low' | 'critical' | 'out')[]
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

  async getByType(type: 'pharmacy' | 'warehouse', filters?: FilterOptions, pagination?: PaginationOptions) {
    const table = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
    return this.getAllFromTable(table, filters, pagination)
  }

  /**
   * Lista itens de farmácia com saldo do estoque especificado (CAF/SAT_1/
   * SAT_2/SAT_T). O `current_stock` retornado é o saldo NESSE local (via
   * item_stocks), NÃO o campo global fossilizado em pharmacy_items. Ideal
   * pra tela do estoque: cada satélite vê o seu próprio saldo.
   *
   * Se um item nunca teve movimentação no local, `current_stock` = 0.
   * min_stock / max_stock também vêm de item_stocks (quando existirem);
   * caso contrário caem no valor global do cadastro.
   */
  async getPharmacyItemsByLocation(locationId: string, filters?: FilterOptions, pagination?: PaginationOptions) {
    const items = (await this.getAllFromTable('pharmacy_items', filters, pagination)) ?? []

    const { data: stocks, error } = await supabase
      .from('item_stocks')
      .select('item_id, quantity, min_qty, max_qty')
      .eq('location_id', locationId)
      .eq('item_type', 'pharmacy')

    if (error) {
      console.error('getPharmacyItemsByLocation stocks:', error)
      throw error
    }

    const byItem = new Map((stocks ?? []).map((s: any) => [s.item_id, s]))
    return items.map((it: any) => {
      const s = byItem.get(it.id)
      return {
        ...it,
        current_stock: s?.quantity ?? 0,
        min_stock: s?.min_qty ?? it.min_stock ?? 0,
        max_stock: s?.max_qty ?? it.max_stock ?? 0,
      }
    })
  }

  private async getAllFromTable(table: string, filters?: FilterOptions, pagination?: PaginationOptions) {
    try {
      let query = supabase
        .from(table)
        .select('*')
        // Exclui itens soft-deletados (is_active=false) das listagens.
        // Trata também itens antigos com is_active=null como ativos.
        .or('is_active.is.null,is_active.eq.true')

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
          // 'out' (Sem Estoque) não tem equivalente em reorder_status — é uma
          // condição de saldo. As telas que oferecem esse filtro (farmácia)
          // filtram no cliente, sobre o saldo do local; aqui ele é ignorado
          // para não excluir itens indevidamente.
          const statusMap: Record<string, string | undefined> = {
            'low': 'reorder_point',
            'normal': 'normal',
            'critical': 'critical',
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

      // Paginacao local (de 1000 em 1000): o PostgREST corta em 1000 linhas
      // em silencio. Erro de qualquer fonte SOBE — antes cada consulta que
      // falhava so ia pro console e a linha do tempo saia incompleta, como se
      // o item nao tivesse aquele historico.
      const todas = async <T,>(montar: (de: number, ate: number) => PromiseLike<{ data: T[] | null; error: any }>): Promise<T[]> => {
        const saida: T[] = []
        for (let de = 0; de < 200000; de += 1000) {
          const { data, error } = await montar(de, de + 999)
          if (error) throw error
          const lote = data ?? []
          saida.push(...lote)
          if (lote.length < 1000) break
        }
        return saida
      }

      // Get stock additions from expiry tracking
      const expiryData: any[] = await todas<any>((de, ate) => supabase
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
        .order('id')
        .range(de, ate))

      // Get audit logs for stock updates (so almox: na farmacia o saldo e
      // movido pelo livro-razao, que ja entra abaixo)
      const auditLogs: any[] = type === 'warehouse'
        ? await todas<any>((de, ate) => supabase
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
            .order('id')
            .range(de, ate))
        : []

      // Get requests that include this item
      const requestItems: any[] = await todas<any>((de, ate) => supabase
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
        .order('id')
        .range(de, ate))

      // Fetch user details for requests separately to avoid ambiguous relationships
      const userIds = [...new Set(requestItems.map(item => {
        if (!item.requests) return null;
        const request = item.requests as any;
        return request.requester_id;
      }).filter(Boolean))];

      const userMap = new Map<string, string>()
      for (let i = 0; i < userIds.length; i += 200) {
        const { data: users, error: usersError } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', userIds.slice(i, i + 200))
        if (usersError) {
          console.error('Error fetching users:', usersError);
          throw usersError;
        }
        ;(users || []).forEach((u: any) => userMap.set(u.id, u.full_name))
      }

      // Add expiry tracking entries to stock history
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

      // Alteracoes de current_stock no audit_logs: NAO viram mais "solicitacao"
      // nem "adicao". Toda baixa/entrada ja grava o proprio evento (solicitacao,
      // lote, movimento) e o audit_logs registra o mesmo saldo mudando — virar
      // 'request' contava em dobro "Total de Solicitacoes". Ficam na linha do
      // tempo como 'movement' (ajuste do saldo no cadastro), fora dos contadores.
      auditLogs.forEach(log => {
        const oldData = log.old_data as any;
        const newData = log.new_data as any;

        if (log.action === 'UPDATE' && oldData?.current_stock !== newData?.current_stock) {
          const quantity = Number(newData?.current_stock) - Number(oldData?.current_stock);
          if (Number.isFinite(quantity) && quantity !== 0 && !expiryData.some(e => e.created_at === log.created_at)) {
            stockHistory.push({
              id: log.id,
              type: 'movement',
              quantity: Math.abs(quantity),
              description: `Saldo do cadastro alterado (${oldData?.current_stock} → ${newData?.current_stock})`,
              created_by: 'Sistema',
              created_at: log.created_at,
              status: quantity > 0 ? 'in' : 'out',
            })
          }
        }
      });

      // Add request entries to stock history
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

      // ---------------------------------------------------------------
      // Livro-razão (stock_movements) — farmácia E almoxarifado.
      //
      // Sem isto a linha do tempo era cega para dispensação, devolução,
      // transferência, baixa avulsa e ajuste (e, no almox, para a saída
      // avulsa por setor, que só existe aqui).
      //
      // Dois tipos ficam DE FORA de propósito, porque já estão na lista por
      // outra fonte e entrariam em duplicidade:
      //   SOLICITACAO  -> já vem de request_items acima
      //   ENTRADA_NF   -> já vem de expiry_tracking acima
      // Paginado (antes .limit(300): item muito dispensado perdia o histórico).
      // ---------------------------------------------------------------
      const movs: any[] = await todas<any>((de, ate) => supabase
        .from('stock_movements')
        .select(`
          id, movement_type, direction, quantity, performed_at, notes,
          performed_by, destino_nome,
          expiry_tracking:expiry_tracking!stock_movements_expiry_tracking_id_fkey(batch_number, expiry_date),
          origem:stock_locations!stock_movements_source_location_id_fkey(code),
          destino:stock_locations!stock_movements_target_location_id_fkey(code)
        `)
        .eq('item_id', id)
        .eq('item_type', type)
        .not('movement_type', 'in', '("SOLICITACAO","ENTRADA_NF")')
        .order('performed_at', { ascending: false })
        .order('id')
        .range(de, ate))

      if (movs.length > 0) {
        const autorIds = [...new Set(movs.map((m: any) => m.performed_by).filter(Boolean))] as string[]
        const autores = new Map<string, string>()
        for (let i = 0; i < autorIds.length; i += 200) {
          const { data: us, error: eUs } = await supabase
            .from('users').select('id, full_name').in('id', autorIds.slice(i, i + 200))
          if (eUs) throw eUs
          ;(us || []).forEach((u: any) => autores.set(u.id, u.full_name))
        }

        const ACAO: Record<string, string> = {
          PRESCRICAO: 'Dispensação',
          DEVOLUCAO_INT: 'Devolução da enfermagem',
          SAIDA_AVULSA: type === 'warehouse' ? 'Saída avulsa' : 'Baixa (quebra, vencimento, empréstimo)',
          TRANSFERENCIA: 'Transferência entre estoques',
          AJUSTE: 'Ajuste manual',
          RETORNO_EMPRESTIMO: 'Retorno de empréstimo',
        }

        movs.forEach((m: any) => {
          const local = m.direction === 'out' ? m.origem?.code : m.destino?.code
          const acao = ACAO[m.movement_type] || m.movement_type
          const partes = [acao, local, m.direction === 'out' ? m.destino_nome : null].filter(Boolean)
          stockHistory.push({
            id: `mov_${m.id}`,
            type: 'movement',
            quantity: m.quantity,
            description: partes.join(' · '),
            created_by: autores.get(m.performed_by) || 'Sistema',
            created_at: m.performed_at,
            batch_number: m.expiry_tracking?.batch_number || undefined,
            expiry_date: m.expiry_tracking?.expiry_date || undefined,
            status: m.direction, // 'in' | 'out' — a tela usa pra cor e sinal
          })
        })
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
      // Erro SOBE: a tela mostra "nao foi possivel carregar o historico" com
      // "Tentar de novo" em vez de uma linha do tempo vazia/incompleta.
      throw error instanceof Error ? error : new Error('Erro ao carregar o histórico do item')
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
        .or(`name.ilike."${searchPattern}",code.ilike."${searchPattern}"`)
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

  async create(data: CreateItemData, typeOverride?: 'pharmacy' | 'warehouse') {
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

      // Saldo NUNCA entra pelo cadastro: entrava gravando lote 'INICIAL' e
      // stock_entries direto do navegador, engolindo erro. Estoque entra pela
      // Nova Entrada (RPC atomica, com rodada e local).
      if (data.current_stock !== undefined && data.current_stock !== null && Number(data.current_stock) !== 0) {
        throw new Error('O cadastro do item não grava saldo. Cadastre com estoque 0 e lance a quantidade pela Nova Entrada.')
      }

      const pharmacyCategories = ['Medicamentos', 'Material Hospitalar', 'MEDICAMENTO', 'MAT/MED', 'HIGIENE E LIMPEZA']
      const table = typeOverride
        ? (typeOverride === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items')
        : (pharmacyCategories.includes(data.category as string) ? 'pharmacy_items' : 'warehouse_items')

      // Prepare the data object with only the fields we need
      const insertData: any = {
        code: data.code,
        name: data.name,
        category: data.category,
        unit: data.unit,
        min_stock: data.min_stock ?? 0,
        max_stock: data.max_stock ?? 0,
        current_stock: 0,
        allowed_department_ids: data.allowed_department_ids ?? [],
        padronizado: data.padronizado ?? false,
      }

      // Add optional fields only if they exist
      if (data.description !== undefined && data.description !== null && data.description.trim() !== '') {
        insertData.description = data.description
      }

      if (data.price !== undefined && data.price !== null) {
        insertData.price = data.price
      }

      if (data.last_purchase_price !== undefined && data.last_purchase_price !== null) {
        insertData.last_purchase_price = data.last_purchase_price
      }

      // Consumo médio mensal informado (só farmácia). NaN vem de input vazio
      // com valueAsNumber, então filtramos.
      if (
        table === 'pharmacy_items' &&
        data.avg_monthly_consumption !== undefined &&
        data.avg_monthly_consumption !== null &&
        !Number.isNaN(data.avg_monthly_consumption)
      ) {
        insertData.avg_monthly_consumption = data.avg_monthly_consumption
      }

      // Almox: prazo de reposição + consumo diário informado (fallback).
      if (table === 'warehouse_items') {
        if (data.lead_time_days !== undefined && data.lead_time_days !== null && !Number.isNaN(data.lead_time_days)) {
          insertData.lead_time_days = data.lead_time_days
        }
        if (data.avg_daily_consumption !== undefined && data.avg_daily_consumption !== null && !Number.isNaN(data.avg_daily_consumption)) {
          insertData.avg_daily_consumption = data.avg_daily_consumption
        }
      }

      if (data.reference_price !== undefined && data.reference_price !== null) {
        insertData.reference_price = data.reference_price
      }

      if (data.expiry_date !== undefined && data.expiry_date !== null && data.expiry_date.trim() !== '') {
        insertData.expiry_date = data.expiry_date
      }

      if (data.batch_number !== undefined && data.batch_number !== null && data.batch_number.trim() !== '') {
        insertData.batch_number = data.batch_number
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

      // Código de barras (opcional, para leitor de scanner)
      if (data.barcode !== undefined && data.barcode !== null && data.barcode.trim() !== '') {
        insertData.barcode = data.barcode.trim()
      }

      // Campos novos da farmacia (so se for pharmacy_items)
      if (table === 'pharmacy_items') {
        if (data.supplier_id) insertData.supplier_id = data.supplier_id
        if (data.medication_classes && data.medication_classes.length > 0) {
          insertData.medication_classes = data.medication_classes
          // Sync da primeira classe pra back-compat com a RPC criar_dispensacao
          insertData.medication_class = data.medication_classes[0]
        } else if (data.medication_class) {
          insertData.medication_class = data.medication_class
          insertData.medication_classes = [data.medication_class]
        }
        if (data.controlled_subclass !== undefined) insertData.controlled_subclass = data.controlled_subclass
        if (data.presentation) insertData.presentation = data.presentation
        if (data.is_mav !== undefined) insertData.is_mav = data.is_mav
      }

      console.log('Inserting item into table:', table, 'with data:', insertData)

      // Codigo de item INATIVO: antes o cadastro reativava o item antigo e
      // sobrescrevia nome/unidade/categoria dele — o historico do item velho
      // passava a aparecer com os dados do novo. Agora recusa com mensagem.
      const { data: existentes, error: buscaErr } = await supabase
        .from(table)
        .select('id, name, is_active')
        .eq('code', data.code.trim())
        .limit(1)
      if (buscaErr) throw buscaErr
      const existente = (existentes ?? [])[0] as { id: string; name: string; is_active: boolean } | undefined
      if (existente) {
        throw new Error(existente.is_active
          ? `Já existe um item ativo com o código ${data.code.trim()} ("${existente.name}"). Use o item existente ou outro código.`
          : `O código ${data.code.trim()} pertence a um item INATIVO ("${existente.name}"). Peça ao gestor para reativar esse item em vez de cadastrar outro, ou use um código diferente.`)
      }

      const { data: created, error } = await supabase
        .from(table)
        .insert(insertData)
        .select()
        .single()

      if (error) {
        console.error('Supabase error:', error)
        throw error
      }
      const item: any = created

      return item as Item
    } catch (error) {
      console.error('Error creating item:', error)
      throw error
    }
  }

  /**
   * Itens ativos com nome parecido (mesmas palavras, sem acento/maiuscula/
   * pontuacao) — aviso antes de cadastrar um item que ja existe com outra grafia.
   */
  async nomesParecidos(nome: string, type: 'pharmacy' | 'warehouse'): Promise<Array<{ id: string; code: string | null; name: string; unit: string }>> {
    const limpa = (t: string) => normalizarBusca(t).replace(/[^a-z0-9]+/g, ' ').trim()
    const alvo = limpa(nome)
    const palavras = alvo.split(' ').filter((p) => p.length >= 3)
    if (palavras.length === 0) return []
    // Busca pela palavra mais longa e compara no navegador.
    const chave = [...palavras].sort((a, b) => b.length - a.length)[0]
    const { data, error } = await supabase
      .from(this.getTableName(type))
      .select('id, code, name, unit')
      .eq('is_active', true)
      .or(`name.ilike.${termoIlike(chave)}`)
      .limit(300)
    if (error) throw error
    const conjunto = (t: string) => new Set(limpa(t).split(' ').filter((p) => p.length >= 3))
    const meu = conjunto(nome)
    return ((data ?? []) as Array<{ id: string; code: string | null; name: string; unit: string }>).filter((r) => {
      const outro = limpa(r.name)
      if (outro === alvo) return true
      const dele = conjunto(r.name)
      const comuns = [...meu].filter((p) => dele.has(p)).length
      // Todas as palavras (3+ letras) de um nome estao no outro.
      return comuns > 0 && (comuns === meu.size || comuns === dele.size)
    }).slice(0, 5)
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

      // Sync medication_class (single) com a primeira de medication_classes (array)
      // pra back-compat com a RPC criar_dispensacao em prod.
      const payload: any = { ...data }
      if (type === 'pharmacy' && Array.isArray(payload.medication_classes) && payload.medication_classes.length > 0) {
        payload.medication_class = payload.medication_classes[0]
      }

      const { data: item, error } = await supabase
        .from(this.getTableName(type))
        .update(payload)
        .eq('id', id)
        .select()
        .maybeSingle()

      if (error) throw error
      // 0 linhas sem erro = RLS negou ou o item nao e deste catalogo (ex.: item
      // de material aberto como medicamento na Satelite Terreo). Antes a tela
      // fechava como se tivesse salvo.
      if (!item) {
        throw new Error(`Não foi possível salvar: item não encontrado no catálogo de ${type === 'pharmacy' ? 'medicamentos' : 'materiais'} ou sem permissão.`)
      }
      return item as Item
    } catch (error) {
      console.error('Error updating item:', error)
      throw error
    }
  }

  /**
   * Busca um item pelo código de barras (EAN-13, Code 128, etc.).
   * Procura nas duas tabelas se `type` não for informado.
   * Retorna null se não encontrar.
   */
  async findByBarcode(
    barcode: string,
    type?: 'pharmacy' | 'warehouse',
  ): Promise<{ item: Item; type: 'pharmacy' | 'warehouse' } | null> {
    const tables: Array<'pharmacy' | 'warehouse'> = type ? [type] : ['pharmacy', 'warehouse']

    for (const t of tables) {
      const table = this.getTableName(t)
      const { data, error } = await supabase
        .from(table)
        .select('*')
        .eq('barcode', barcode)
        .eq('is_active', true)
        .maybeSingle()

      if (error) console.error(`findByBarcode error (${table}):`, error)
      if (data) return { item: data as Item, type: t }
    }

    return null
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

      // Tenta delete físico. Se o item nunca foi usado (sem histórico),
      // some do banco. Se já está em solicitações/movimentações, o banco
      // bloqueia via FK — aí fazemos soft delete (is_active=false).
      const { error: deleteError } = await supabase
        .from(this.getTableName(type))
        .delete()
        .eq('id', id)

      if (!deleteError) return

      // Código 23503 = foreign_key_violation (item tem histórico).
      // Para qualquer erro de FK, faz soft delete.
      const isFkError =
        (deleteError as any)?.code === '23503' ||
        /foreign key|violates|fkey/i.test(deleteError.message || '')

      if (!isFkError) {
        throw deleteError
      }

      const { error: updateError } = await supabase
        .from(this.getTableName(type))
        .update({ is_active: false, updated_at: new Date().toISOString() })
        .eq('id', id)

      if (updateError) throw updateError
      // Soft delete OK — o item some das listas (filtro is_active=true)
      // mas o histórico de solicitações/movimentações fica preservado.
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