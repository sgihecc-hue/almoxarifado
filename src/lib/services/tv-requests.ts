import { supabase } from '../supabase'
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

export interface SuppliedItemData {
  id: string
  supplied_quantity: number
  observation: string
  is_checked: boolean
}

class TVRequestService {
  async getAll(type: RequestType): Promise<TVRequest[]> {
    try {
      const { data: requests, error } = await supabase
        .from('requests')
        .select(`
          *,
          requester:users!requests_requester_id_fkey(full_name),
          dept:departments!requests_department_id_fkey(id, name),
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
        `)
        .eq('type', type)
        .order('created_at', { ascending: false })
        .limit(200)

      if (error) {
        console.error('TVRequestService: Error fetching requests:', error)
        return []
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
          requester_id: req.requester_id,
          requester_name: req.requester?.full_name || 'Usuário Desconhecido',
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
    } catch (error) {
      console.error('TVRequestService: Error:', error)
      return []
    }
  }

  async getById(id: string): Promise<TVRequest | null> {
    try {
      const { data: req, error } = await supabase
        .from('requests')
        .select(`
          *,
          requester:users!requests_requester_id_fkey(full_name),
          dept:departments!requests_department_id_fkey(id, name),
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
        `)
        .eq('id', id)
        .single()

      if (error) {
        console.error('TVRequestService: Error fetching request:', error)
        return null
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
        requester_id: req.requester_id,
        requester_name: req.requester?.full_name || 'Usuário Desconhecido',
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
      return null
    }
  }

  async markAsDelivered(id: string, suppliedItems: SuppliedItemData[], deliveryNotes?: string): Promise<boolean> {
    try {
      // Update each request item with supplied data
      for (const item of suppliedItems) {
        const { error: itemError } = await supabase
          .from('request_items')
          .update({
            supplied_quantity: item.supplied_quantity,
            observation: item.observation,
            is_checked: item.is_checked
          })
          .eq('id', item.id)

        if (itemError) {
          console.error('Error updating request item:', itemError)
          return false
        }
      }

      // Update request status to delivered
      const updateData: any = {
        status: 'delivered',
        delivered_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }

      if (deliveryNotes) {
        updateData.delivery_notes = deliveryNotes
      }

      const { error } = await supabase
        .from('requests')
        .update(updateData)
        .eq('id', id)

      if (error) {
        console.error('Error marking request as delivered:', error)
        return false
      }

      // Record status change in history
      await supabase.from('request_status_history').insert({
        request_id: id,
        status: 'delivered',
        old_status: 'processing',
        new_status: 'delivered',
        notes: 'Saiu para entrega via Painel TV'
      })

      return true
    } catch (error) {
      console.error('TVRequestService: Error marking as delivered:', error)
      return false
    }
  }

  async completeRequest(id: string, employeeMatricula: string, employeeId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('requests')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          received_at: new Date().toISOString(),
          received_by_employee_id: employeeId,
          received_by_employee_matricula: employeeMatricula,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)

      if (error) {
        console.error('Error completing request:', error)
        return false
      }

      // Record status change in history
      await supabase.from('request_status_history').insert({
        request_id: id,
        status: 'completed',
        old_status: 'delivered',
        new_status: 'completed',
        notes: `Entrega confirmada por matrícula ${employeeMatricula} via Painel TV`
      })

      return true
    } catch (error) {
      console.error('TVRequestService: Error completing request:', error)
      return false
    }
  }
}

export const tvRequestService = new TVRequestService()
