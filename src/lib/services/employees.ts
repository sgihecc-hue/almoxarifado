import { supabase } from '../supabase'
import type { Employee } from '../types/employees'

class EmployeesService {
  async getByMatricula(matricula: string): Promise<Employee | null> {
    try {
      if (!matricula || matricula.trim().length === 0) {
        return null
      }

      const { data, error } = await supabase
        .from('employees')
        .select(`
          *,
          department:departments(name)
        `)
        .eq('matricula', matricula.trim())
        .eq('is_active', true)
        .single()

      if (error) {
        if (error.code === 'PGRST116') {
          // No rows returned
          return null
        }
        console.error('Error fetching employee by matricula:', error)
        return null
      }

      return {
        ...data,
        department_name: data.department?.name || undefined
      } as Employee
    } catch (error) {
      console.error('EmployeesService: Error fetching employee:', error)
      return null
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
