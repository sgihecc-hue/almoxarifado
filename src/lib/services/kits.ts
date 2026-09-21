import { supabase } from '../supabase'
import { PHARMACY_STOCKS } from '../constants/stock-locations'

// Kits de enfermagem: conjunto fixo de MATERIAL pedido pelos Postos e atendido
// pela Farmacia Satelite Terreo. Spec:
// docs/superpowers/specs/2026-09-20-kits-enfermagem-design.md
//
// So material: a Satelite Terreo trabalha com o catalogo do almoxarifado
// (warehouse_items). Medicamento continua saindo por dispensacao, que e o fluxo
// com prescritor, fila de aprovacao e Livro de Controlados.

export const SAT_T_ID = PHARMACY_STOCKS.find((s) => s.code === 'SAT_T')!.id

export interface Kit {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface KitItem {
  id: string
  kit_id: string
  item_type: 'warehouse' | 'pharmacy'
  warehouse_item_id: string | null
  pharmacy_item_id: string | null
  quantity: number
  unit: string | null
  item_name?: string
}

/** Uma linha "paciente leva N kits". 5 kits = Joao 2 + Maria 3. */
export interface KitPatientLine {
  patient_id: string
  patient_name: string
  quantity: number
}

export interface PedidoKitLine {
  kit_id: string
  kit_name: string
  pacientes: KitPatientLine[]
}

export interface PedidoAvulsoLine {
  item_id: string
  item_name: string
  unit: string | null
  patient_id: string
  patient_name: string
  quantity: number
}

class KitsService {
  async list(includeInactive = false): Promise<Kit[]> {
    let q = supabase.from('kits').select('*').order('name')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw new Error('Erro ao listar kits: ' + error.message)
    return (data || []) as Kit[]
  }

  async create(input: { name: string; description?: string }): Promise<Kit> {
    if (!input.name.trim()) throw new Error('Nome do kit é obrigatório.')
    const { data, error } = await supabase
      .from('kits')
      .insert({ name: input.name.trim(), description: input.description?.trim() || null })
      .select('*')
      .single()
    if (error) throw new Error('Erro ao criar kit: ' + error.message)
    return data as Kit
  }

  async update(id: string, input: Partial<{ name: string; description: string; is_active: boolean }>): Promise<Kit> {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error('Nome do kit é obrigatório.')
      patch.name = input.name.trim()
    }
    if (input.description !== undefined) patch.description = input.description.trim() || null
    if (input.is_active !== undefined) patch.is_active = input.is_active
    const { data, error } = await supabase.from('kits').update(patch).eq('id', id).select('*').single()
    if (error) throw new Error('Erro ao atualizar kit: ' + error.message)
    return data as Kit
  }

  /** Composicao do kit, com o nome do material resolvido. */
  async listItems(kitId: string): Promise<KitItem[]> {
    const { data, error } = await supabase
      .from('kit_items')
      .select('*, warehouse_item:warehouse_items(name, unit)')
      .eq('kit_id', kitId)
    if (error) throw new Error('Erro ao listar itens do kit: ' + error.message)
    return ((data || []) as any[])
      .map((r) => ({
        ...r,
        item_name: r.warehouse_item?.name || 'Item',
        unit: r.unit || r.warehouse_item?.unit || null,
      }))
      .sort((a, b) => a.item_name.localeCompare(b.item_name, 'pt-BR')) as KitItem[]
  }

  /**
   * Regrava a composicao inteira (apaga e insere). O kit e pequeno e a tela
   * edita a lista toda de uma vez — diff item a item so traria complexidade.
   */
  async setItems(kitId: string, items: Array<{ item_id: string; quantity: number; unit?: string | null }>): Promise<void> {
    const { error: delErr } = await supabase.from('kit_items').delete().eq('kit_id', kitId)
    if (delErr) throw new Error('Erro ao limpar itens do kit: ' + delErr.message)
    if (items.length === 0) return
    const { error } = await supabase.from('kit_items').insert(
      items.map((i) => ({
        kit_id: kitId,
        item_type: 'warehouse',
        warehouse_item_id: i.item_id,
        quantity: i.quantity,
        unit: i.unit || null,
      })),
    )
    if (error) throw new Error('Erro ao gravar itens do kit: ' + error.message)
  }

  /**
   * O setor e de enfermagem? So esses pedem kit. Usa farmacia_setores_enfermagem,
   * a mesma lista da devolucao e da regra de pacientes (e a que a RPC confere).
   * O pedido vai sempre pra Satelite Terreo, qualquer que seja o setor.
   */
  async isSetorEnfermagem(departmentId: string | null | undefined): Promise<boolean> {
    if (!departmentId) return false
    const { data, error } = await supabase
      .from('farmacia_setores_enfermagem')
      .select('department_id')
      .eq('department_id', departmentId)
      .maybeSingle()
    if (error) return false
    return !!data
  }

  /**
   * Cria o pedido numa transacao: soma os itens (kits explodidos + avulsos),
   * grava o pedido de material com origem SAT_T e guarda kit/paciente.
   */
  async criarPedido(input: {
    department_id: string
    kits: PedidoKitLine[]
    avulsos: PedidoAvulsoLine[]
    priority?: string
    justification?: string
    notes?: string
  }): Promise<{ request_id: string; request_number: number; itens: number; kits: number }> {
    const { data, error } = await supabase.rpc('criar_pedido_enfermagem', {
      p_department_id: input.department_id,
      p_kits: input.kits.map((k) => ({
        kit_id: k.kit_id,
        pacientes: k.pacientes.map((p) => ({ patient_id: p.patient_id, quantity: p.quantity })),
      })),
      p_avulsos: input.avulsos.map((a) => ({
        item_id: a.item_id,
        patient_id: a.patient_id,
        quantity: a.quantity,
      })),
      p_priority: input.priority || 'medium',
      p_justification: input.justification?.trim() || null,
      p_notes: input.notes?.trim() || null,
    })
    if (error) throw error
    return data as any
  }

  /**
   * Satelite Terreo atende: baixa do ESTOQUE DELA (item_stocks SAT_T, com lote),
   * nunca do almoxarifado. Uma linha por lote; quantidade 0 = nao fornecido.
   */
  async atender(requestId: string, linhas: Array<{
    request_item_id: string
    quantity: number
    expiry_tracking_id?: string | null
  }>, notes?: string) {
    const { data, error } = await supabase.rpc('atender_pedido_enfermagem', {
      p_request_id: requestId,
      p_items: linhas.map((l) => ({
        request_item_id: l.request_item_id,
        quantity: l.quantity,
        expiry_tracking_id: l.expiry_tracking_id || null,
      })),
      p_notes: notes?.trim() || null,
    })
    if (error) throw error
    return data as { numero: number; itens: number; quantidade_total: number }
  }

  async recusar(requestId: string, motivo: string) {
    const { error } = await supabase.rpc('recusar_pedido_enfermagem', {
      p_request_id: requestId,
      p_reason: motivo,
    })
    if (error) throw error
  }

  /** Kits e pacientes de um pedido — bloco de leitura no detalhe. */
  async getKitsDoPedido(requestId: string) {
    const [kits, avulsos] = await Promise.all([
      supabase.from('request_kits').select('kit_name, patient_name, quantity').eq('request_id', requestId),
      supabase.from('request_item_patients').select('item_name, patient_name, quantity').eq('request_id', requestId),
    ])
    return {
      kits: (kits.data || []) as Array<{ kit_name: string; patient_name: string; quantity: number }>,
      avulsos: (avulsos.data || []) as Array<{ item_name: string; patient_name: string; quantity: number }>,
    }
  }
}

export const kitsService = new KitsService()
