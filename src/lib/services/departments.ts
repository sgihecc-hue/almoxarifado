import { supabase } from '../supabase';
import type { Department } from '../types/departments';
import { dataBR } from '../utils/seguro';

/** Nome para comparar: sem acento, minúsculo, espaços simples. */
function chaveNome(nome: string): string {
  return nome.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

class DepartmentsService {
  /**
   * Recusa nome de setor repetido (ignorando maiúsculas, acentos e espaços).
   * Antes dava para criar "Almoxarifado" duas vezes — e o módulo do usuário
   * é decidido pelo NOME do setor.
   */
  private async garantirNomeLivre(nome: string, ignorarId?: string): Promise<void> {
    const chave = chaveNome(nome)
    if (!chave) throw new Error('Informe o nome do setor.')
    const { data, error } = await supabase.from('departments').select('id, name, is_active')
    if (error) throw new Error('Não foi possível conferir se o nome já existe: ' + error.message)
    const igual = (data || []).find((d: { id: string; name: string | null }) => d.id !== ignorarId && chaveNome(d.name ?? '') === chave) as
      { id: string; name: string; is_active?: boolean | null } | undefined
    if (igual) {
      throw new Error(igual.is_active === false
        ? `Já existe um setor desativado com este nome ("${igual.name}"). Reative-o em vez de criar outro.`
        : `Já existe um setor com este nome ("${igual.name}").`)
    }
  }

  async getAll(): Promise<Department[]> {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
        .eq('is_active', true)
        .order('name', { ascending: true });

      if (error) {
        console.error('Database error fetching departments:', error);
        throw new Error(`Database error fetching departments: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('DepartmentsService: Database error fetching departments:', error);
      throw error;
    }
  }

  async create(department: Omit<Department, 'id' | 'created_at'>): Promise<Department> {
    try {
      await this.garantirNomeLivre(department.name ?? '')
      const { data, error } = await supabase
        .from('departments')
        .insert(department)
        .select('*')
        .maybeSingle();

      if (error) {
        console.error('Database error creating department:', error);
        throw new Error('Erro ao criar setor: ' + error.message);
      }

      if (!data) {
        throw new Error('Setor não foi criado. Verifique suas permissões.');
      }

      return data;
    } catch (error) {
      console.error('DepartmentsService: Database error creating department:', error);
      throw error;
    }
  }

  async update(id: string, updates: Partial<Department>): Promise<Department> {
    try {
      if (typeof updates.name === 'string') await this.garantirNomeLivre(updates.name, id)
      const { data, error } = await supabase
        .from('departments')
        .update(updates)
        .eq('id', id)
        .select('*')
        .maybeSingle();

      if (error) {
        console.error('Database error updating department:', error);
        throw new Error('Erro ao atualizar setor: ' + error.message);
      }

      if (!data) {
        throw new Error('Setor não atualizado. Verifique suas permissões.');
      }

      return data;
    } catch (error) {
      console.error('DepartmentsService: Database error updating department:', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      // 1. Desvincular usuarios deste setor (set department_id = null)
      const { error: usersErr } = await supabase
        .from('users')
        .update({ department_id: null })
        .eq('department_id', id);

      if (usersErr) {
        console.warn('Aviso ao desvincular usuarios:', usersErr.message);
      }

      // 2. Soft delete: marca setor como inativo
      // Mantem o registro para que solicitacoes antigas continuem com referencia
      const { data, error } = await supabase
        .from('departments')
        .update({ is_active: false })
        .eq('id', id)
        .select('id');

      if (error) {
        console.error('Erro ao excluir setor:', error);
        throw new Error('Erro ao excluir setor: ' + error.message);
      }
      // RLS que recusa devolve 0 linhas sem erro: não é "excluído".
      if (!data || data.length === 0) {
        throw new Error('Setor não foi excluído: sem permissão ou setor não encontrado.');
      }
    } catch (error) {
      console.error('DepartmentsService: Database error deleting department:', error);
      throw error;
    }
  }

  async exportToCSV(departments: Department[]): Promise<string> {
    try {
      const headers = ['Nome', 'Descrição', 'Data de Criação']
      const rows = departments.map(dept => [
        dept.name,
        dept.description || 'Sem descrição',
        dataBR(dept.created_at)
      ])

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.join(','))
      ].join('\n')

      return csvContent
    } catch (error) {
      console.error('Error in exportToCSV:', error)
      throw new Error('Erro ao exportar departamentos para CSV')
    }
  }
}

export const departmentsService = new DepartmentsService();