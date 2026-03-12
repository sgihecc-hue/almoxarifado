import { supabase } from '../supabase';
import type { Department } from '../types/departments';

class DepartmentsService {
  async getAll(): Promise<Department[]> {
    try {
      const { data, error } = await supabase
        .from('departments')
        .select('*')
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
      const { data, error } = await supabase
        .from('departments')
        .insert(department)
        .select('*')
        .single();

      if (error) {
        console.error('Database error creating department:', error);
        throw new Error(`Database error creating department: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DepartmentsService: Database error creating department:', error);
      throw error;
    }
  }

  async update(id: string, updates: Partial<Department>): Promise<Department> {
    try {
      const { data, error } = await supabase
        .from('departments')
        .update(updates)
        .eq('id', id)
        .select('*')
        .single();

      if (error) {
        console.error('Database error updating department:', error);
        throw new Error(`Database error updating department: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('DepartmentsService: Database error updating department:', error);
      throw error;
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('departments')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Database error deleting department:', error);
        throw new Error(`Database error deleting department: ${error.message}`);
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
        new Date(dept.created_at).toLocaleDateString('pt-BR')
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