import { supabase } from '@/lib/supabase'
import type { User } from '@/lib/types'
import { sanitizeInput } from '@/lib/utils/sanitize'

interface CreateUserData extends Partial<User> {
  password?: string
}

interface UserWithStatus extends User {
  status?: 'active' | 'inactive'
}

class UsersService {
  private static instance: UsersService

  private constructor() {}

  static getInstance(): UsersService {
    if (!UsersService.instance) {
      UsersService.instance = new UsersService()
    }
    return UsersService.instance
  }

  async getAll(): Promise<User[]> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          department:departments(
            id,
            name,
            description
          )
        `)
        .order('created_at', { ascending: false })

      if (error) throw error

      return (data || []).map(user => ({
        ...user,
        full_name: sanitizeInput(user.full_name || ''),
        email: sanitizeInput(user.email || ''),
        department_name: user.department?.name || null
      }))
    } catch (error) {
      console.error('Error fetching users:', error)
      throw error
    }
  }

  async getById(id: string): Promise<User> {
    try {
      const { data, error } = await supabase
        .from('users')
        .select(`
          *,
          department:departments(
            id,
            name,
            description
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      if (!data) throw new Error('User not found')

      return {
        ...data,
        full_name: sanitizeInput(data.full_name || ''),
        email: sanitizeInput(data.email || ''),
        department_name: data.department?.name || null
      }
    } catch (error) {
      console.error('Error fetching user:', error)
      throw error
    }
  }

  async create(userData: CreateUserData): Promise<User> {
    try {
      const { data: { user }, error: signUpError } = await supabase.auth.admin.createUser({
        email: userData.email!,
        password: userData.password || 'ChangeMe123!',
        email_confirm: true
      })

      if (signUpError) throw signUpError
      if (!user) throw new Error('Failed to create user')

      const { data, error } = await supabase
        .from('users')
        .insert([{
          id: user.id,
          email: userData.email,
          full_name: userData.full_name,
          role: userData.role || 'usuario',
          department_id: userData.department_id,
          status: 'active'
        }])
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      console.error('Error creating user:', error)
      throw error
    }
  }

  async update(id: string, userData: Partial<User>): Promise<User> {
    try {
      const { data, error } = await supabase
        .from('users')
        .update({
          full_name: userData.full_name,
          role: userData.role,
          department_id: userData.department_id
        })
        .eq('id', id)
        .select()
        .single()

      if (error) throw error
      return data
    } catch (error) {
      console.error('Error updating user:', error)
      throw error
    }
  }

  async deactivate(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('users')
        .update({ status: 'inactive' })
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      console.error('Error deactivating user:', error)
      throw error
    }
  }

  async activate(id: string): Promise<void> {
    try {
      const { error } = await supabase
        .from('users')
        .update({ status: 'active' })
        .eq('id', id)

      if (error) throw error
    } catch (error) {
      console.error('Error activating user:', error)
      throw error
    }
  }

  async adminChangePassword(userId: string, newPassword: string): Promise<void> {
    try {
      const apiUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user-password`

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userId,
          new_password: newPassword
        })
      })

      if (!response.ok) {
        const errorData = await response.json()
        console.error('Admin password update error:', errorData)
        throw new Error('Erro ao atualizar senha. Por favor, tente novamente.')
      }

      await response.json()
    } catch (error) {
      console.error('Error in adminChangePassword:', error)
      throw error instanceof Error ? error : new Error('Erro desconhecido ao alterar senha')
    }
  }

  async changePassword(_currentPassword: string, newPassword: string): Promise<void> {
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      })

      if (error) throw error
    } catch (error) {
      console.error('Error changing password:', error)
      throw error
    }
  }

  async exportToCSV(users: UserWithStatus[]): Promise<string> {
    try {
      const headers = ['Nome', 'E-mail', 'Função', 'Status', 'Data de Criação']
      const rows = users.map(user => [
        user.full_name,
        user.email,
        user.role,
        user.status === 'active' ? 'Ativo' : 'Inativo',
        new Date(user.created_at).toLocaleDateString('pt-BR')
      ])

      const csvContent = [
        headers.join(','),
        ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
      ].join('\n')

      return csvContent
    } catch (error) {
      console.error('Error exporting users to CSV:', error)
      throw error
    }
  }
}

export const usersService = UsersService.getInstance()
