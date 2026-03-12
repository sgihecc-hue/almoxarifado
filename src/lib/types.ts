export type UserRole = 'solicitante' | 'gestor' | 'administrador'

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
  updated_at?: string
  deleted_at?: string | null
}

export interface Item {
  id: string
  name: string
  description: string
  category: string
  unit: string
  min_stock: number
  current_stock: number
  lead_time_days?: number
}