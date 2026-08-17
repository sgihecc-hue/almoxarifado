import { supabase } from '../supabase'

// Carros de emergência (A, B, C, D). O carro NÃO é um stock_location: ele
// mistura medicamentos (pharmacy_items) e materiais (warehouse_items), e cada
// stock_location só opera com um item_type. Por isso tabelas próprias.
//
// Nesta entrega o carro é só cadastro/visualização do conteúdo — não abate
// saldo de satélite nenhum. O `source_location_id` é informativo (de onde veio).

export type CartItemType = 'pharmacy' | 'warehouse'

export interface EmergencyCart {
  id: string
  code: string
  name: string
  registration_number: string | null
  notes: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface EmergencyCartItem {
  id: string
  cart_id: string
  item_id: string
  item_type: CartItemType
  quantity: number
  min_quantity: number | null
  batch_number: string | null
  expiry_date: string | null
  source_location_id: string | null
  created_at: string
  updated_at: string
  // Resolvidos no serviço a partir do catálogo correspondente ao item_type.
  item_name: string
  item_code: string | null
  item_unit: string | null
}

export interface EmergencyCartWithItems {
  cart: EmergencyCart
  items: EmergencyCartItem[]
}

// Opção do buscador de item — vem dos DOIS catálogos, marcada pelo tipo.
export interface CatalogOption {
  id: string
  name: string
  code: string | null
  unit: string | null
  item_type: CartItemType
}

export interface CartItemInput {
  item_id: string
  item_type: CartItemType
  quantity: number
  min_quantity?: number | null
  batch_number?: string | null
  expiry_date?: string | null
  source_location_id?: string | null
}

// Resumo por carro usado nos cards da tela inicial (evita carregar o conteúdo
// inteiro dos 4 carros só pra mostrar contagem e alerta de validade).
export interface EmergencyCartSummary extends EmergencyCart {
  total_items: number
  expired_count: number
  expiring_count: number
}

// Janela de "vencendo" usada no alerta dos cards e no destaque da lista.
const EXPIRING_DAYS = 30

function todayISO(): string {
  // Data local em ISO (yyyy-MM-dd) — expiry_date é `date`, sem fuso.
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

function limitISO(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** Status de validade de um item do carro (para o alerta do checklist). */
export function expiryStatus(expiry: string | null): 'none' | 'ok' | 'expiring' | 'expired' {
  if (!expiry) return 'none'
  const hoje = todayISO()
  if (expiry < hoje) return 'expired'
  if (expiry <= limitISO(EXPIRING_DAYS)) return 'expiring'
  return 'ok'
}

class EmergencyCartsService {
  /** Os 4 carros, na ordem A, B, C, D. */
  async list(includeInactive = false): Promise<EmergencyCart[]> {
    let q = supabase.from('emergency_carts').select('*').order('code')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw new Error('Erro ao listar carros de emergência: ' + error.message)
    return (data || []) as EmergencyCart[]
  }

  /**
   * Carros + contagem de itens e de vencidos/vencendo, para os cards.
   * Uma query só na tabela de itens (não resolve nome — o card não precisa).
   */
  async listWithSummary(includeInactive = false): Promise<EmergencyCartSummary[]> {
    const carts = await this.list(includeInactive)
    if (carts.length === 0) return []

    const { data, error } = await supabase
      .from('emergency_cart_items')
      .select('cart_id, expiry_date')
      .in('cart_id', carts.map((c) => c.id))
    if (error) throw new Error('Erro ao resumir carros de emergência: ' + error.message)

    const acc = new Map<string, { total: number; expired: number; expiring: number }>()
    for (const row of (data || []) as Array<{ cart_id: string; expiry_date: string | null }>) {
      const cur = acc.get(row.cart_id) ?? { total: 0, expired: 0, expiring: 0 }
      cur.total += 1
      const st = expiryStatus(row.expiry_date)
      if (st === 'expired') cur.expired += 1
      else if (st === 'expiring') cur.expiring += 1
      acc.set(row.cart_id, cur)
    }

    return carts.map((c) => {
      const s = acc.get(c.id) ?? { total: 0, expired: 0, expiring: 0 }
      return { ...c, total_items: s.total, expired_count: s.expired, expiring_count: s.expiring }
    })
  }

  /**
   * Um carro com todo o conteúdo. O nome do item é resolvido nos DOIS
   * catálogos: pharmacy_items para item_type='pharmacy' e warehouse_items para
   * 'warehouse'. Ambas as tabelas expõem id/code/name/unit.
   */
  async getWithItems(cartId: string): Promise<EmergencyCartWithItems> {
    const { data: cartRow, error: cartErr } = await supabase
      .from('emergency_carts').select('*').eq('id', cartId).single()
    if (cartErr) throw new Error('Erro ao carregar o carro: ' + cartErr.message)

    const { data: rows, error: itemsErr } = await supabase
      .from('emergency_cart_items')
      .select('*')
      .eq('cart_id', cartId)
      .order('created_at')
    if (itemsErr) throw new Error('Erro ao carregar o conteúdo do carro: ' + itemsErr.message)

    const list = (rows || []) as Array<Omit<EmergencyCartItem, 'item_name' | 'item_code' | 'item_unit'>>
    const names = await this.resolveItems(list)

    const items: EmergencyCartItem[] = list.map((r) => {
      const info = names.get(`${r.item_type}:${r.item_id}`)
      return {
        ...r,
        item_name: info?.name ?? 'Item não encontrado no catálogo',
        item_code: info?.code ?? null,
        item_unit: info?.unit ?? null,
      }
    })
    // Medicamentos primeiro, depois materiais; dentro de cada grupo por nome.
    items.sort((a, b) =>
      a.item_type === b.item_type
        ? a.item_name.localeCompare(b.item_name, 'pt-BR')
        : a.item_type === 'pharmacy' ? -1 : 1
    )

    return { cart: cartRow as EmergencyCart, items }
  }

  /** Busca id -> {name, code, unit} nos dois catálogos, em duas queries. */
  private async resolveItems(
    rows: Array<{ item_id: string; item_type: CartItemType }>
  ): Promise<Map<string, { name: string; code: string | null; unit: string | null }>> {
    const map = new Map<string, { name: string; code: string | null; unit: string | null }>()
    const pharmIds = Array.from(new Set(rows.filter((r) => r.item_type === 'pharmacy').map((r) => r.item_id)))
    const wareIds = Array.from(new Set(rows.filter((r) => r.item_type === 'warehouse').map((r) => r.item_id)))

    const [pharm, ware] = await Promise.all([
      pharmIds.length
        ? supabase.from('pharmacy_items').select('id, name, code, unit').in('id', pharmIds)
        : Promise.resolve({ data: [], error: null }),
      wareIds.length
        ? supabase.from('warehouse_items').select('id, name, code, unit').in('id', wareIds)
        : Promise.resolve({ data: [], error: null }),
    ])

    type Row = { id: string; name: string; code: string | null; unit: string | null }
    for (const p of ((pharm.data || []) as Row[])) {
      map.set(`pharmacy:${p.id}`, { name: p.name, code: p.code, unit: p.unit })
    }
    for (const w of ((ware.data || []) as Row[])) {
      map.set(`warehouse:${w.id}`, { name: w.name, code: w.code, unit: w.unit })
    }
    return map
  }

  /**
   * Buscador do dialog "Adicionar item": procura o termo nos DOIS catálogos
   * (medicamentos e materiais) e devolve a lista unificada e marcada por tipo.
   * Só itens ativos — o carro não deve receber item descontinuado.
   */
  async searchCatalog(term: string, limit = 20): Promise<CatalogOption[]> {
    const q = term.trim()
    if (q.length < 2) return []
    const like = `%${q}%`

    const [pharm, ware] = await Promise.all([
      supabase.from('pharmacy_items')
        .select('id, name, code, unit')
        .eq('is_active', true)
        .or(`name.ilike.${like},code.ilike.${like}`)
        .order('name')
        .limit(limit),
      supabase.from('warehouse_items')
        .select('id, name, code, unit')
        .eq('is_active', true)
        .or(`name.ilike.${like},code.ilike.${like}`)
        .order('name')
        .limit(limit),
    ])
    if (pharm.error) throw new Error('Erro ao buscar medicamentos: ' + pharm.error.message)
    if (ware.error) throw new Error('Erro ao buscar materiais: ' + ware.error.message)

    type Row = { id: string; name: string; code: string | null; unit: string | null }
    const opts: CatalogOption[] = [
      ...((pharm.data || []) as Row[]).map((r) => ({ ...r, item_type: 'pharmacy' as const })),
      ...((ware.data || []) as Row[]).map((r) => ({ ...r, item_type: 'warehouse' as const })),
    ]
    return opts.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  }

  /** Número de registro do carro — nasce vazio e é preenchido pelos usuários. */
  async updateRegistration(cartId: string, registrationNumber: string): Promise<EmergencyCart> {
    const { data, error } = await supabase
      .from('emergency_carts')
      .update({
        registration_number: registrationNumber.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cartId)
      .select('*')
      .single()
    if (error) throw new Error('Erro ao salvar o número de registro: ' + error.message)
    return data as EmergencyCart
  }

  async addItem(cartId: string, input: CartItemInput): Promise<EmergencyCartItem> {
    if (!input.item_id) throw new Error('Selecione o item.')
    if (input.quantity < 0) throw new Error('Quantidade não pode ser negativa.')
    const { data, error } = await supabase
      .from('emergency_cart_items')
      .insert({
        cart_id: cartId,
        item_id: input.item_id,
        item_type: input.item_type,
        quantity: input.quantity,
        min_quantity: input.min_quantity ?? null,
        batch_number: input.batch_number?.trim() || null,
        expiry_date: input.expiry_date || null,
        source_location_id: input.source_location_id || null,
      })
      .select('*')
      .single()
    if (error) throw new Error('Erro ao adicionar item ao carro: ' + error.message)
    return data as EmergencyCartItem
  }

  /** Edita o item já no carro (quantidade, lote, validade, origem). */
  async updateItem(itemRowId: string, input: Partial<Omit<CartItemInput, 'item_id' | 'item_type'>>): Promise<void> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.quantity !== undefined) {
      if (input.quantity < 0) throw new Error('Quantidade não pode ser negativa.')
      patch.quantity = input.quantity
    }
    if (input.min_quantity !== undefined) patch.min_quantity = input.min_quantity ?? null
    if (input.batch_number !== undefined) patch.batch_number = input.batch_number?.trim() || null
    if (input.expiry_date !== undefined) patch.expiry_date = input.expiry_date || null
    if (input.source_location_id !== undefined) patch.source_location_id = input.source_location_id || null

    const { error } = await supabase.from('emergency_cart_items').update(patch).eq('id', itemRowId)
    if (error) throw new Error('Erro ao atualizar item do carro: ' + error.message)
  }

  async removeItem(itemRowId: string): Promise<void> {
    const { error } = await supabase.from('emergency_cart_items').delete().eq('id', itemRowId)
    if (error) throw new Error('Erro ao remover item do carro: ' + error.message)
  }
}

export const emergencyCartsService = new EmergencyCartsService()
