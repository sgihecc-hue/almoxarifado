// =====================================================================
// Tipos dos cadastros de farmacia (F1 do redesenho):
//   - suppliers
//   - prescribers
//   - patients + patient_admissions
//   - novos campos de pharmacy_items (classe, apresentacao, MAV)
// =====================================================================

export interface Supplier {
  id: string
  name: string
  cnpj: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Prescriber {
  id: string
  name: string
  crm: string
  crm_uf: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Patient {
  id: string
  full_name: string
  birth_date: string | null  // YYYY-MM-DD (opcional)
  medical_record_number: string
  mother_name: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

export type DischargeReason =
  | 'melhora_clinica'
  | 'transferencia'
  | 'obito'
  | 'evasao'
  | 'alta_a_pedido'
  | 'outro'

export const DISCHARGE_REASON_LABEL: Record<DischargeReason, string> = {
  melhora_clinica: 'Melhora clínica',
  transferencia: 'Transferência',
  obito: 'Óbito',
  evasao: 'Evasão',
  alta_a_pedido: 'A pedido (alta administrativa)',
  outro: 'Outro',
}

export interface PatientAdmission {
  id: string
  patient_id: string
  admission_date: string
  discharge_date: string | null
  discharge_reason: DischargeReason | null
  discharge_notes: string | null
  created_by: string | null
  discharged_by: string | null
  created_at: string
  updated_at: string
}

/** Internacao com dados do paciente embarcados — uso comum em telas. */
export interface PatientAdmissionWithPatient extends PatientAdmission {
  patient: Pick<Patient, 'id' | 'full_name' | 'medical_record_number' | 'birth_date'>
}

// ---------- Pharmacy items: enums ----------

export type MedicationClass = 'uso_geral' | 'antimicrobianos' | 'controlados' | 'mav' | 'sgv' | 'curativo' | 'anticoagulante'

export const MEDICATION_CLASS_LABEL: Record<MedicationClass, string> = {
  uso_geral: 'Medicamentos de uso geral',
  antimicrobianos: 'Antimicrobianos',
  controlados: 'Controlados',
  mav: 'Medicamentos de Alta Vigilância (MAV)',
  sgv: 'Soluções de Grande Volume (SGV)',
  curativo: 'Curativo',
  anticoagulante: 'Anticoagulante',
}

export type ControlledSubclass =
  | 'A1' | 'A2' | 'A3' | 'B1' | 'B2' | 'C1' | 'C2' | 'C3' | 'C4'

export const CONTROLLED_SUBCLASSES: ControlledSubclass[] = [
  'A1', 'A2', 'A3', 'B1', 'B2', 'C1', 'C2', 'C3', 'C4',
]

export type Presentation =
  | 'comprimidos'
  | 'injetaveis'
  | 'solucoes_orais'
  | 'topicos'
  | 'aerosol'
  | 'xarope'
  | 'supositorio'
  | 'gotas'
  | 'outros'

export const PRESENTATION_LABEL: Record<Presentation, string> = {
  comprimidos: 'Comprimidos',
  injetaveis: 'Injetáveis',
  solucoes_orais: 'Soluções orais',
  topicos: 'Tópicos',
  aerosol: 'Aerosol',
  xarope: 'Xarope',
  supositorio: 'Supositório',
  gotas: 'Gotas',
  outros: 'Outros',
}
