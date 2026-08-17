export type DispensationStatus = 'pending_approval' | 'completed' | 'cancelled'
export type DispensationType = 'prescricao' | 'requisicao'

export interface PharmacyDispensation {
  id: string
  dispensation_number: number
  tipo: DispensationType
  patient_name?: string | null
  patient_bed_room?: string
  medical_record_number?: string | null
  prescribing_doctor?: string | null
  prescription_number?: string | null
  prescription_date?: string | null
  // Data da RM (Requisicao de Material) — opcional, so no tipo 'requisicao'.
  rm_date?: string | null
  sector?: string
  notes?: string
  status: DispensationStatus
  created_by: string
  created_by_name?: string
  created_at: string
  cancelled_at?: string
  cancellation_reason?: string
  approved_by?: string | null
  approved_at?: string | null
  approved_by_name?: string | null
  patient_id?: string | null
  admission_id?: string | null
  prescriber_id?: string | null
  items: PharmacyDispensationItem[]
}

export interface PharmacyDispensationItem {
  id: string
  item_id: string
  item_name: string
  item_code: string
  item_unit: string
  quantity: number
  expiry_tracking_id?: string | null
  batch_number?: string | null
  expiry_date?: string | null
  medication_class?: string | null
  is_mav?: boolean
}

export interface CreateDispensationData {
  tipo: DispensationType
  patient_name?: string | null
  patient_bed_room?: string
  medical_record_number?: string | null
  prescribing_doctor?: string | null
  prescription_number?: string | null
  prescription_date?: string | null
  rm_date?: string | null
  sector?: string | null
  notes?: string
  patient_id?: string | null
  admission_id?: string | null
  prescriber_id?: string | null
  needs_approval?: boolean
  mav_confirmado?: boolean
  items: Array<{
    item_id: string
    quantity: number
    expiry_tracking_id?: string | null
    batch_number?: string | null
    expiry_date?: string | null
    medication_class?: string | null
    is_mav?: boolean
  }>
}
