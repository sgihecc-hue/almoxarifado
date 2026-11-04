import { supabase } from '../supabase'
import type { Employee } from '../types/employees'

class EmployeesService {
  async getByMatricula(matricula: string): Promise<Employee | null> {
    try {
      if (!matricula || matricula.trim().length === 0) {
        return null
      }

      const mat = matricula.trim()

      // Lookup via RPC security-definer (users/employees não são legíveis por anon;
      // a RPC entrega só o mínimo e funciona tanto no painel de TV público quanto logado)
      const { data, error } = await supabase.rpc('lookup_employee_by_matricula', { mat })

      if (!error && data && data.length > 0) {
        const e = data[0]
        return {
          id: e.id,
          matricula: e.matricula || mat,
          full_name: e.full_name,
          cargo: e.cargo,
          is_active: true,
          department_name: e.department_name || '',
          origem: e.origem === 'funcionario' ? 'funcionario' : 'usuario',
          created_at: '',
          updated_at: '',
        } as Employee
      }

      return null
    } catch (error) {
      console.error('EmployeesService: Error fetching employee:', error)
      return null
    }
  }

  // Busca por nome nos usuarios do sistema E na tabela employees (quem nao
  // tem login, planilha da Rafaela 04/11). Sem acento, via RPC.
  async searchByName(name: string): Promise<Employee[]> {
    try {
      if (!name || name.trim().length < 2) return []
      const { data, error } = await supabase.rpc('buscar_colaboradores', { q: name.trim() })
      if (error || !data) return []
      return (data as any[]).map(e => ({
        id: e.id,
        matricula: e.matricula || '',
        full_name: e.full_name,
        cargo: e.cargo,
        is_active: true,
        department_name: e.department_name || '',
        origem: e.origem === 'funcionario' ? 'funcionario' : 'usuario',
        created_at: '',
        updated_at: '',
      })) as Employee[]
    } catch (error) {
      console.error('EmployeesService: Error searching by name:', error)
      return []
    }
  }

  async getAll(): Promise<Employee[]> {
    try {
      const { data, error } = await supabase
        .from('employees')
        .select(`
          *,
          department:departments(name)
        `)
        .eq('is_active', true)
        .order('full_name', { ascending: true })

      if (error) {
        console.error('Error fetching employees:', error)
        return []
      }

      return (data || []).map(emp => ({
        ...emp,
        department_name: emp.department?.name || undefined
      })) as Employee[]
    } catch (error) {
      console.error('EmployeesService: Error fetching employees:', error)
      return []
    }
  }
}

export const employeesService = new EmployeesService()
