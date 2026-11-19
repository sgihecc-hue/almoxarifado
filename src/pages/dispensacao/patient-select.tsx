import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import { ArrowLeft, Search, Plus, User, Calendar, FileText, Loader2, AlertCircle, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { patientsService } from '@/lib/services/farmacia-cadastros'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'

interface Patient {
  id: string
  full_name: string
  medical_record_number: string
  mother_name: string | null
  birth_date: string | null
  admission_date: string | null
  discharge_date: string | null
  discharge_reason: string | null
  created_at: string
}

type ViewMode = 'search' | 'new'

export function PatientSelect() {
  const navigate = useNavigate()
  const { mode } = useTheme()

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }

  const inputStyle: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '10px 14px', fontSize: 14,
    color: txt, outline: 'none', width: '100%',
  }

  const labelStyle: React.CSSProperties = {
    color: txtSec, fontSize: 13, fontWeight: 600, marginBottom: 4, display: 'block'
  }

  const [view, setView] = useState<ViewMode>('search')
  const [search, setSearch] = useState('')
  const [patients, setPatients] = useState<Patient[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // Novo paciente
  const [fullName, setFullName] = useState('')
  const [medicalRecord, setMedicalRecord] = useState('')
  const [motherName, setMotherName] = useState('')
  const [birthDate, setBirthDate] = useState('')
  const [admissionDate, setAdmissionDate] = useState(format(new Date(), 'yyyy-MM-dd'))

  useEffect(() => {
    if (search.trim().length < 2) { setPatients([]); return }
    const timer = setTimeout(() => searchPatients(), 300)
    return () => clearTimeout(timer)
  }, [search])

  async function searchPatients() {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('patients')
        // So paciente ativo e com internacao aberta (Andressa 19/11: inativos e
        // quem teve alta pela internacao continuavam aparecendo; a alta fica em
        // patient_admissions, o discharge_date do paciente nem sempre e preenchido).
        .select('*, patient_admissions!inner(id)')
        .eq('is_active', true)
        .is('patient_admissions.discharge_date', null)
        .or(`full_name.ilike.%${search}%,medical_record_number.ilike.%${search}%`)
        .is('discharge_date', null)
        .order('full_name')
        .limit(10)
      if (error) throw error
      setPatients(data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  function selectPatient(patient: Patient) {
    navigate('/dispensacao/new', { state: { patient } })
  }

  async function handleCreatePatient() {
    if (!fullName.trim() || !medicalRecord.trim()) {
      setError('Nome completo e número do prontuário são obrigatórios.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      const { data, error } = await supabase
        .from('patients')
        .insert({
          full_name: fullName.trim(),
          medical_record_number: medicalRecord.trim(),
          mother_name: motherName.trim() || null,
          birth_date: birthDate || null,
        })
        .select()
        .single()
      if (error) throw error
      // Registra a internação no modelo único (patient_admissions), para a
      // dispensação reconhecer a internação aberta.
      try {
        await patientsService.openAdmission(data.id, admissionDate || undefined)
      } catch (admErr) {
        console.error('Falha ao abrir internação do paciente:', admErr)
      }
      navigate('/dispensacao/new', { state: { patient: data } })
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/dispensacao')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
            background: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            color: txt,
          }}
        ><ArrowLeft size={18} /></button>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: txt }}>Nova Dispensacao</h1>
          <p className="text-sm" style={{ color: txtSec }}>Selecione ou cadastre o paciente</p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('search')}
          style={{
            padding: '8px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
            background: view === 'search' ? '#16a34a' : (mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
            color: view === 'search' ? '#fff' : txt,
            border: 'none',
          }}
        >
          <Search size={14} style={{ display: 'inline', marginRight: 6 }} />
          Buscar Paciente
        </button>
        <button
          onClick={() => setView('new')}
          style={{
            padding: '8px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600,
            cursor: 'pointer', transition: 'all 0.2s',
            background: view === 'new' ? '#16a34a' : (mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'),
            color: view === 'new' ? '#fff' : txt,
            border: 'none',
          }}
        >
          <Plus size={14} style={{ display: 'inline', marginRight: 6 }} />
          Novo Paciente
        </button>
      </div>

      {/* Buscar paciente */}
      {view === 'search' && (
        <div className="p-6 space-y-4" style={glass}>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
            <input
              autoFocus
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou número do prontuário..."
              style={{ ...inputStyle, paddingLeft: 36 }}
            />
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm py-2" style={{ color: txtMut }}>
              <Loader2 size={16} className="animate-spin" /> Buscando...
            </div>
          )}

          {!loading && search.trim().length >= 2 && patients.length === 0 && (
            <div className="text-center py-6" style={{ color: txtMut }}>
              <User size={32} className="mx-auto mb-2 opacity-40" />
              <p className="text-sm">Nenhum paciente encontrado.</p>
              <button
                onClick={() => setView('new')}
                className="text-sm mt-2 underline"
                style={{ color: '#16a34a', background: 'none', border: 'none', cursor: 'pointer' }}
              >
                Cadastrar novo paciente
              </button>
            </div>
          )}

          {patients.length > 0 && (
            <div className="space-y-2">
              {patients.map(patient => (
                <div
                  key={patient.id}
                  onClick={() => selectPatient(patient)}
                  className="flex items-center justify-between px-4 py-4 rounded-xl cursor-pointer transition-all"
                  style={{
                    background: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)',
                    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
                  }}
                  onMouseEnter={e => { e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(22,163,74,0.06)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.02)' }}
                >
                  <div className="flex items-center gap-3">
                    <div style={{
                      width: 40, height: 40, borderRadius: 10, display: 'flex',
                      alignItems: 'center', justifyContent: 'center',
                      background: mode === 'dark' ? 'rgba(22,163,74,0.2)' : 'rgba(22,163,74,0.1)',
                    }}>
                      <User size={18} style={{ color: '#16a34a' }} />
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: txt }}>{patient.full_name}</p>
                      <div className="flex items-center gap-3 mt-0.5">
                        <span className="text-xs flex items-center gap-1" style={{ color: txtMut }}>
                          <FileText size={11} /> Pront. {patient.medical_record_number}
                        </span>
                        {patient.admission_date && (
                          <span className="text-xs flex items-center gap-1" style={{ color: txtMut }}>
                            <Calendar size={11} />
                            Internado em {format(new Date(patient.admission_date), 'dd/MM/yyyy', { locale: ptBR })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={16} style={{ color: txtMut }} />
                </div>
              ))}
            </div>
          )}

          {search.trim().length < 2 && (
            <p className="text-sm text-center py-4" style={{ color: txtMut }}>
              Digite ao menos 2 caracteres para buscar
            </p>
          )}
        </div>
      )}

      {/* Novo paciente */}
      {view === 'new' && (
        <div className="p-6 space-y-4" style={glass}>
          <h2 className="text-base font-semibold" style={{ color: txt }}>Dados do Paciente</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="md:col-span-2">
              <label style={labelStyle}>Nome Completo *</label>
              <input
                autoFocus
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder="Nome completo do paciente"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Número do Prontuário *</label>
              <input
                value={medicalRecord}
                onChange={e => setMedicalRecord(e.target.value)}
                placeholder="Ex: 123456"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Nome da Mãe</label>
              <input
                value={motherName}
                onChange={e => setMotherName(e.target.value)}
                placeholder="Nome completo da mãe"
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Data de Nascimento</label>
              <input
                type="date"
                value={birthDate}
                onChange={e => setBirthDate(e.target.value)}
                style={inputStyle}
              />
            </div>

            <div>
              <label style={labelStyle}>Data de Internamento</label>
              <input
                type="date"
                value={admissionDate}
                onChange={e => setAdmissionDate(e.target.value)}
                style={inputStyle}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => setView('search')}>Cancelar</Button>
            <Button
              className="bg-primary-500 hover:bg-primary-600 text-white"
              onClick={handleCreatePatient}
              disabled={submitting || !fullName.trim() || !medicalRecord.trim()}
            >
              {submitting
                ? <><Loader2 size={16} className="animate-spin mr-2" /> Cadastrando...</>
                : <><Plus size={16} className="mr-2" /> Cadastrar e Continuar</>
              }
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
