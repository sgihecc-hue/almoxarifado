// =====================================================================
// Tipos do modelo multi-estoque (Fase 1-6 da reformulacao da farmacia).
// Tabelas relacionadas:
//   - stock_locations    (CAF, ALMOX, SAT_1, SAT_2, SAT_T)
//   - item_stocks        (saldo + min/max por item x local)
//   - stock_movements    (livro-razao imutavel)
//   - stock_returns      (devolucao interna)
//   - stock_transfers    (entre satelites)
// =====================================================================

export type StockLocationCode = 'CAF' | 'ALMOX' | 'SAT_1' | 'SAT_2' | 'SAT_T'
export type StockLocationKind = 'central' | 'satellite'

export interface StockLocation {
  id: string
  code: StockLocationCode | string
  name: string
  kind: StockLocationKind
  parent_id: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type ItemType = 'pharmacy' | 'warehouse'

export interface ItemStock {
  id: string
  item_id: string
  item_type: ItemType
  location_id: string
  quantity: number
  min_qty: number
  max_qty: number
  updated_at: string
}

/** Saldo com dados do local. Util para listagens. */
export interface ItemStockWithLocation extends ItemStock {
  location: Pick<StockLocation, 'id' | 'code' | 'name' | 'kind'>
}

export type MovementType =
  | 'ENTRADA_NF'
  | 'SOLICITACAO'
  | 'PRESCRICAO'
  | 'DEVOLUCAO_INT'
  | 'TRANSFERENCIA'
  | 'SAIDA_AVULSA'
  | 'RETORNO_EMPRESTIMO'
  | 'AJUSTE'

export type MovementDirection = 'in' | 'out'

export type SaidaAvulsaReason =
  | 'emprestimo'
  | 'devolucao_fornecedor'
  | 'quebra'
  | 'vencimento'
  | 'obito_sem_reaproveitamento'
  | 'defeito_fabricacao'
  | 'embalagem_violada'
  | 'falha_fracionamento'
  | 'outro'

export interface StockMovement {
  id: string
  item_id: string
  item_type: ItemType
  movement_type: MovementType
  direction: MovementDirection
  quantity: number
  unit_cost: number | null

  source_location_id: string | null
  target_location_id: string | null

  request_id: string | null
  dispensation_id: string | null
  return_id: string | null
  transfer_id: string | null

  reason: SaidaAvulsaReason | null
  reason_detail: string | null
  awaits_return: boolean
  linked_movement_id: string | null

  notes: string | null
  performed_by: string | null
  performed_at: string

  medical_record_number: string | null
  prescription_date: string | null
}

/** Payload para criar uma movimentacao. Os campos opcionais variam por tipo. */
export interface CreateMovementInput {
  item_id: string
  item_type: ItemType
  movement_type: MovementType
  direction: MovementDirection
  quantity: number
  unit_cost?: number | null

  source_location_id?: string | null
  target_location_id?: string | null

  request_id?: string | null
  dispensation_id?: string | null
  return_id?: string | null
  transfer_id?: string | null

  reason?: SaidaAvulsaReason | null
  reason_detail?: string | null
  awaits_return?: boolean
  linked_movement_id?: string | null

  notes?: string | null
  performed_by?: string | null

  medical_record_number?: string | null
  prescription_date?: string | null
}

// ---------- Devolucao interna ----------
export interface StockReturn {
  id: string
  return_number: number
  request_id: string | null
  target_location_id: string
  returned_by_user_id: string
  department_id: string | null
  notes: string | null
  returned_at: string
  created_at: string
  // Campos adicionados em G1:
  return_status: 'pending' | 'confirmed'
  confirmed_by: string | null
  confirmed_at: string | null
  patient_name: string | null
  patient_prontuario: string | null
  return_reason: string | null
  source_location_id: string | null
  divergence_notes: string | null
}

export interface StockReturnItem {
  id: string
  return_id: string
  item_id: string
  item_type: ItemType
  quantity: number
  notes: string | null
}

// ---------- Transferencia entre satelites ----------
export interface StockTransfer {
  id: string
  transfer_number: number
  source_location_id: string
  target_location_id: string
  performed_by: string
  notes: string | null
  performed_at: string
}

export interface StockTransferItem {
  id: string
  transfer_id: string
  item_id: string
  item_type: ItemType
  quantity: number
}

// ---------- Views de relatorio ----------
export interface OpenLoanRow {
  movement_id: string
  item_id: string
  item_type: ItemType
  quantity: number
  unit_cost: number | null
  source_location_id: string
  location_name: string
  borrowed_to: string | null
  performed_by: string | null
  performed_at: string
  notes: string | null
}

export interface ExpiringToWriteoffRow {
  expiry_tracking_id: string
  item_id: string
  item_type: ItemType
  batch_number: string
  expiry_date: string
  current_quantity: number
  item_name: string
  unit_cost: number | null
  estimated_loss: number | null
}

// ---------- Rotulos PT-BR ----------
export const MOVEMENT_TYPE_LABEL: Record<MovementType, string> = {
  ENTRADA_NF: 'Entrada por Nota Fiscal',
  SOLICITACAO: 'Solicitacao',
  PRESCRICAO: 'Prescricao medica',
  DEVOLUCAO_INT: 'Devolucao interna',
  TRANSFERENCIA: 'Transferencia entre satelites',
  SAIDA_AVULSA: 'Saida avulsa',
  RETORNO_EMPRESTIMO: 'Retorno de emprestimo',
  AJUSTE: 'Ajuste manual',
}

export const SAIDA_AVULSA_REASON_LABEL: Record<SaidaAvulsaReason, string> = {
  emprestimo: 'Emprestimo',
  devolucao_fornecedor: 'Devolucao ao fornecedor',
  quebra: 'Quebra',
  vencimento: 'Vencimento',
  obito_sem_reaproveitamento: 'Obito (sem reaproveitamento)',
  defeito_fabricacao: 'Defeito de fabricacao',
  embalagem_violada: 'Embalagem violada',
  falha_fracionamento: 'Falha no fracionamento',
  outro: 'Outro',
}

// ---------- Itens a vencer (view v_itens_a_vencer) ----------
export type ExpiryColorBand = '6m' | '3m' | '1m'

export interface ExpiringAlertRow {
  expiry_tracking_id: string
  item_id: string
  item_type: ItemType
  item_name: string
  medication_class: string | null
  batch_number: string
  expiry_date: string
  current_quantity: number
  unit_cost: number | null
  estimated_value: number | null
  color_band: ExpiryColorBand
}

export interface ExpiryAlertResolution {
  id: string
  expiry_tracking_id: string
  color_band: ExpiryColorBand
  resolved_by: string
  resolved_at: string
  notes: string | null
}
