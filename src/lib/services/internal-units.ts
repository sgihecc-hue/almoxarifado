import { supabase } from '../supabase'

/**
 * Unidades internas = setores do hospital (tabela `departments`).
 *
 * O almoxarifado já consome essa tabela via `departmentsService` (que só lista
 * setores ativos e é usado em telas de solicitação/saída). Este serviço é um
 * CRUD separado, com a mesma cara do de unidades externas, para a tela de
 * cadastro da farmácia — assim nada do fluxo do almoxarifado muda.
 *
 * Atenção: as colunas reais são `name` / `description` (não `nome`/`descricao`).
 */
export interface InternalUnit {
  id: string
  name: string
  description: string | null
  is_active: boolean
  created_at: string
}

class InternalUnitsService {
  async list(includeInactive = false): Promise<InternalUnit[]> {
    let q = supabase.from('departments').select('*').order('name')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw new Error('Erro ao listar unidades internas: ' + error.message)
    return (data || []) as InternalUnit[]
  }

  async create(input: { name: string; description?: string }): Promise<InternalUnit> {
    if (!input.name.trim()) throw new Error('Nome é obrigatório.')
    const { data, error } = await supabase
      .from('departments')
      .insert({ name: input.name.trim(), description: input.description?.trim() || null })
      .select('*')
      .single()
    if (error) throw new Error('Erro ao criar unidade interna: ' + error.message)
    return data as InternalUnit
  }

  async update(
    id: string,
    input: Partial<{ name: string; description: string; is_active: boolean }>,
  ): Promise<InternalUnit> {
    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error('Nome é obrigatório.')
      patch.name = input.name.trim()
    }
    if (input.description !== undefined) patch.description = input.description.trim() || null
    if (input.is_active !== undefined) patch.is_active = input.is_active
    const { data, error } = await supabase
      .from('departments').update(patch).eq('id', id).select('*').single()
    if (error) throw new Error('Erro ao atualizar unidade interna: ' + error.message)
    return data as InternalUnit
  }

  // Desativação é soft delete: o setor some das listas mas continua referenciado
  // por solicitações/saídas antigas.
  async deactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from('departments')
      .update({ is_active: false })
      .eq('id', id)
    if (error) throw new Error('Erro ao desativar: ' + error.message)
  }
}

export const internalUnitsService = new InternalUnitsService()
