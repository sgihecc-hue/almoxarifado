import { supabase } from '@/lib/supabase'
import type { User } from '@/lib/types'
import { sanitizeInput } from '@/lib/utils/sanitize'
import { dataBR, exigirLinhas } from '@/lib/utils/seguro'

interface CreateUserData extends Partial<User> {
  password?: string
}

interface UserWithStatus extends User {
  status?: 'active' | 'inactive'
}

/**
 * Usuário ativo = sem deleted_at E is_active diferente de false. Antes a tela
 * olhava só deleted_at e mostrava como "Ativo" quem tinha is_active=false.
 */
export function usuarioAtivo(u: Pick<User, 'deleted_at' | 'is_active'>): boolean {
  return !u.deleted_at && u.is_active !== false
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

  // Criar conta exige service_role, que o navegador não tem: antes isto chamava
  // supabase.auth.admin.createUser com a chave anon e sempre falhava (e ainda
  // gravava a coluna inexistente `status`). Agora vai pela Edge Function
  // admin-create-user, que confere se quem chama é administrador.
  async create(userData: CreateUserData & { cpf?: string }): Promise<User> {
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.')

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-create-user`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name: userData.full_name,
          role: userData.role,
          department_id: userData.department_id || null,
          password: userData.password,
          cpf: userData.cpf || '',
          email: userData.email || '',
        }),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || 'Erro ao criar usuário. Tente novamente.')
      return body.user as User
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

      if (error) throw error
      // RLS/gatilho que recusa em silêncio devolve 0 linhas: não é "sucesso".
      if (!data || data.length === 0) {
        throw new Error('Não foi possível salvar: sem permissão ou usuário não encontrado.')
      }
      return data[0] as User
    } catch (error) {
      console.error('Error updating user:', error)
      throw error
    }
  }

  /**
   * Desativa (active=false) ou reativa (active=true) um usuário.
   *
   * Vai pela Edge Function admin-set-user-active, que bane/desbane a conta no
   * servidor de login E marca is_active/deleted_at. Antes só gravava deleted_at:
   * o usuário "desativado" continuava entrando.
   *
   * Se a função ainda não estiver instalada no servidor, grava só o cadastro
   * (o app já recusa perfil inativo ao entrar) e devolve um AVISO para a tela
   * dizer que o bloqueio no servidor de login ficou pendente.
   */
  async setActive(id: string, active: boolean): Promise<{ aviso?: string }> {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.')

    let response: Response
    try {
      response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-set-user-active`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId: id, active }),
      })
    } catch {
      throw new Error('Sem conexão com o servidor. Nada foi alterado; tente de novo.')
    }

    const body = await response.json().catch(() => ({})) as { error?: string; msg?: string }
    if (response.ok) return {}

    // A função responde sempre { error }. { msg } (ou 404) vem do roteador de
    // funções quando a pasta admin-set-user-active não existe no servidor.
    const funcaoAusente = response.status === 404 || (!body.error && typeof body.msg === 'string' &&
      /boot|not found|no such file|could not find|failed to/i.test(body.msg))
    if (!funcaoAusente) {
      throw new Error(body.error || body.msg || `Erro ${response.status} ao ${active ? 'reativar' : 'desativar'} o usuário.`)
    }

    const r = await supabase
      .from('users')
      .update({ is_active: active, deleted_at: active ? null : new Date().toISOString() })
      .eq('id', id)
      .select('id')
    exigirLinhas(r, 'Não foi possível alterar o usuário: sem permissão ou usuário não encontrado.')
    return {
      aviso: active
        ? 'Usuário reativado no cadastro, mas o desbloqueio no servidor de login está pendente (função admin-set-user-active não instalada). Se ele não conseguir entrar, avise o suporte.'
        : 'Usuário desativado no cadastro (o sistema já recusa a entrada dele), mas o bloqueio no servidor de login está pendente (função admin-set-user-active não instalada). Avise o suporte.',
    }
  }

  async deactivate(id: string): Promise<{ aviso?: string }> {
    return this.setActive(id, false)
  }

  async activate(id: string): Promise<{ aviso?: string }> {
    return this.setActive(id, true)
  }

  async adminChangePassword(userId: string, newPassword: string): Promise<void> {
    try {
      // A função identifica o administrador pelo token da SESSÃO. Antes ia a
      // chave anon no Authorization (getUser falhava -> 401) e os campos
      // user_id/new_password, enquanto a função lê userId/newPassword.
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.access_token) throw new Error('Sessão expirada. Entre novamente.')

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/admin-update-user-password`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${session.access_token}`,
          'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ userId, newPassword })
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        console.error('Admin password update error:', body)
        throw new Error(body?.error || 'Erro ao atualizar senha. Por favor, tente novamente.')
      }
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
        (user.status ? user.status === 'active' : usuarioAtivo(user)) ? 'Ativo' : 'Inativo',
        dataBR(user.created_at)
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
