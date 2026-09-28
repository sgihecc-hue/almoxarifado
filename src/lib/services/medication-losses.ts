import { supabase } from '@/lib/supabase'
import { exigirLinhas } from '@/lib/utils/seguro'

export type MotivoPerda =
  | 'Vencimento'
  | 'Quebra'
  | 'Avaria'
  | 'Desvio'
  | 'Contaminação'
  | 'Recolhimento'
  | 'Outro'

export interface MedicationLoss {
  id: string
  item_id: string | null
  item_nome: string
  stock_location_id: string | null
  batch_number: string | null
  expiry_date: string | null
  quantity: number
  motivo: string
  documento: string | null
  observacao: string | null
  is_controlado: boolean | null
  responsavel_nome: string | null
  created_by: string | null
  created_at: string
  // Saida de estoque gerada pela perda (nulo nas perdas antigas, que nao baixaram).
  movement_id?: string | null
  expiry_tracking_id?: string | null
}

export interface CreateMedicationLossData {
  // Lote do estoque escolhido (obrigatorio para registrar: a perda baixa o lote)
  expiry_tracking_id?: string | null
  item_id?: string | null
  item_nome: string
  stock_location_id?: string | null
  batch_number?: string | null
  expiry_date?: string | null
  quantity: number
  motivo: string
  documento?: string | null
  observacao?: string | null
  is_controlado?: boolean | null
  responsavel_nome?: string | null
}

export type UpdateMedicationLossData = Partial<CreateMedicationLossData>

class MedicationLossesService {
  private static instance: MedicationLossesService
  static getInstance() {
    if (!MedicationLossesService.instance) {
      MedicationLossesService.instance = new MedicationLossesService()
    }
    return MedicationLossesService.instance
  }

  async getAll(): Promise<MedicationLoss[]> {
    const { data, error } = await supabase
      .from('medication_losses')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('Error listing medication losses:', error)
      throw new Error(error.message)
    }

    return (data || []) as MedicationLoss[]
  }

  /**
   * Registra a perda E baixa o estoque (saldo do local + lote) numa transacao
   * (RPC registrar_perda). `chave` evita gravar duas vezes no duplo clique.
   */
  async create(payload: CreateMedicationLossData, chave?: string): Promise<{ id: string }> {
    const { data, error } = await supabase.rpc('registrar_perda', {
      p_item_id: payload.item_id || null,
      p_local_id: payload.stock_location_id || null,
      p_lote_id: payload.expiry_tracking_id || null,
      p_quantidade: payload.quantity,
      p_motivo: payload.motivo,
      p_documento: payload.documento?.trim() || null,
      p_observacao: payload.observacao?.trim() || null,
      p_responsavel_nome: payload.responsavel_nome?.trim() || null,
      p_chave: chave ?? null,
    })
    if (error) {
      console.error('Error creating medication loss:', error)
      throw error
    }
    return { id: (data as any).id }
  }

  /**
   * Edicao: so campos de texto (motivo, documento, observacao, responsavel).
   * Item/local/lote/quantidade de perda que ja baixou estoque ficam travados no
   * banco. Sem permissao (RLS) o banco devolve 0 linhas: vira erro claro.
   */
  async update(id: string, payload: UpdateMedicationLossData): Promise<void> {
    const patch: Record<string, unknown> = {}
    if (payload.motivo !== undefined) patch.motivo = payload.motivo
    if (payload.documento !== undefined) patch.documento = payload.documento?.trim() || null
    if (payload.observacao !== undefined) patch.observacao = payload.observacao?.trim() || null
    if (payload.responsavel_nome !== undefined) patch.responsavel_nome = payload.responsavel_nome?.trim() || null

    const r = await supabase
      .from('medication_losses')
      .update(patch)
      .eq('id', id)
      .select('id')
    exigirLinhas(r, 'Não foi possível salvar: só gestor ou administrador pode editar perdas.')
  }

  /** Exclusao (so administrador): se a perda baixou estoque, devolve saldo e lote. */
  async remove(id: string, motivo: string): Promise<void> {
    const { error } = await supabase.rpc('excluir_perda', { p_id: id, p_motivo: motivo })
    if (error) {
      console.error('Error deleting medication loss:', error)
      throw error
    }
  }
}

export const medicationLossesService = MedicationLossesService.getInstance()
