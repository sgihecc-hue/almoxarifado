import { supabase } from '../supabase'

export type LoanType =
  | 'emprestimo'
  | 'devolucao_emprestimo'
  | 'troca_validade'
  | 'permuta'
  | 'consignacao'
  | 'doacao'

export const LOAN_TYPE_LABELS: Record<LoanType, string> = {
  emprestimo: 'Empréstimo',
  devolucao_emprestimo: 'Devolução de empréstimo',
  troca_validade: 'Troca de validade',
  permuta: 'Permuta',
  consignacao: 'Consignação',
  doacao: 'Doação',
}

export type LoanDirection = 'enviando' | 'recebendo'

export type LoanScope = 'pharmacy' | 'warehouse'

export const LOAN_SCOPE_LABELS: Record<LoanScope, string> = {
  pharmacy: 'Farmácia',
  warehouse: 'Almoxarifado',
}

export type LoanItemKind = 'pharmacy' | 'warehouse'

export interface LoanItemInput {
  direction: LoanDirection
  pharmacy_item_id?: string | null
  warehouse_item_id?: string | null
  item_description: string
  unit?: string
  quantity: number
  unit_price?: number | null
  validity_date?: string | null
  batch_number?: string | null
  codigo_simpas?: string | null
  observation?: string | null
}

export interface CreateLoanData {
  scope: LoanScope
  origem: string
  destino: string
  contato_origem?: string
  contato_destino?: string
  form_date?: string
  enviando_type?: LoanType | null
  recebendo_type?: LoanType | null
  signature_solicitante_name?: string
  signature_cedente_name?: string
  related_loan_id?: string | null
  notes?: string
  items: LoanItemInput[]
}

export interface LoanItem {
  id: string
  loan_id: string
  direction: LoanDirection
  pharmacy_item_id: string | null
  warehouse_item_id: string | null
  item_description: string
  unit: string | null
  quantity: number
  unit_price: number | null
  validity_date: string | null
  batch_number: string | null
  codigo_simpas: string | null
  observation: string | null
}

export interface LoanSummary {
  id: string
  form_number: number
  scope: LoanScope
  origem: string
  destino: string
  contato_origem: string | null
  contato_destino: string | null
  form_date: string
  enviando_type: LoanType | null
  recebendo_type: LoanType | null
  signature_solicitante_name: string | null
  signature_cedente_name: string | null
  related_loan_id: string | null
  status: 'pending' | 'completed' | 'cancelled'
  confirmed_at?: string | null
  confirmed_by?: string | null
  notes: string | null
  created_by: string
  created_by_name?: string | null
  created_at: string
  cancelled_at?: string | null
  cancellation_reason?: string | null
  enviando_count?: number
  enviando_total?: number
  recebendo_count?: number
  recebendo_total?: number
}

export interface LoanDetail extends LoanSummary {
  items: LoanItem[]
}

class PharmacyLoanService {
  private static instance: PharmacyLoanService
  static getInstance() {
    if (!PharmacyLoanService.instance) PharmacyLoanService.instance = new PharmacyLoanService()
    return PharmacyLoanService.instance
  }

  async list(scope?: LoanScope): Promise<LoanSummary[]> {
    let q = supabase
      .from('pharmacy_loans')
      .select(
        `id, form_number, scope, origem, destino, contato_origem, contato_destino, form_date,
         enviando_type, recebendo_type, signature_solicitante_name, signature_cedente_name,
         related_loan_id, status, notes, created_by, created_at,
         cancelled_at, cancellation_reason,
         users:created_by ( full_name ),
         pharmacy_loan_items ( direction, quantity, unit_price )`
      )
      .order('created_at', { ascending: false })
      .limit(300)
    if (scope) q = q.eq('scope', scope)
    const { data, error } = await q

    if (error) {
      console.error('Error listing loans:', error)
      throw new Error('Erro ao carregar as movimentações: ' + error.message)
    }

    return (data || []).map((row: any) => {
      const items = row.pharmacy_loan_items || []
      let envCount = 0, envTotal = 0, recCount = 0, recTotal = 0
      for (const it of items) {
        const v = Number(it.unit_price || 0) * Number(it.quantity || 0)
        if (it.direction === 'enviando') {
          envCount++; envTotal += v
        } else {
          recCount++; recTotal += v
        }
      }
      return {
        id: row.id,
        form_number: row.form_number,
        scope: (row.scope || 'pharmacy') as LoanScope,
        origem: row.origem,
        destino: row.destino,
        contato_origem: row.contato_origem,
        contato_destino: row.contato_destino,
        form_date: row.form_date,
        enviando_type: row.enviando_type,
        recebendo_type: row.recebendo_type,
        signature_solicitante_name: row.signature_solicitante_name,
        signature_cedente_name: row.signature_cedente_name,
        related_loan_id: row.related_loan_id,
        status: row.status,
        notes: row.notes,
        created_by: row.created_by,
        created_by_name: row.users?.full_name ?? null,
        created_at: row.created_at,
        cancelled_at: row.cancelled_at,
        cancellation_reason: row.cancellation_reason,
        enviando_count: envCount,
        enviando_total: envTotal,
        recebendo_count: recCount,
        recebendo_total: recTotal,
      }
    })
  }

  async getById(id: string): Promise<LoanDetail | null> {
    const { data, error } = await supabase
      .from('pharmacy_loans')
      .select(
        `id, form_number, scope, origem, destino, contato_origem, contato_destino, form_date,
         enviando_type, recebendo_type, signature_solicitante_name, signature_cedente_name,
         related_loan_id, status, notes, created_by, created_at,
         cancelled_at, cancellation_reason,
         users:created_by ( full_name ),
         pharmacy_loan_items ( id, loan_id, direction, pharmacy_item_id, warehouse_item_id, item_description,
                               unit, quantity, unit_price, validity_date, batch_number,
                               codigo_simpas, observation )`
      )
      .eq('id', id)
      .maybeSingle()

    if (error) {
      console.error('Error loading loan:', error)
      throw new Error(error.message)
    }
    if (!data) return null

    const row: any = data
    const items = (row.pharmacy_loan_items || []) as LoanItem[]
    return {
      id: row.id,
      form_number: row.form_number,
      scope: (row.scope || 'pharmacy') as LoanScope,
      origem: row.origem,
      destino: row.destino,
      contato_origem: row.contato_origem,
      contato_destino: row.contato_destino,
      form_date: row.form_date,
      enviando_type: row.enviando_type,
      recebendo_type: row.recebendo_type,
      signature_solicitante_name: row.signature_solicitante_name,
      signature_cedente_name: row.signature_cedente_name,
      related_loan_id: row.related_loan_id,
      status: row.status,
      notes: row.notes,
      created_by: row.created_by,
      created_by_name: row.users?.full_name ?? null,
      created_at: row.created_at,
      cancelled_at: row.cancelled_at,
      cancellation_reason: row.cancellation_reason,
      items: items.sort((a, b) => {
        if (a.direction === b.direction) return 0
        return a.direction === 'enviando' ? -1 : 1
      }),
    }
  }

  /**
   * Cria o formulario (cabecalho + itens) numa transacao no banco (RPC
   * emprestimo_criar). `chave` identifica a rodada: repetir nao duplica.
   * O formulario nasce PENDENTE; o estoque so mexe quando os itens forem
   * confirmados na tela de Pendencias.
   */
  async create(data: CreateLoanData, chave?: string): Promise<{ id: string; form_number: number }> {
    if (!data.items || data.items.length === 0) {
      throw new Error('Adicione pelo menos um item ao formulário')
    }
    if (!data.enviando_type && !data.recebendo_type) {
      throw new Error('Marque o tipo da movimentação (Enviando e/ou Recebendo)')
    }
    if (!data.origem?.trim() || !data.destino?.trim()) {
      throw new Error('Origem e Destino são obrigatórios')
    }
    for (const it of data.items) {
      if (it.direction === 'enviando' && !data.enviando_type) throw new Error('Há itens em "Enviando" mas o tipo não foi marcado')
      if (it.direction === 'recebendo' && !data.recebendo_type) throw new Error('Há itens em "Recebendo" mas o tipo não foi marcado')
      if (!it.item_description?.trim()) throw new Error('Cada item precisa de uma descrição')
      if (!it.quantity || it.quantity <= 0) throw new Error('Cada item precisa de quantidade maior que zero')
      if (data.scope === 'pharmacy' && it.warehouse_item_id) throw new Error('Formulário de Farmácia não pode ter item de Almoxarifado')
      if (data.scope === 'warehouse' && it.pharmacy_item_id) throw new Error('Formulário de Almoxarifado não pode ter item de Farmácia')
    }

    const { data: result, error } = await supabase.rpc('emprestimo_criar', {
      p_dados: {
        scope: data.scope,
        origem: data.origem.trim(),
        destino: data.destino.trim(),
        contato_origem: data.contato_origem?.trim() || null,
        contato_destino: data.contato_destino?.trim() || null,
        form_date: data.form_date || null,
        enviando_type: data.enviando_type || null,
        recebendo_type: data.recebendo_type || null,
        signature_solicitante_name: data.signature_solicitante_name?.trim() || null,
        signature_cedente_name: data.signature_cedente_name?.trim() || null,
        related_loan_id: data.related_loan_id || null,
        notes: data.notes?.trim() || null,
        items: data.items.map((it) => ({
          direction: it.direction,
          pharmacy_item_id: it.pharmacy_item_id || null,
          warehouse_item_id: it.warehouse_item_id || null,
          item_description: it.item_description.trim(),
          unit: it.unit?.trim() || null,
          quantity: it.quantity,
          unit_price: it.unit_price ?? null,
          validity_date: it.validity_date || null,
          batch_number: it.batch_number?.trim() || null,
          codigo_simpas: it.codigo_simpas?.trim() || null,
          observation: it.observation?.trim() || null,
        })),
      },
      p_chave: chave ?? null,
    })
    if (error) {
      console.error('Error creating loan:', error)
      throw error
    }
    const r = result as { id: string; form_number: number }
    return { id: r.id, form_number: r.form_number }
  }

  // Lista as movimentações em status='pending' — tela de PENDÊNCIAS.
  async listPending(scope?: 'pharmacy' | 'warehouse'): Promise<LoanSummary[]> {
    let q = supabase
      .from('pharmacy_loans')
      .select(`id, form_number, scope, origem, destino, form_date, enviando_type, recebendo_type,
               signature_solicitante_name, signature_cedente_name, related_loan_id,
               status, notes, created_by, created_at,
               pharmacy_loan_items(id, quantity, unit_price, confirmed_at)`)
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
    if (scope) q = q.eq('scope', scope)
    const { data, error } = await q
    if (error) { console.error(error); throw new Error('Erro ao carregar as pendências: ' + error.message) }
    return (data || []).map((row: any) => ({
      id: row.id, form_number: row.form_number, scope: row.scope, origem: row.origem,
      destino: row.destino,
      contato_origem: row.contato_origem ?? null,
      contato_destino: row.contato_destino ?? null,
      form_date: row.form_date,
      enviando_type: row.enviando_type, recebendo_type: row.recebendo_type,
      signature_solicitante_name: row.signature_solicitante_name,
      signature_cedente_name: row.signature_cedente_name,
      related_loan_id: row.related_loan_id, status: row.status, notes: row.notes,
      created_by: row.created_by, created_at: row.created_at,
      enviando_count: (row.pharmacy_loan_items || []).length,
      enviando_total: (row.pharmacy_loan_items || []).reduce(
        (acc: number, i: any) => acc + Number(i.quantity || 0) * Number(i.unit_price || 0), 0),
    }))
  }

  // Confirma 1 item: a RPC MOVIMENTA o estoque desse item (farmacia: CAF com
  // lote; almox: saldo do almoxarifado) e conclui o formulario quando nao
  // sobra item pendente. Saldo/lote insuficiente = erro com a mensagem.
  async confirmItem(loanId: string, itemId: string): Promise<{ concluido: boolean }> {
    const { data, error } = await supabase.rpc('emprestimo_confirmar_itens', {
      p_loan_id: loanId,
      p_item_id: itemId,
    })
    if (error) throw error
    return data as { concluido: boolean }
  }

  // Confirma todos os itens pendentes (cada um movimenta o estoque) numa
  // transacao: ou todos entram, ou nenhum.
  async confirmAll(loanId: string): Promise<{ concluido: boolean }> {
    const { data, error } = await supabase.rpc('emprestimo_confirmar_itens', {
      p_loan_id: loanId,
      p_item_id: null,
    })
    if (error) throw error
    return data as { concluido: boolean }
  }

  // Cancelamento (gestor/admin): desfaz SO o que ja movimentou estoque.
  async cancel(id: string, reason: string): Promise<{ itens_desfeitos: number }> {
    if (!reason || reason.trim().length < 3) {
      throw new Error('Informe um motivo (mínimo 3 caracteres) para o estorno')
    }
    const { data, error } = await supabase.rpc('emprestimo_cancelar', {
      p_loan_id: id,
      p_motivo: reason.trim(),
    })
    if (error) {
      console.error('Error cancelling loan:', error)
      throw error
    }
    return data as { itens_desfeitos: number }
  }
}

export const pharmacyLoanService = PharmacyLoanService.getInstance()
