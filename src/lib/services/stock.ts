// =====================================================================
// Servico central do modelo multi-estoque.
// Responsabilidades:
//   - Listar/cachear stock_locations (5 locais)
//   - Ler saldo de item_stocks (por item e/ou por local)
//   - Views auxiliares (emprestimos abertos, vencidos a baixar, historico)
//
// Mudanca de saldo e SO por RPC no banco (ver bloco "GRAVACAO" abaixo).
// NUNCA escrever direto em stock_movements, item_stocks.quantity nem em
// pharmacy_items.current_stock.
// =====================================================================

import { supabase } from '../supabase'
import type {
  CreateMovementInput,
  ExpiringToWriteoffRow,
  ItemStock,
  ItemStockWithLocation,
  ItemType,
  OpenLoanRow,
  SaidaAvulsaReason,
  StockLocation,
  StockLocationCode,
  StockMovement,
  StockReturn,
  StockReturnItem,
  StockTransfer,
  StockTransferItem,
} from '../types/stock'

class StockService {
  // ---------------------------------------------------------------
  // Cache de locais (sao apenas 5, raramente mudam)
  // ---------------------------------------------------------------
  private locationsCache: StockLocation[] | null = null
  private locationsByCode: Map<string, StockLocation> | null = null

  async getLocations(forceRefresh = false): Promise<StockLocation[]> {
    if (!forceRefresh && this.locationsCache) return this.locationsCache

    const { data, error } = await supabase
      .from('stock_locations')
      .select('*')
      .order('code', { ascending: true })

    if (error) {
      console.error('StockService.getLocations:', error)
      throw new Error('Erro ao carregar locais de estoque: ' + error.message)
    }

    this.locationsCache = (data || []) as StockLocation[]
    this.locationsByCode = new Map(this.locationsCache.map((l) => [l.code, l]))
    return this.locationsCache
  }

  async getLocationByCode(code: StockLocationCode | string): Promise<StockLocation | null> {
    if (!this.locationsByCode) await this.getLocations()
    return this.locationsByCode?.get(code) ?? null
  }

  async getLocationById(id: string): Promise<StockLocation | null> {
    const all = await this.getLocations()
    return all.find((l) => l.id === id) ?? null
  }

  invalidateLocationsCache() {
    this.locationsCache = null
    this.locationsByCode = null
  }

  // ---------------------------------------------------------------
  // Leitura de saldo
  // ---------------------------------------------------------------

  /** Saldo de um item em um local especifico. Retorna null se nao tem linha. */
  async getStock(itemId: string, itemType: ItemType, locationId: string): Promise<ItemStock | null> {
    const { data, error } = await supabase
      .from('item_stocks')
      .select('*')
      .eq('item_id', itemId)
      .eq('item_type', itemType)
      .eq('location_id', locationId)
      .maybeSingle()

    if (error) {
      console.error('StockService.getStock:', error)
      throw new Error('Erro ao consultar saldo: ' + error.message)
    }
    return data as ItemStock | null
  }

  /** Lista o saldo de um item em todos os locais (com nome do local). */
  async getStocksByItem(itemId: string, itemType: ItemType): Promise<ItemStockWithLocation[]> {
    const { data, error } = await supabase
      .from('item_stocks')
      .select('*, location:stock_locations(id, code, name, kind)')
      .eq('item_id', itemId)
      .eq('item_type', itemType)

    if (error) {
      console.error('StockService.getStocksByItem:', error)
      throw new Error('Erro ao consultar saldos do item: ' + error.message)
    }
    return (data || []) as unknown as ItemStockWithLocation[]
  }

  /** Lista todos os itens com saldo em um local (com nome do local). */
  async getStocksByLocation(locationId: string, itemType?: ItemType): Promise<ItemStockWithLocation[]> {
    let q = supabase
      .from('item_stocks')
      .select('*, location:stock_locations(id, code, name, kind)')
      .eq('location_id', locationId)

    if (itemType) q = q.eq('item_type', itemType)

    const { data, error } = await q
    if (error) {
      console.error('StockService.getStocksByLocation:', error)
      throw new Error('Erro ao consultar saldos do local: ' + error.message)
    }
    return (data || []) as unknown as ItemStockWithLocation[]
  }

  // ---------------------------------------------------------------
  // GRAVACAO: nada aqui grava mais direto (auditoria 28/09/2026, M7/F3).
  // As antigas createMovement / createSaidaAvulsa / createTransfer /
  // createReturn / closeLoan / adjust / updateMinMax inseriam em
  // stock_movements, stock_transfers(+items) e item_stocks pelo navegador —
  // qualquer usuario logado conseguia inflar saldo. O navegador perdeu esses
  // privilegios; use as RPCs do banco:
  //   saida / quebra / vencimento / transferencia -> registrar_saida_lote
  //   baixa de vencidos em massa                  -> baixar_vencidos
  //   dispensacao                                 -> criar_dispensacao
  //   perda / inutilizacao                        -> registrar_perda
  //   ajuste de saldo por lote                    -> farmacia_editar_lotes
  // ---------------------------------------------------------------

  // ---------------------------------------------------------------
  // Views auxiliares
  // ---------------------------------------------------------------

  async listOpenLoans(): Promise<OpenLoanRow[]> {
    const { data, error } = await supabase
      .from('open_loans')
      .select('*')
      .order('performed_at', { ascending: false })

    if (error) {
      console.error('StockService.listOpenLoans:', error)
      throw new Error('Erro ao listar emprestimos: ' + error.message)
    }
    return (data || []) as OpenLoanRow[]
  }

  async listExpiringToWriteoff(): Promise<ExpiringToWriteoffRow[]> {
    const { data, error } = await supabase
      .from('expiring_to_writeoff')
      .select('*')
      .order('expiry_date', { ascending: true })

    if (error) {
      console.error('StockService.listExpiringToWriteoff:', error)
      throw new Error('Erro ao listar vencimentos: ' + error.message)
    }
    return (data || []) as ExpiringToWriteoffRow[]
  }

  /** Historico de movimentacoes (livro-razao) de um item. */
  async listMovementsByItem(itemId: string, itemType: ItemType, limit = 100): Promise<StockMovement[]> {
    const { data, error } = await supabase
      .from('stock_movements')
      .select('*')
      .eq('item_id', itemId)
      .eq('item_type', itemType)
      .order('performed_at', { ascending: false })
      .limit(limit)

    if (error) {
      console.error('StockService.listMovementsByItem:', error)
      throw new Error('Erro ao listar movimentacoes: ' + error.message)
    }
    return (data || []) as StockMovement[]
  }
}

export const stockService = new StockService()
