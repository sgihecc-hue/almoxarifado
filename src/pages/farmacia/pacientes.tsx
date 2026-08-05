// =====================================================================
// Cadastro de Pacientes + gestao de Internacoes.
// Cada paciente pode ter multiplas admissoes (historico).
// =====================================================================

import { useEffect, useState, useMemo } from 'react'
import { getErrorMessage } from '@/lib/utils/error-messages'
import {
  Users, Plus, Edit2, Trash2, Search, Loader2, AlertCircle, X,
  ArrowDownToLine, ArrowUpFromLine, History as HistoryIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'
import { patientsService } from '@/lib/services/farmacia-cadastros'
import type { Patient, PatientAdmission, DischargeReason } from '@/lib/types/farmacia'
import { DISCHARGE_REASON_LABEL } from '@/lib/types/farmacia'

interface PatientRow extends Patient {
  open_admission_id: string | null
  admission_date: string | null
}

export function Pacientes() {
  const { mode } = useTheme()

  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const card: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }
  const input: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '10px 14px', fontSize: 14,
    color: txt, outline: 'none', width: '100%',
  }
  const lbl: React.CSSProperties = { color: txtSec, fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }

  const [rows, setRows] = useState<PatientRow[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [onlyAdmitted, setOnlyAdmitted] = useState(false)
  const [error, setError] = useState('')

  // Form
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Patient | null>(null)
  const [fName, setFName] = useState('')
  const [fBirth, setFBirth] = useState('')
  const [fRecord, setFRecord] = useState('')
  const [fMother, setFMother] = useState('')
  // Todo paciente novo eh criado ja com uma admissao (regra de negocio).
  // Data default = hoje, mas o usuario pode mudar.
  const [fAdmitDate, setFAdmitDate] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')

  // Discharge modal
  const [dischargingPatient, setDischargingPatient] = useState<PatientRow | null>(null)
  const [dDate, setDDate] = useState(new Date().toISOString().slice(0, 10))
  const [dReason, setDReason] = useState<DischargeReason>('melhora_clinica')
  const [dNotes, setDNotes] = useState('')

  // History modal
  const [historyPatient, setHistoryPatient] = useState<Patient | null>(null)
  const [admissions, setAdmissions] = useState<PatientAdmission[]>([])

  useEffect(() => { load() }, [])

  async function load() {
    setLoading(true); setError('')
    try { setRows(await patientsService.list() as PatientRow[]) }
    catch (e) { setError(getErrorMessage(e)) }
    finally { setLoading(false) }
  }

  const filtered = useMemo(() => {
    let list = rows
    if (onlyAdmitted) list = list.filter(p => p.open_admission_id)
    const q = search.trim().toLowerCase()
    if (q) list = list.filter(p =>
      p.full_name.toLowerCase().includes(q) || p.medical_record_number.toLowerCase().includes(q)
    )
    return list
  }, [rows, search, onlyAdmitted])

  function openNew() {
    setEditing(null)
    setFName(''); setFBirth(''); setFRecord(''); setFMother('')
    setFAdmitDate(new Date().toISOString().slice(0, 10))
    setFormError(''); setShowForm(true)
  }

  function openEdit(p: Patient) {
    setEditing(p)
    setFName(p.full_name); setFBirth(p.birth_date || ''); setFRecord(p.medical_record_number)
    setFMother(p.mother_name || '')
    setFormError(''); setShowForm(true)
  }

  async function save() {
    setSaving(true); setFormError('')
    try {
      if (editing) {
        await patientsService.update(editing.id, {
          full_name: fName, birth_date: fBirth || null,
          medical_record_number: fRecord, mother_name: fMother,
        })
      } else {
        // Sempre cria com admissao (regra de negocio).
        await patientsService.create({
          full_name: fName, birth_date: fBirth || null,
          medical_record_number: fRecord, mother_name: fMother,
          already_admitted: true, admission_date: fAdmitDate,
        })
      }
      setShowForm(false); await load()
    } catch (e) { setFormError(getErrorMessage(e)) }
    finally { setSaving(false) }
  }

  async function remove(p: Patient) {
    if (!confirm(`Desativar paciente "${p.full_name}"?`)) return
    try { await patientsService.deactivate(p.id); await load() }
    catch (e) { setError(getErrorMessage(e)) }
  }

  async function admit(p: PatientRow) {
    try { await patientsService.openAdmission(p.id); await load() }
    catch (e) { alert(getErrorMessage(e)) }
  }

  function openDischarge(p: PatientRow) {
    setDischargingPatient(p)
    setDDate(new Date().toISOString().slice(0, 10))
    setDReason('melhora_clinica'); setDNotes('')
  }

  async function confirmDischarge() {
    if (!dischargingPatient?.open_admission_id) return
    try {
      await patientsService.dischargeAdmission(dischargingPatient.open_admission_id, {
        discharge_date: dDate, discharge_reason: dReason, discharge_notes: dNotes,
      })
      setDischargingPatient(null); await load()
    } catch (e) { alert(getErrorMessage(e)) }
  }

  async function openHistory(p: Patient) {
    setHistoryPatient(p)
    setAdmissions(await patientsService.listAdmissions(p.id))
  }

  function fmtDate(d: string | null | undefined) {
    if (!d) return '—'
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
  }
  function daysBetween(start: string, end: string | null) {
    const s = new Date(start + 'T00:00:00').getTime()
    const e = end ? new Date(end + 'T00:00:00').getTime() : Date.now()
    return Math.max(0, Math.floor((e - s) / 86400000))
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-blue-100"><Users className="w-6 h-6 text-blue-600" /></div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: txt }}>Pacientes</h1>
            <p className="text-sm" style={{ color: txtSec }}>Cadastro e gestão de internações</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-emerald-600 hover:bg-emerald-700 text-white">
          <Plus className="w-4 h-4 mr-2" /> Novo Paciente
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      <div className="p-4 space-y-3" style={card}>
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input placeholder="Buscar por nome ou prontuário..." value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ ...input, paddingLeft: 36 }} />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none" style={{ color: txt }}>
          <input type="checkbox" checked={onlyAdmitted} onChange={(e) => setOnlyAdmitted(e.target.checked)} className="w-4 h-4" />
          Mostrar só internados
        </label>
      </div>

      <div className="p-2 overflow-x-auto" style={card}>
        {loading ? (
          <div className="flex items-center justify-center p-8" style={{ color: txtMut }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-sm text-center" style={{ color: txtMut }}>Nenhum paciente.</p>
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                <th className="text-left px-3 py-3 text-xs font-semibold uppercase" style={{ color: txtSec }}>Prontuário</th>
                <th className="text-left px-3 py-3 text-xs font-semibold uppercase" style={{ color: txtSec }}>Nome</th>
                <th className="text-left px-3 py-3 text-xs font-semibold uppercase" style={{ color: txtSec }}>Nascimento</th>
                <th className="text-left px-3 py-3 text-xs font-semibold uppercase" style={{ color: txtSec }}>Status</th>
                <th className="text-right px-3 py-3 text-xs font-semibold uppercase" style={{ color: txtSec }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(p => (
                <tr key={p.id} style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
                  <td className="px-3 py-3 text-sm" style={{ color: txtSec }}>{p.medical_record_number}</td>
                  <td className="px-3 py-3 text-sm font-medium" style={{ color: txt }}>{p.full_name}</td>
                  <td className="px-3 py-3 text-sm" style={{ color: txtSec }}>{fmtDate(p.birth_date)}</td>
                  <td className="px-3 py-3 text-sm">
                    {p.open_admission_id ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                        🟢 Internado desde {fmtDate(p.admission_date!)} ({daysBetween(p.admission_date!, null)}d)
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                        ⚪ Sem internação
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right whitespace-nowrap">
                    <Button variant="outline" size="sm" onClick={() => openHistory(p)} className="h-8 px-2 mr-1" title="Histórico">
                      <HistoryIcon size={14} />
                    </Button>
                    {p.open_admission_id ? (
                      <Button variant="outline" size="sm" onClick={() => openDischarge(p)} className="h-8 px-2 mr-1 text-amber-600 border-amber-200 hover:bg-amber-50" title="Dar alta">
                        <ArrowUpFromLine size={14} />
                      </Button>
                    ) : (
                      <Button variant="outline" size="sm" onClick={() => admit(p)} className="h-8 px-2 mr-1 text-emerald-600 border-emerald-200 hover:bg-emerald-50" title="Internar">
                        <ArrowDownToLine size={14} />
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openEdit(p)} className="h-8 px-2 mr-1">
                      <Edit2 size={14} />
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => remove(p)} className="h-8 px-2 text-red-600 border-red-200 hover:bg-red-50">
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal cadastro/edicao */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-lg p-6 space-y-4" style={card}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                {editing ? 'Editar Paciente' : 'Novo Paciente'}
              </h2>
              <button onClick={() => setShowForm(false)} style={{ color: txtMut }}><X size={18} /></button>
            </div>
            {formError && (
              <div className="p-2 rounded bg-red-100 border border-red-200 text-red-800 text-sm">{formError}</div>
            )}
            <div>
              <label style={lbl}>Nome completo *</label>
              <input value={fName} onChange={(e) => setFName(e.target.value)} style={input} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label style={lbl}>Nascimento</label>
                <input type="date" value={fBirth} onChange={(e) => setFBirth(e.target.value)} style={input} />
              </div>
              <div>
                <label style={lbl}>Prontuário *</label>
                <input value={fRecord} onChange={(e) => setFRecord(e.target.value)} style={input} />
              </div>
            </div>
            <div>
              <label style={lbl}>Nome da mãe</label>
              <input value={fMother} onChange={(e) => setFMother(e.target.value)} style={input} />
            </div>
            {!editing && (
              <div className="p-3 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)' }}>
                <label style={lbl}>Data de internação *</label>
                <input type="date" value={fAdmitDate} onChange={(e) => setFAdmitDate(e.target.value)} style={input} />
                <p className="text-xs mt-1" style={{ color: txtMut }}>
                  Todo paciente novo é criado já com uma admissão. Se já estiver internado antes, ajuste a data.
                </p>
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                {saving && <Loader2 size={14} className="mr-2 animate-spin" />}Salvar
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Alta */}
      {dischargingPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-md p-6 space-y-4" style={card}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                Dar alta — {dischargingPatient.full_name}
              </h2>
              <button onClick={() => setDischargingPatient(null)} style={{ color: txtMut }}><X size={18} /></button>
            </div>
            <p className="text-sm" style={{ color: txtSec }}>
              Internado em {fmtDate(dischargingPatient.admission_date!)} · {daysBetween(dischargingPatient.admission_date!, null)} dia(s)
            </p>
            <div>
              <label style={lbl}>Data da alta *</label>
              <input type="date" value={dDate} onChange={(e) => setDDate(e.target.value)} style={input} />
            </div>
            <div>
              <label style={lbl}>Motivo da alta *</label>
              <select value={dReason} onChange={(e) => setDReason(e.target.value as DischargeReason)} style={input as any}>
                {(Object.entries(DISCHARGE_REASON_LABEL) as Array<[DischargeReason, string]>).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={lbl}>Observação</label>
              <textarea value={dNotes} onChange={(e) => setDNotes(e.target.value)} rows={2} style={{ ...input, resize: 'vertical' as const }} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDischargingPatient(null)}>Cancelar</Button>
              <Button onClick={confirmDischarge} className="bg-amber-600 hover:bg-amber-700 text-white">
                <ArrowUpFromLine size={14} className="mr-2" /> Confirmar alta
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Historico */}
      {historyPatient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
          <div className="w-full max-w-xl p-6 space-y-4" style={card}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                Histórico — {historyPatient.full_name}
              </h2>
              <button onClick={() => setHistoryPatient(null)} style={{ color: txtMut }}><X size={18} /></button>
            </div>
            <p className="text-sm" style={{ color: txtMut }}>Prontuário: {historyPatient.medical_record_number}</p>
            {admissions.length === 0 ? (
              <p className="text-sm" style={{ color: txtMut }}>Nenhuma internação registrada.</p>
            ) : (
              <div className="space-y-2 max-h-96 overflow-y-auto">
                {admissions.map((a) => (
                  <div key={a.id} className="p-3 rounded-lg"
                    style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                             border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.05)'}` }}>
                    <div className="text-sm" style={{ color: txt }}>
                      {a.discharge_date
                        ? `${fmtDate(a.admission_date)} → ${fmtDate(a.discharge_date)} (${daysBetween(a.admission_date, a.discharge_date)}d)`
                        : `🟢 Em curso desde ${fmtDate(a.admission_date)} (${daysBetween(a.admission_date, null)}d)`}
                    </div>
                    {a.discharge_reason && (
                      <div className="text-xs mt-1" style={{ color: txtSec }}>
                        Alta: {DISCHARGE_REASON_LABEL[a.discharge_reason]}
                        {a.discharge_notes && ` · ${a.discharge_notes}`}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => setHistoryPatient(null)}>Fechar</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
