import { supabase } from '../supabase'
import { fimDiaISO, inicioDiaISO } from '../utils/seguro'

export type AuditOrigem = 'audit' | 'stock'

export interface AuditLogEntry {
  ts: string
  actor_id: string | null
  actor_name: string | null
  origem: AuditOrigem
  action: string
  entity: string
  entity_id: string
  details: Record<string, any> | null
}

export interface AuditLogFilters {
  dateFrom?: string
  dateTo?: string
  actorId?: string
  origem?: AuditOrigem
  entity?: string
  action?: string
  search?: string
  limit?: number
  offset?: number
}

class AuditLogService {
  async list(filters: AuditLogFilters = {}): Promise<AuditLogEntry[]> {
    // Busca e filtros NO SERVIDOR (antes: 500 linhas mais recentes e busca no
    // navegador — ~17h de cobertura; evento mais antigo "nao existia").
    // Datas com fuso -03:00. Paginado por offset/limit ("Carregar mais").
    const limite = filters.limit ?? 500
    const de = filters.offset ?? 0
    let q = supabase
      .from('v_global_audit_log')
      .select('ts, actor_id, actor_name, origem, action, entity, entity_id, details')
      .order('ts', { ascending: false })
      .order('entity_id', { ascending: true })

    if (filters.dateFrom) q = q.gte('ts', inicioDiaISO(filters.dateFrom))
    if (filters.dateTo) q = q.lte('ts', fimDiaISO(filters.dateTo))
    if (filters.actorId) q = q.eq('actor_id', filters.actorId)
    if (filters.origem) q = q.eq('origem', filters.origem)
    if (filters.entity) q = q.eq('entity', filters.entity)
    if (filters.action) q = q.eq('action', filters.action)
    if (filters.search?.trim()) {
      const termo = filters.search.trim().replace(/[%_*\\]/g, ' ')
      q = q.ilike('busca_texto', `%${termo}%`)
    }

    const { data, error } = await q.range(de, de + limite - 1)
    if (error) throw error
    return (data || []) as AuditLogEntry[]
  }

  async listActors(): Promise<Array<{ id: string; full_name: string }>> {
    const { data, error } = await supabase
      .from('users')
      .select('id, full_name')
      .order('full_name')
    if (error) throw error
    return (data || []) as Array<{ id: string; full_name: string }>
  }
}

export const auditLogService = new AuditLogService()
