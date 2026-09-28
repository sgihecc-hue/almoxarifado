import { supabase } from '../supabase'
import { buscarTodas, inicioDiaISO, fimDiaISO } from '../utils/seguro'
import type { RequestStatus, RequestType } from './requests'

export interface TVRequestItem {
  id: string
  item_type: 'pharmacy' | 'warehouse'
  item_id: string
  item_name: string
  item_code: string
  item_unit: string
  item_current_stock: number
  quantity: number
  approved_quantity?: number
  supplied_quantity?: number
  observation?: string
  is_checked: boolean
}

export interface TVRequest {
  id: string
  type: RequestType
  status: RequestStatus
  priority: 'low' | 'medium' | 'high'
  department: string
  department_id?: string
  destination_department?: string
  destination_department_id?: string
  requester_id: string
  requester_name: string
  request_number?: string
  justification?: string
  notes?: string
  created_at: string
  updated_at: string
  delivered_at?: string
  delivered_by?: string
  delivery_notes?: string
  received_at?: string
  received_by_employee_id?: string
  received_by_employee_matricula?: string
  items: TVRequestItem[]
}

// O painel de TV (rotas /tv/* sem login) e SO LEITURA. As acoes de escrita
// ("Saiu para entrega" / "Solicitacao concluida") mudavam o status direto,
// pulando a baixa com conferencia e os lotes; sem sessao o update afetava 0
// linhas e a TV mostrava "Concluida". Atender e pelo sistema (detalhe do pedido).
//
// Colunas explicitas: sem login o banco so libera estas (notes/justificativa
// podem ter nome e leito de paciente — ver migration 20260928110300).
const COLUNAS_TV = `
  id, type, status, priority, department_id, destination_department_id, requester_id, request_number, created_at, updated_at, delivered_at, received_at, completed_at, source_location_id,
  dept:departments!requests_department_id_fkey(id, name),
  dest_dept:departments!requests_destination_department_id_fkey(id, name),
  request_items(
    id,
    item_type,
    quantity,
    approved_quantity,
    supplied_quantity,
    observation,
    is_checked,
    pharmacy_item:pharmacy_items(id, name, code, unit, current_stock),
    warehouse_item:warehouse_items(id, name, code, unit, current_stock)
  )
`

export interface PeriodoTV {
  /** 'YYYY-MM-DD' (dia local, inclusive) */
  de?: string
  ate?: string
}

class TVRequestService {
  // statuses: quando informado, filtra no BANCO em vez de trazer tudo e
  // descartar no navegador. O painel de TV (autoRefresh a cada 60s, ligado
  // 24h) so mostra pending/approved/processing mas buscava os 200 pedidos
  // mais recentes de QUALQUER status pra depois jogar fora quase todos no
  // cliente — medido em ~230-290 KB por chamada, por painel, todo minuto
  // (~740 MB/dia so os dois paineis). tv-history.tsx precisa do historico
  // completo, por isso o filtro e opcional, nao embutido direto na query.
  // Erro vira excecao (a tela mostra o erro) — antes virava lista vazia.
  // periodo: filtro de data no banco pelo dia LOCAL (-03:00), paginado;
  // sem periodo, os 200 mais recentes (painel ao vivo).
  async getAll(type: RequestType, statuses?: RequestStatus[], periodo?: PeriodoTV): Promise<TVRequest[]> {
    {
      const montar = () => {
        let query = supabase
          .from('requests')
          .select(COLUNAS_TV)
          .eq('type', type)
        if (statuses && statuses.length > 0) query = query.in('status', statuses)
        if (periodo?.de) query = query.gte('created_at', inicioDiaISO(periodo.de))
        if (periodo?.ate) query = query.lte('created_at', fimDiaISO(periodo.ate))
        return query.order('created_at', { ascending: false }).order('id')
      }

      let requests: any[]
      if (periodo?.de || periodo?.ate) {
        requests = await buscarTodas<any>((de, ate) => montar().range(de, ate), { tamanho: 500 })
      } else {
        const { data, error } = await montar().limit(200)
        if (error) {
          console.error('TVRequestService: Error fetching requests:', error)
          throw new Error('Não foi possível carregar as solicitações.')
        }
        requests = data || []
      }

      // Nomes dos solicitantes via RPC (users não é mais legível por anon)
      const requesterIds = [...new Set((requests || []).map((r: any) => r.requester_id).filter(Boolean))]
      let nameMap: Record<string, string> = {}
      if (requesterIds.length > 0) {
        const { data: names } = await supabase.rpc('get_requester_names', { ids: requesterIds })
        if (names) nameMap = Object.fromEntries((names as any[]).map(n => [n.id, n.full_name]))
      }

      return (requests || []).map(req => {
        const items: TVRequestItem[] = (req.request_items || [])
          .filter((item: any) => item && item.id)
          .map((item: any) => {
            const source = item.item_type === 'pharmacy' ? item.pharmacy_item : item.warehouse_item
            return {
              id: item.id,
              item_type: item.item_type,
              item_id: source?.id || '',
              item_name: source?.name || 'Item desconhecido',
              item_code: source?.code || '',
              item_unit: source?.unit || 'UN',
              item_current_stock: source?.current_stock || 0,
              quantity: item.quantity || 0,
              approved_quantity: item.approved_quantity,
              supplied_quantity: item.supplied_quantity,
              observation: item.observation || '',
              is_checked: item.is_checked || false
            }
          })

        return {
          id: req.id,
          type: req.type,
          status: req.status,
          priority: req.priority || 'medium',
          department: req.dept?.name || 'Departamento Desconhecido',
          department_id: req.dept?.id || req.department_id,
          destination_department: req.dest_dept?.name || '',
          destination_department_id: req.dest_dept?.id || req.destination_department_id,
          requester_id: req.requester_id,
          requester_name: nameMap[req.requester_id] || 'Usuário Desconhecido',
          request_number: req.request_number,
          justification: req.justification,
          notes: req.notes,
          created_at: req.created_at,
          updated_at: req.updated_at,
          delivered_at: req.delivered_at,
          delivered_by: req.delivered_by,
          delivery_notes: req.delivery_notes,
          received_at: req.received_at,
          received_by_employee_id: req.received_by_employee_id,
          received_by_employee_matricula: req.received_by_employee_matricula,
          items
        } as TVRequest
      })
    }
  }

  async getById(id: string): Promise<TVRequest | null> {
    try {
      const { data: reqData, error } = await supabase
        .from('requests')
        .select(COLUNAS_TV)
        .eq('id', id)
        .single()

      if (error) {
        console.error('TVRequestService: Error fetching request:', error)
        if ((error as any).code === 'PGRST116') return null // nao existe
        throw new Error('Não foi possível carregar a solicitação.')
      }
      const req = reqData as any

      // Nome do solicitante via RPC (users não é mais legível por anon)
      let nameMap: Record<string, string> = {}
      if (req.requester_id) {
        const { data: names } = await supabase.rpc('get_requester_names', { ids: [req.requester_id] })
        if (names) nameMap = Object.fromEntries((names as any[]).map(n => [n.id, n.full_name]))
      }

      const items: TVRequestItem[] = (req.request_items || [])
        .filter((item: any) => item && item.id)
        .map((item: any) => {
          const source = item.item_type === 'pharmacy' ? item.pharmacy_item : item.warehouse_item
          return {
            id: item.id,
            item_type: item.item_type,
            item_id: source?.id || '',
            item_name: source?.name || 'Item desconhecido',
            item_code: source?.code || '',
            item_unit: source?.unit || 'UN',
            item_current_stock: source?.current_stock || 0,
            quantity: item.quantity || 0,
            approved_quantity: item.approved_quantity,
            supplied_quantity: item.supplied_quantity,
            observation: item.observation || '',
            is_checked: item.is_checked || false
          }
        })

      return {
        id: req.id,
        type: req.type,
        status: req.status,
        priority: req.priority || 'medium',
        department: req.dept?.name || 'Departamento Desconhecido',
        department_id: req.dept?.id || req.department_id,
        destination_department: req.dest_dept?.name || '',
        destination_department_id: req.dest_dept?.id || req.destination_department_id,
        requester_id: req.requester_id,
        requester_name: nameMap[req.requester_id] || 'Usuário Desconhecido',
        request_number: req.request_number,
        justification: req.justification,
        notes: req.notes,
        created_at: req.created_at,
        updated_at: req.updated_at,
        delivered_at: req.delivered_at,
        delivered_by: req.delivered_by,
        delivery_notes: req.delivery_notes,
        received_at: req.received_at,
        received_by_employee_id: req.received_by_employee_id,
        received_by_employee_matricula: req.received_by_employee_matricula,
        items
      } as TVRequest
    } catch (error) {
      console.error('TVRequestService: Error:', error)
      throw error
    }
  }
}

export const tvRequestService = new TVRequestService()
