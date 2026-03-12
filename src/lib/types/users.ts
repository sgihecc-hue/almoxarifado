type UserRole = 'solicitante' | 'gestor' | 'administrador'

export interface User {
  id: string
  email: string
  full_name: string
  role: UserRole
  department_id?: string | null
  department?: {
    id: string
    name: string
    code: string
  } | null
  created_at: string
  updated_at: string | null
  deleted_at: string | null
}