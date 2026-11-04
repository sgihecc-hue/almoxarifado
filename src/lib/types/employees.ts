export interface Employee {
  id: string
  matricula: string
  full_name: string
  department_id?: string | null
  department_name?: string
  cargo?: string | null
  is_active: boolean
  // 'funcionario' = so na tabela employees (sem login); id nao e de users.
  origem?: 'usuario' | 'funcionario'
  created_at: string
  updated_at: string
}
