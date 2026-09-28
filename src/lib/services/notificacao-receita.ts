// =====================================================================
// Notificação de Receita (Portaria 344/98)
// Tabela notificacao_receita — registro de receituário controlado
// =====================================================================

import { exigirLinhas } from '@/lib/utils/seguro'
import { supabase } from '@/lib/supabase'

export type TipoNotificacao = 'A' | 'B' | 'C_ESPECIAL'

export interface NotificacaoReceita {
  id: string
  tipo: TipoNotificacao
  subtipo: string | null
  numero: string
  serie_talao: string | null
  paciente_id: string | null
  paciente_nome: string
  prescritor_nome: string | null
  prescritor_registro: string | null
  prescritor_uf: string | null
  data_prescricao: string | null
  data_dispensacao: string | null
  dispensation_id: string | null
  item_nome: string | null
  quantidade: string | null
  retida: boolean | null
  observacao: string | null
  created_by: string | null
  created_at: string
}

export interface CreateNotificacaoReceitaData {
  tipo: TipoNotificacao
  subtipo?: string | null
  numero: string
  serie_talao?: string | null
  paciente_id?: string | null
  paciente_nome: string
  prescritor_nome?: string | null
  prescritor_registro?: string | null
  prescritor_uf?: string | null
  data_prescricao?: string | null
  data_dispensacao?: string | null
  dispensation_id?: string | null
  item_nome?: string | null
  quantidade?: string | null
  retida?: boolean | null
  observacao?: string | null
}

export type UpdateNotificacaoReceitaData = Partial<CreateNotificacaoReceitaData>

class NotificacaoReceitaService {
  private static instance: NotificacaoReceitaService
  static getInstance(): NotificacaoReceitaService {
    if (!NotificacaoReceitaService.instance) {
      NotificacaoReceitaService.instance = new NotificacaoReceitaService()
    }
    return NotificacaoReceitaService.instance
  }

  async getAll(): Promise<NotificacaoReceita[]> {
    const { data, error } = await supabase
      .from('notificacao_receita')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500)

    if (error) {
      console.error('Error listing notificacao_receita:', error)
      throw new Error(error.message)
    }

    return (data || []) as NotificacaoReceita[]
  }

  async create(payload: CreateNotificacaoReceitaData): Promise<NotificacaoReceita> {
    const { data: authData } = await supabase.auth.getUser()

    const { data, error } = await supabase
      .from('notificacao_receita')
      .insert({
        tipo: payload.tipo,
        subtipo: payload.subtipo?.trim() || null,
        numero: payload.numero.trim(),
        serie_talao: payload.serie_talao?.trim() || null,
        paciente_id: payload.paciente_id || null,
        paciente_nome: payload.paciente_nome.trim(),
        prescritor_nome: payload.prescritor_nome?.trim() || null,
        prescritor_registro: payload.prescritor_registro?.trim() || null,
        prescritor_uf: payload.prescritor_uf?.trim() || null,
        data_prescricao: payload.data_prescricao || null,
        data_dispensacao: payload.data_dispensacao || null,
        dispensation_id: payload.dispensation_id || null,
        item_nome: payload.item_nome?.trim() || null,
        quantidade: payload.quantidade?.trim() || null,
        retida: payload.retida ?? true,
        observacao: payload.observacao?.trim() || null,
        created_by: authData?.user?.id || null,
      })
      .select('*')
      .single()

    if (error) {
      console.error('Error creating notificacao_receita:', error)
      throw new Error(error.message)
    }

    return data as NotificacaoReceita
  }

  async update(id: string, payload: UpdateNotificacaoReceitaData): Promise<NotificacaoReceita> {
    const patch: Record<string, unknown> = {}

    if (payload.tipo !== undefined) patch.tipo = payload.tipo
    if (payload.subtipo !== undefined) patch.subtipo = payload.subtipo?.trim() || null
    if (payload.numero !== undefined) patch.numero = payload.numero.trim()
    if (payload.serie_talao !== undefined) patch.serie_talao = payload.serie_talao?.trim() || null
    if (payload.paciente_id !== undefined) patch.paciente_id = payload.paciente_id || null
    if (payload.paciente_nome !== undefined) patch.paciente_nome = payload.paciente_nome.trim()
    if (payload.prescritor_nome !== undefined) patch.prescritor_nome = payload.prescritor_nome?.trim() || null
    if (payload.prescritor_registro !== undefined) patch.prescritor_registro = payload.prescritor_registro?.trim() || null
    if (payload.prescritor_uf !== undefined) patch.prescritor_uf = payload.prescritor_uf?.trim() || null
    if (payload.data_prescricao !== undefined) patch.data_prescricao = payload.data_prescricao || null
    if (payload.data_dispensacao !== undefined) patch.data_dispensacao = payload.data_dispensacao || null
    if (payload.dispensation_id !== undefined) patch.dispensation_id = payload.dispensation_id || null
    if (payload.item_nome !== undefined) patch.item_nome = payload.item_nome?.trim() || null
    if (payload.quantidade !== undefined) patch.quantidade = payload.quantidade?.trim() || null
    if (payload.retida !== undefined) patch.retida = payload.retida ?? true
    if (payload.observacao !== undefined) patch.observacao = payload.observacao?.trim() || null

    const { data, error } = await supabase
      .from('notificacao_receita')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (error) {
      console.error('Error updating notificacao_receita:', error)
      throw new Error(error.message)
    }

    return data as NotificacaoReceita
  }

  async remove(id: string): Promise<void> {
    const r = await supabase
      .from('notificacao_receita')
      .delete()
      .eq('id', id)
      .select('id')

    if (r.error) {
      console.error('Error deleting notificacao_receita:', r.error)
      throw new Error(r.error.message)
    }
    // RLS negando o DELETE devolve 0 linhas sem erro: avisa em vez de "sumir".
    exigirLinhas(r, 'Não foi possível excluir: sem permissão ou registro não encontrado.')
  }
}

export const notificacaoReceitaService = NotificacaoReceitaService.getInstance()
