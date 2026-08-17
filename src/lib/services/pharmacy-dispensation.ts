import { supabase } from '../supabase'
import type {
  PharmacyDispensation,
  CreateDispensationData,
} from '../types/dispensation'

class PharmacyDispensationService {
  private static instance: PharmacyDispensationService

  private constructor() {}

  static getInstance(): PharmacyDispensationService {
    if (!PharmacyDispensationService.instance) {
      PharmacyDispensationService.instance = new PharmacyDispensationService()
    }
    return PharmacyDispensationService.instance
  }

  async getAll(filters?: {
    dateFrom?: string
    dateTo?: string
    search?: string
    // Isolamento por estoque: quando informado, lista SÓ as dispensações
    // feitas a partir deste local (pharmacy_dispensations.source_location_id).
    locationId?: string
  }): Promise<PharmacyDispensation[]> {
    try {
      let query = supabase
        .from('pharmacy_dispensations')
        .select(`
          *,
          items:pharmacy_dispensation_items(
            id,
            item_id,
            quantity,
            expiry_tracking_id,
            batch_number,
            expiry_date,
            item:pharmacy_items(
              id,
              name,
              code,
              unit
            )
          )
        `)
        .order('created_at', { ascending: false })

      if (filters?.dateFrom) {
        query = query.gte('created_at', `${filters.dateFrom}T00:00:00`)
      }
      if (filters?.dateTo) {
        query = query.lte('created_at', `${filters.dateTo}T23:59:59`)
      }
      if (filters?.locationId) {
        query = query.eq('source_location_id', filters.locationId)
      }

      const { data, error } = await query

      if (error) throw error
      if (!data) return []

      // Get user names for created_by
      const userIds = [...new Set(data.map((d: any) => d.created_by).filter(Boolean))]
      let userMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', userIds)
        if (users) {
          userMap = Object.fromEntries(users.map((u: any) => [u.id, u.full_name]))
        }
      }

      let results = data.map((d: any) => ({
        id: d.id,
        dispensation_number: d.dispensation_number,
        tipo: (d.tipo ?? 'prescricao') as 'prescricao' | 'requisicao',
        patient_name: d.patient_name,
        patient_bed_room: d.patient_bed_room,
        medical_record_number: d.medical_record_number,
        prescribing_doctor: d.prescribing_doctor,
        prescription_number: d.prescription_number,
        sector: d.sector,
        notes: d.notes,
        status: d.status,
        created_by: d.created_by,
        created_by_name: userMap[d.created_by] || 'Desconhecido',
        created_at: d.created_at,
        cancelled_at: d.cancelled_at,
        cancellation_reason: d.cancellation_reason,
        items: (d.items || []).map((i: any) => ({
          id: i.id,
          item_id: i.item_id,
          item_name: i.item?.name || '',
          item_code: i.item?.code || '',
          item_unit: i.item?.unit || 'UN',
          quantity: i.quantity,
          // Rastreabilidade: lote/validade gravados na baixa (podem ser nulos
          // em dispensações antigas, anteriores ao abate por lote).
          expiry_tracking_id: i.expiry_tracking_id ?? null,
          batch_number: i.batch_number ?? null,
          expiry_date: i.expiry_date ?? null,
        })),
      })) as PharmacyDispensation[]

      // Client-side search filter
      if (filters?.search?.trim()) {
        const q = filters.search.toLowerCase()
        results = results.filter(
          (d) =>
            (d.patient_name || '').toLowerCase().includes(q) ||
            (d.medical_record_number || '').toLowerCase().includes(q) ||
            (d.prescribing_doctor || '').toLowerCase().includes(q) ||
            (d.prescription_number || '').toLowerCase().includes(q) ||
            (d.sector || '').toLowerCase().includes(q) ||
            String(d.dispensation_number).includes(q)
        )
      }

      return results
    } catch (error) {
      console.error('Error fetching dispensations:', error)
      return []
    }
  }

  async getById(id: string): Promise<PharmacyDispensation | null> {
    try {
      const { data, error } = await supabase
        .from('pharmacy_dispensations')
        .select(`
          *,
          items:pharmacy_dispensation_items(
            id,
            item_id,
            quantity,
            expiry_tracking_id,
            batch_number,
            expiry_date,
            item:pharmacy_items(
              id,
              name,
              code,
              unit
            )
          )
        `)
        .eq('id', id)
        .single()

      if (error) throw error
      if (!data) return null

      // Get user name
      let createdByName = 'Desconhecido'
      if (data.created_by) {
        const { data: userData } = await supabase
          .from('users')
          .select('full_name')
          .eq('id', data.created_by)
          .single()
        if (userData) createdByName = userData.full_name
      }

      return {
        id: data.id,
        dispensation_number: data.dispensation_number,
        tipo: (data.tipo ?? 'prescricao') as 'prescricao' | 'requisicao',
        patient_name: data.patient_name,
        patient_bed_room: data.patient_bed_room,
        medical_record_number: data.medical_record_number,
        prescribing_doctor: data.prescribing_doctor,
        prescription_number: data.prescription_number,
        prescription_date: data.prescription_date ?? null,
        rm_date: data.rm_date ?? null,
        sector: data.sector,
        notes: data.notes,
        status: data.status,
        created_by: data.created_by,
        created_by_name: createdByName,
        created_at: data.created_at,
        cancelled_at: data.cancelled_at,
        cancellation_reason: data.cancellation_reason,
        items: (data.items || []).map((i: any) => ({
          id: i.id,
          item_id: i.item_id,
          item_name: i.item?.name || '',
          item_code: i.item?.code || '',
          item_unit: i.item?.unit || 'UN',
          quantity: i.quantity,
          // Rastreabilidade: lote/validade gravados na baixa (podem ser nulos
          // em dispensações antigas, anteriores ao abate por lote).
          expiry_tracking_id: i.expiry_tracking_id ?? null,
          batch_number: i.batch_number ?? null,
          expiry_date: i.expiry_date ?? null,
        })),
      }
    } catch (error) {
      console.error('Error fetching dispensation:', error)
      return null
    }
  }

  async create(
    data: CreateDispensationData,
    opts: { sourceLocationCode?: string } = {},
  ): Promise<{ id: string; needsApproval?: boolean } | null> {
    try {
      // Criação atômica no banco: a RPC criar_dispensacao insere cabeçalho +
      // itens e, se não precisar de aprovação, já baixa o estoque pelo ledger
      // (PRESCRICAO out@<source> + lote) numa única transação. needsApproval é
      // decidido no servidor (MAV / controlado / antimicrobiano).
      // p_tipo: 'prescricao' (paciente+prescritor) ou 'requisicao' (só setor).
      // p_source_location_code: CAF / SAT_1 / SAT_2 / SAT_T — respeita o
      // estoque em que o usuário está trabalhando.
      const { data: result, error } = await supabase.rpc('criar_dispensacao', {
        p_tipo: data.tipo,
        p_patient_name: data.patient_name ?? null,
        p_medical_record_number: data.medical_record_number ?? null,
        p_prescribing_doctor: data.prescribing_doctor ?? null,
        p_prescription_number: data.prescription_number ?? null,
        p_prescription_date: data.prescription_date ?? null,
        // Data da RM: opcional, gravada so quando o operador informa.
        p_rm_date: data.rm_date ?? null,
        p_items: data.items.map((i) => ({
          item_id: i.item_id,
          quantity: i.quantity,
          expiry_tracking_id: i.expiry_tracking_id ?? null,
          batch_number: i.batch_number ?? null,
          expiry_date: i.expiry_date ?? null,
        })),
        p_patient_id: data.patient_id ?? null,
        p_admission_id: data.admission_id ?? null,
        p_prescriber_id: data.prescriber_id ?? null,
        p_patient_bed_room: data.patient_bed_room ?? null,
        p_sector: data.sector ?? null,
        p_notes: data.notes ?? null,
        p_mav_confirmado: data.mav_confirmado ?? false,
        p_source_location_code: opts.sourceLocationCode ?? 'CAF',
      })

      if (error) throw error
      return { id: (result as any).id, needsApproval: (result as any).needs_approval }
    } catch (error) {
      console.error('Error creating dispensation:', error)
      throw error
    }
  }

  async approveDispensation(dispensationId: string): Promise<void> {
    try {
      // Aprovação atômica: a RPC baixa o estoque (PRESCRICAO out@CAF + lote) e
      // conclui, com FOR UPDATE + checagem de status — impede baixa dupla por
      // aprovação concorrente.
      const { error } = await supabase.rpc('aprovar_dispensacao', { p_id: dispensationId })
      if (error) throw error
    } catch (error) {
      console.error('Error approving dispensation:', error)
      throw error
    }
  }

  async getPendingApprovals(): Promise<PharmacyDispensation[]> {
    try {
      const { data, error } = await supabase
        .from('pharmacy_dispensations')
        .select(`
          *,
          items:pharmacy_dispensation_items(
            id,
            item_id,
            quantity,
            expiry_tracking_id,
            batch_number,
            expiry_date,
            item:pharmacy_items(
              id,
              name,
              code,
              unit,
              medication_class,
              is_mav
            )
          )
        `)
        .eq('status', 'pending_approval')
        .order('created_at', { ascending: false })

      if (error) throw error
      if (!data) return []

      // Buscar nomes dos criadores
      const userIds = [...new Set(data.map((d: any) => d.created_by).filter(Boolean))]
      let userMap: Record<string, string> = {}
      if (userIds.length > 0) {
        const { data: users } = await supabase
          .from('users')
          .select('id, full_name')
          .in('id', userIds)
        if (users) {
          userMap = Object.fromEntries(users.map((u: any) => [u.id, u.full_name]))
        }
      }

      return data.map((d: any) => ({
        id: d.id,
        dispensation_number: d.dispensation_number,
        tipo: (d.tipo ?? 'prescricao') as 'prescricao' | 'requisicao',
        patient_name: d.patient_name,
        patient_bed_room: d.patient_bed_room,
        medical_record_number: d.medical_record_number,
        prescribing_doctor: d.prescribing_doctor,
        prescription_number: d.prescription_number,
        prescription_date: d.prescription_date,
        rm_date: d.rm_date ?? null,
        sector: d.sector,
        notes: d.notes,
        status: d.status,
        created_by: d.created_by,
        created_by_name: userMap[d.created_by] || 'Desconhecido',
        created_at: d.created_at,
        cancelled_at: d.cancelled_at,
        cancellation_reason: d.cancellation_reason,
        approved_by: d.approved_by,
        approved_at: d.approved_at,
        approved_by_name: d.approved_by_name,
        patient_id: d.patient_id,
        admission_id: d.admission_id,
        prescriber_id: d.prescriber_id,
        items: (d.items || []).map((i: any) => ({
          id: i.id,
          item_id: i.item_id,
          item_name: i.item?.name || '',
          item_code: i.item?.code || '',
          item_unit: i.item?.unit || 'UN',
          quantity: i.quantity,
          expiry_tracking_id: i.expiry_tracking_id,
          batch_number: i.batch_number,
          expiry_date: i.expiry_date,
          medication_class: i.item?.medication_class ?? null,
          is_mav: i.item?.is_mav ?? false,
        })),
      })) as PharmacyDispensation[]
    } catch (error) {
      console.error('Error fetching pending approvals:', error)
      return []
    }
  }

  async cancel(id: string, reason: string): Promise<void> {
    try {
      // Cancelamento atômico: se a dispensação estava concluída, a RPC estorna
      // o estoque (AJUSTE in@CAF + devolve o lote); se pendente, apenas cancela.
      const { error } = await supabase.rpc('cancelar_dispensacao', {
        p_id: id,
        p_reason: reason,
      })
      if (error) throw error
    } catch (error) {
      console.error('Error cancelling dispensation:', error)
      throw error
    }
  }
}

export const pharmacyDispensationService =
  PharmacyDispensationService.getInstance()
