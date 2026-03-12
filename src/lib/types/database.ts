export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          full_name: string
          role: 'solicitante' | 'gestor' | 'administrador'
          created_at: string
          updated_at: string | null
        }
        Insert: {
          id: string
          email: string
          full_name: string
          role: 'solicitante' | 'gestor' | 'administrador'
          created_at?: string
          updated_at?: string | null
        }
        Update: {
          id?: string
          email?: string
          full_name?: string
          role?: 'solicitante' | 'gestor' | 'administrador'
          created_at?: string
          updated_at?: string | null
        }
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
    }
  }
}