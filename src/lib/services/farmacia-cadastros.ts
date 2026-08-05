// =====================================================================
// Servicos dos cadastros de farmacia (suppliers, prescribers, patients).
// Sao 3 CRUDs simples + helpers de admissao do paciente.
// =====================================================================

import { supabase } from '../supabase'
import type {
  Supplier,
  Prescriber,
  Patient,
  PatientAdmission,
  PatientAdmissionWithPatient,
  DischargeReason,
} from '../types/farmacia'

// ---------- Helpers ----------
function onlyDigits(s: string): string {
  return s.replace(/\D+/g, '')
}

/** Valida dígitos verificadores de CNPJ. */
export function isValidCNPJ(cnpj: string): boolean {
  const c = onlyDigits(cnpj)
  if (c.length !== 14) return false
  if (/^(\d)\1+$/.test(c)) return false // todos digitos iguais

  const calc = (slice: string, weights: number[]) => {
    const sum = slice.split('').reduce(
      (acc, n, i) => acc + parseInt(n, 10) * weights[i], 0
    )
    const rest = sum % 11
    return rest < 2 ? 0 : 11 - rest
  }
  const d1 = calc(c.slice(0, 12), [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  const d2 = calc(c.slice(0, 13), [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2])
  return d1 === parseInt(c[12], 10) && d2 === parseInt(c[13], 10)
}

export function formatCNPJ(cnpj: string): string {
  const c = onlyDigits(cnpj)
  if (c.length !== 14) return cnpj
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`
}

// =====================================================================
// SUPPLIERS
// =====================================================================
class SuppliersService {
  async list(includeInactive = false): Promise<Supplier[]> {
    let q = supabase.from('suppliers').select('*').order('name')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw new Error('Erro ao listar fornecedores: ' + error.message)
    return (data || []) as Supplier[]
  }

  async create(input: { name: string; cnpj: string }): Promise<Supplier> {
    const cnpj = onlyDigits(input.cnpj)
    if (!isValidCNPJ(cnpj)) throw new Error('CNPJ inválido.')
    if (!input.name.trim()) throw new Error('Nome é obrigatório.')

    const { data, error } = await supabase
      .from('suppliers')
      .insert({ name: input.name.trim(), cnpj })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') throw new Error('Já existe um fornecedor com esse CNPJ.')
      throw new Error('Erro ao criar fornecedor: ' + error.message)
    }
    return data as Supplier
  }

  async update(id: string, input: Partial<{ name: string; cnpj: string; is_active: boolean }>): Promise<Supplier> {
    const patch: any = {}
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error('Nome é obrigatório.')
      patch.name = input.name.trim()
    }
    if (input.cnpj !== undefined) {
      const cnpj = onlyDigits(input.cnpj)
      if (!isValidCNPJ(cnpj)) throw new Error('CNPJ inválido.')
      patch.cnpj = cnpj
    }
    if (input.is_active !== undefined) patch.is_active = input.is_active
    patch.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('suppliers').update(patch).eq('id', id).select('*').single()
    if (error) {
      if (error.code === '23505') throw new Error('Já existe um fornecedor com esse CNPJ.')
      throw new Error('Erro ao atualizar fornecedor: ' + error.message)
    }
    return data as Supplier
  }

  async deactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from('suppliers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error('Erro ao desativar: ' + error.message)
  }
}

// =====================================================================
// PRESCRIBERS
// =====================================================================
class PrescribersService {
  async list(includeInactive = false): Promise<Prescriber[]> {
    let q = supabase.from('prescribers').select('*').order('name')
    if (!includeInactive) q = q.eq('is_active', true)
    const { data, error } = await q
    if (error) throw new Error('Erro ao listar prescritores: ' + error.message)
    return (data || []) as Prescriber[]
  }

  async search(term: string, limit = 20): Promise<Prescriber[]> {
    const t = term.trim()
    if (!t) return []
    const { data, error } = await supabase
      .from('prescribers')
      .select('*')
      .eq('is_active', true)
      .or(`name.ilike.%${t}%,crm.ilike.%${t}%`)
      .order('name')
      .limit(limit)
    if (error) throw new Error('Erro ao buscar prescritores: ' + error.message)
    return (data || []) as Prescriber[]
  }

  async create(input: { name: string; crm: string; crm_uf?: string }): Promise<Prescriber> {
    if (!input.name.trim()) throw new Error('Nome é obrigatório.')
    if (!input.crm.trim()) throw new Error('CRM é obrigatório.')
    const crm_uf = (input.crm_uf || 'BA').toUpperCase()
    if (!/^[A-Z]{2}$/.test(crm_uf)) throw new Error('UF do CRM deve ter 2 letras.')

    const { data, error } = await supabase
      .from('prescribers')
      .insert({ name: input.name.trim(), crm: input.crm.trim(), crm_uf })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') throw new Error('Já existe um prescritor com esse CRM/UF.')
      throw new Error('Erro ao criar prescritor: ' + error.message)
    }
    return data as Prescriber
  }

  async update(id: string, input: Partial<{ name: string; crm: string; crm_uf: string; is_active: boolean }>): Promise<Prescriber> {
    const patch: any = {}
    if (input.name !== undefined) {
      if (!input.name.trim()) throw new Error('Nome é obrigatório.')
      patch.name = input.name.trim()
    }
    if (input.crm !== undefined) {
      if (!input.crm.trim()) throw new Error('CRM é obrigatório.')
      patch.crm = input.crm.trim()
    }
    if (input.crm_uf !== undefined) {
      const uf = input.crm_uf.toUpperCase()
      if (!/^[A-Z]{2}$/.test(uf)) throw new Error('UF deve ter 2 letras.')
      patch.crm_uf = uf
    }
    if (input.is_active !== undefined) patch.is_active = input.is_active
    patch.updated_at = new Date().toISOString()

    const { data, error } = await supabase
      .from('prescribers').update(patch).eq('id', id).select('*').single()
    if (error) {
      if (error.code === '23505') throw new Error('Já existe um prescritor com esse CRM/UF.')
      throw new Error('Erro ao atualizar prescritor: ' + error.message)
    }
    return data as Prescriber
  }

  async deactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from('prescribers')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error('Erro ao desativar: ' + error.message)
  }
}

// =====================================================================
// PATIENTS + ADMISSIONS
// =====================================================================
class PatientsService {
  /** Lista pacientes ativos. Se onlyAdmitted=true, retorna so com admissao aberta. */
  async list(onlyAdmitted = false): Promise<Array<Patient & { open_admission_id: string | null; admission_date: string | null }>> {
    // Busca pacientes + uma admissao aberta (LEFT JOIN via subselect)
    const { data, error } = await supabase
      .from('patients')
      .select(`
        *,
        admissions:patient_admissions(id, admission_date, discharge_date)
      `)
      .eq('is_active', true)
      .order('full_name')
    if (error) throw new Error('Erro ao listar pacientes: ' + error.message)

    const result = (data || []).map((p: any) => {
      const open = (p.admissions || []).find((a: any) => !a.discharge_date)
      return {
        ...p,
        open_admission_id: open?.id ?? null,
        admission_date: open?.admission_date ?? null,
      }
    })
    return onlyAdmitted ? result.filter((p) => p.open_admission_id) : result
  }

  async search(term: string, limit = 20): Promise<Patient[]> {
    const t = term.trim()
    if (!t) return []
    const { data, error } = await supabase
      .from('patients')
      .select('*')
      .eq('is_active', true)
      .or(`full_name.ilike.%${t}%,medical_record_number.ilike.%${t}%`)
      .order('full_name')
      .limit(limit)
    if (error) throw new Error('Erro ao buscar pacientes: ' + error.message)
    return (data || []) as Patient[]
  }

  /**
   * Cria paciente. Se already_admitted=true, cria tambem patient_admissions
   * com admission_date (default = hoje).
   */
  async create(input: {
    full_name: string
    birth_date?: string | null
    medical_record_number: string
    mother_name?: string
    already_admitted?: boolean
    admission_date?: string
  }): Promise<Patient> {
    if (!input.full_name.trim()) throw new Error('Nome é obrigatório.')
    if (!input.medical_record_number.trim()) throw new Error('Prontuário é obrigatório.')
    // Data de nascimento é opcional (nem sempre disponível na internação).

    const { data, error } = await supabase
      .from('patients')
      .insert({
        full_name: input.full_name.trim(),
        birth_date: input.birth_date || null,
        medical_record_number: input.medical_record_number.trim(),
        mother_name: input.mother_name?.trim() || null,
      })
      .select('*')
      .single()
    if (error) {
      if (error.code === '23505') throw new Error('Já existe um paciente com esse prontuário.')
      throw new Error('Erro ao criar paciente: ' + error.message)
    }

    if (input.already_admitted) {
      const { error: e2 } = await supabase
        .from('patient_admissions')
        .insert({
          patient_id: data.id,
          admission_date: input.admission_date || new Date().toISOString().slice(0, 10),
        })
      if (e2) console.error('Falha ao criar admissao do paciente:', e2)
    }

    return data as Patient
  }

  async update(id: string, input: Partial<{ full_name: string; birth_date: string | null; medical_record_number: string; mother_name: string; is_active: boolean }>): Promise<Patient> {
    const patch: any = { ...input, updated_at: new Date().toISOString() }
    const { data, error } = await supabase
      .from('patients').update(patch).eq('id', id).select('*').single()
    if (error) {
      if (error.code === '23505') throw new Error('Já existe um paciente com esse prontuário.')
      throw new Error('Erro ao atualizar paciente: ' + error.message)
    }
    return data as Patient
  }

  async deactivate(id: string): Promise<void> {
    const { error } = await supabase
      .from('patients')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) throw new Error('Erro ao desativar: ' + error.message)
  }

  // ---------- Admissoes ----------

  async listAdmissions(patientId: string): Promise<PatientAdmission[]> {
    const { data, error } = await supabase
      .from('patient_admissions')
      .select('*')
      .eq('patient_id', patientId)
      .order('admission_date', { ascending: false })
    if (error) throw new Error('Erro ao listar internações: ' + error.message)
    return (data || []) as PatientAdmission[]
  }

  async getOpenAdmission(patientId: string): Promise<PatientAdmission | null> {
    const { data, error } = await supabase
      .from('patient_admissions')
      .select('*')
      .eq('patient_id', patientId)
      .is('discharge_date', null)
      .order('admission_date', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) throw new Error('Erro ao buscar internação atual: ' + error.message)
    return data as PatientAdmission | null
  }

  async openAdmission(patientId: string, admissionDate?: string): Promise<PatientAdmission> {
    const existing = await this.getOpenAdmission(patientId)
    if (existing) {
      throw new Error('Paciente já possui uma internação em aberto.')
    }
    const { data: userData } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('patient_admissions')
      .insert({
        patient_id: patientId,
        admission_date: admissionDate || new Date().toISOString().slice(0, 10),
        created_by: userData.user?.id ?? null,
      })
      .select('*')
      .single()
    if (error) throw new Error('Erro ao abrir internação: ' + error.message)
    return data as PatientAdmission
  }

  async dischargeAdmission(admissionId: string, params: {
    discharge_date: string
    discharge_reason: DischargeReason
    discharge_notes?: string
  }): Promise<PatientAdmission> {
    if (!params.discharge_reason) throw new Error('Motivo da alta é obrigatório.')
    const { data: userData } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('patient_admissions')
      .update({
        discharge_date: params.discharge_date,
        discharge_reason: params.discharge_reason,
        discharge_notes: params.discharge_notes?.trim() || null,
        discharged_by: userData.user?.id ?? null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', admissionId)
      .is('discharge_date', null) // proteje contra dupla alta
      .select('*')
      .single()
    if (error) throw new Error('Erro ao dar alta: ' + error.message)
    if (!data) throw new Error('Internação não encontrada ou já encerrada.')
    return data as PatientAdmission
  }

  /** Lista admissoes em aberto (todos os pacientes). */
  async listOpenAdmissions(): Promise<PatientAdmissionWithPatient[]> {
    const { data, error } = await supabase
      .from('patient_admissions')
      .select(`*, patient:patients(id, full_name, medical_record_number, birth_date)`)
      .is('discharge_date', null)
      .order('admission_date', { ascending: false })
    if (error) throw new Error('Erro ao listar internações em aberto: ' + error.message)
    return (data || []) as unknown as PatientAdmissionWithPatient[]
  }
}

export const suppliersService = new SuppliersService()
export const prescribersService = new PrescribersService()
export const patientsService = new PatientsService()
