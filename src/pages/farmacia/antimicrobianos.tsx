// =====================================================================
// Controle de Antimicrobianos (CCIH)
// Tabela antimicrobial_controls — FASE 10 do redesenho da Farmácia
// =====================================================================

import { useEffect, useState, useMemo } from 'react'
import {
  ShieldAlert, Plus, Edit2, Search, Loader2, AlertCircle, X,
  ChevronDown, ChevronUp,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'
import {
  antimicrobialControlsService,
  type AntimicrobialControl,
  type CreateAntimicrobialData,
  type StatusAntimicrobiano,
  type StatusPaciente,
  type CcihParecer,
  type Via,
} from '@/lib/services/antimicrobial-controls'
import { supabase } from '@/lib/supabase'
import { hojeLocal, normalizarBusca } from '@/lib/utils/seguro'
import { getErrorMessage } from '@/lib/utils/error-messages'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface PharmacyItem {
  id: string
  name: string
  medication_class: string | null
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function fmtDate(d: string | null | undefined) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
}

function calcDaysInUse(dataInicio: string, dataFinal: string | null | undefined) {
  const start = new Date(dataInicio + 'T00:00:00').getTime()
  const end = dataFinal ? new Date(dataFinal + 'T00:00:00').getTime() : Date.now()
  return Math.max(0, Math.floor((end - start) / 86400000))
}

// ---------------------------------------------------------------------------
// Badges
// ---------------------------------------------------------------------------
function StatusBadge({ status }: { status: StatusAntimicrobiano }) {
  const map: Record<StatusAntimicrobiano, { label: string; cls: string }> = {
    em_uso:    { label: 'Em uso',    cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    suspenso:  { label: 'Suspenso',  cls: 'bg-amber-50 text-amber-700 border-amber-200' },
    concluido: { label: 'Concluído', cls: 'bg-gray-100 text-gray-600 border-gray-200' },
  }
  const { label, cls } = map[status] || map.em_uso
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {label}
    </span>
  )
}

function CcihBadge({ parecer }: { parecer: CcihParecer | null | undefined }) {
  if (!parecer) return <span className="text-xs text-gray-400">—</span>
  const map: Record<CcihParecer, { cls: string }> = {
    Aprovado:   { cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
    Recusado:   { cls: 'bg-red-50 text-red-700 border-red-200' },
    Aguardando: { cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  }
  const { cls } = map[parecer]
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border ${cls}`}>
      {parecer}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export function Antimicrobianos() {
  const { mode } = useTheme()

  const txt    = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)'  : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  const card: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)', WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
  }
  const inp: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '9px 12px', fontSize: 14,
    color: txt, outline: 'none', width: '100%',
  }
  const lbl: React.CSSProperties = {
    color: txtSec, fontSize: 11, fontWeight: 600,
    textTransform: 'uppercase' as const, letterSpacing: 0.5, display: 'block', marginBottom: 4,
  }
  const divider: React.CSSProperties = {
    borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
    marginTop: 12, paddingTop: 12,
  }

  // Data
  const [rows, setRows]       = useState<AntimicrobialControl[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [search, setSearch]   = useState('')
  const [filterStatus, setFilterStatus] = useState<StatusAntimicrobiano | ''>('')

  // Expanded row
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // ATB items for dropdown
  const [atbItems, setAtbItems] = useState<PharmacyItem[]>([])

  // Modal
  const [showModal, setShowModal]   = useState(false)
  const [editingId, setEditingId]   = useState<string | null>(null)
  const [saving, setSaving]         = useState(false)
  const [formError, setFormError]   = useState('')

  // ----- Form state -----
  const blankForm = (): CreateAntimicrobialData => ({
    paciente_nome: '', prontuario: '', setor_leito: '',
    data_internacao: '', dias_internacao: undefined, status_paciente: 'internado',
    data_alta_obito: '', pharmacy_item_id: '', atb_nome: '',
    via: undefined, indicacao: '', justificativa: '', origem_infeccao: '',
    dose: '', posologia: '', tempo_previsto_dias: undefined,
    data_inicio: hojeLocal(), // data local (toISOString vira amanha depois das 21h)
    data_final_prevista: '', data_final: '', dias_em_uso: undefined,
    status_antimicrobiano: 'em_uso', ccih_data_avaliacao: '',
    ccih_parecer: 'Aguardando', ccih_observacao: '', observacoes: '',
  })
  const [form, setForm] = useState<CreateAntimicrobialData>(blankForm())

  // ----- Load -----
  useEffect(() => {
    load()
    loadAtbItems()
  }, [])

  async function load() {
    setLoading(true); setError('')
    try { setRows(await antimicrobialControlsService.getAll()) }
    catch (e: any) { setError(getErrorMessage(e)) }
    finally { setLoading(false) }
  }

  async function loadAtbItems() {
    const { data } = await supabase
      .from('pharmacy_items')
      .select('id, name, medication_class')
      .eq('medication_class', 'antimicrobianos')
      .order('name')
      .limit(500)
    if (data) setAtbItems(data as PharmacyItem[])
  }

  // ----- Filter -----
  const filtered = useMemo(() => {
    let list = rows
    if (filterStatus) list = list.filter(r => r.status_antimicrobiano === filterStatus)
    const q = normalizarBusca(search)
    if (q) list = list.filter(r =>
      // prontuario/nome podem ser nulos: .toLowerCase() direto derrubava a tela
      normalizarBusca(r.paciente_nome).includes(q) ||
      normalizarBusca(r.prontuario).includes(q) ||
      normalizarBusca(r.atb_nome).includes(q)
    )
    return list
  }, [rows, search, filterStatus])

  // ----- Dashboard counts -----
  const totalRegistros  = rows.length
  const pacientesAtivos = useMemo(() => new Set(rows.filter(r => r.status_antimicrobiano === 'em_uso').map(r => r.prontuario)).size, [rows])
  const atbsEmUso       = rows.filter(r => r.status_antimicrobiano === 'em_uso').length
  const pendentesCCIH   = rows.filter(r => r.ccih_parecer === 'Aguardando' || !r.ccih_parecer).length

  // ----- Modal helpers -----
  function set<K extends keyof CreateAntimicrobialData>(k: K, v: CreateAntimicrobialData[K]) {
    setForm(f => ({ ...f, [k]: v }))
  }

  function openNew() {
    setEditingId(null); setForm(blankForm()); setFormError(''); setShowModal(true)
  }

  function openEdit(r: AntimicrobialControl) {
    setEditingId(r.id)
    setForm({
      paciente_nome: r.paciente_nome, prontuario: r.prontuario,
      setor_leito: r.setor_leito || '', data_internacao: r.data_internacao || '',
      dias_internacao: r.dias_internacao ?? undefined,
      status_paciente: r.status_paciente || 'internado',
      data_alta_obito: r.data_alta_obito || '', pharmacy_item_id: r.pharmacy_item_id || '',
      atb_nome: r.atb_nome || '', via: r.via || undefined,
      indicacao: r.indicacao || '', justificativa: r.justificativa || '',
      origem_infeccao: r.origem_infeccao || '', dose: r.dose || '',
      posologia: r.posologia || '', tempo_previsto_dias: r.tempo_previsto_dias ?? undefined,
      data_inicio: r.data_inicio,
      data_final_prevista: r.data_final_prevista || '', data_final: r.data_final || '',
      dias_em_uso: r.dias_em_uso ?? undefined,
      status_antimicrobiano: r.status_antimicrobiano || 'em_uso',
      ccih_data_avaliacao: r.ccih_data_avaliacao || '',
      ccih_parecer: r.ccih_parecer || 'Aguardando',
      ccih_observacao: r.ccih_observacao || '', observacoes: r.observacoes || '',
    })
    setFormError(''); setShowModal(true)
  }

  async function save() {
    if (!form.paciente_nome.trim()) { setFormError('Nome do paciente é obrigatório'); return }
    if (!form.prontuario.trim())    { setFormError('Prontuário é obrigatório'); return }
    if (!form.data_inicio)          { setFormError('Data de início é obrigatória'); return }
    setSaving(true); setFormError('')
    try {
      if (editingId) {
        await antimicrobialControlsService.update(editingId, form)
      } else {
        await antimicrobialControlsService.create(form)
      }
      setShowModal(false); await load()
    } catch (e: any) { setFormError(getErrorMessage(e)) }
    finally { setSaving(false) }
  }

  // ----- Render -----
  return (
    <div className="max-w-7xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-lg bg-purple-100"><ShieldAlert className="w-6 h-6 text-purple-600" /></div>
          <div>
            <h1 className="text-2xl font-bold" style={{ color: txt }}>Controle de Antimicrobianos</h1>
            <p className="text-sm" style={{ color: txtSec }}>Monitoramento e avaliação CCIH</p>
          </div>
        </div>
        <Button onClick={openNew} className="bg-purple-600 hover:bg-purple-700 text-white">
          <Plus className="w-4 h-4 mr-2" /> Novo Registro
        </Button>
      </div>

      {error && (
        <div className="p-3 rounded-lg bg-red-100 border border-red-200 text-red-800 text-sm flex items-center gap-2">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Dashboard */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total registros',   value: totalRegistros,  color: 'text-blue-600',    bg: 'bg-blue-50' },
          { label: 'Pacientes ativos',  value: pacientesAtivos, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'ATBs em uso',       value: atbsEmUso,       color: 'text-purple-600',  bg: 'bg-purple-50' },
          { label: 'Pendentes CCIH',    value: pendentesCCIH,   color: 'text-amber-600',   bg: 'bg-amber-50' },
        ].map(({ label, value, color, bg }) => (
          <div key={label} className={`p-4 rounded-xl ${bg} border border-white/60`}>
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1">{label}</p>
            <p className={`text-3xl font-bold ${color}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="p-4 flex flex-wrap gap-3 items-center" style={card}>
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
          <input
            placeholder="Buscar por paciente, prontuário ou ATB..."
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...inp, paddingLeft: 34 }}
          />
        </div>
        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value as StatusAntimicrobiano | '')}
          style={{ ...inp, width: 'auto', minWidth: 160 }}
        >
          <option value="">Todos os status</option>
          <option value="em_uso">Em uso</option>
          <option value="suspenso">Suspenso</option>
          <option value="concluido">Concluído</option>
        </select>
      </div>

      {/* Table */}
      <div className="overflow-x-auto" style={card}>
        {loading ? (
          <div className="flex items-center justify-center p-10" style={{ color: txtMut }}>
            <Loader2 className="w-5 h-5 animate-spin mr-2" /> Carregando...
          </div>
        ) : filtered.length === 0 ? (
          <p className="p-8 text-sm text-center" style={{ color: txtMut }}>Nenhum registro encontrado.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' }}>
                {['Paciente','Prontuário','Setor/Leito','Data início','ATB','Via','Dias em uso','Status','Pendente CCIH','Ações'].map(h => (
                  <th key={h} className="text-left px-3 py-3 text-xs font-semibold uppercase whitespace-nowrap" style={{ color: txtSec }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(r => {
                const isOpen = expandedId === r.id
                const dias = r.dias_em_uso ?? calcDaysInUse(r.data_inicio, r.data_final)
                const pendenteCCIH = !r.ccih_parecer || r.ccih_parecer === 'Aguardando'
                return (
                  <>
                    <tr
                      key={r.id}
                      style={{
                        borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`,
                        cursor: 'pointer',
                        background: isOpen ? (mode === 'dark' ? 'rgba(139,92,246,0.06)' : 'rgba(139,92,246,0.04)') : undefined,
                      }}
                      onClick={() => setExpandedId(isOpen ? null : r.id)}
                    >
                      <td className="px-3 py-3 font-medium" style={{ color: txt }}>{r.paciente_nome}</td>
                      <td className="px-3 py-3" style={{ color: txtSec }}>{r.prontuario}</td>
                      <td className="px-3 py-3" style={{ color: txtSec }}>{r.setor_leito || '—'}</td>
                      <td className="px-3 py-3 whitespace-nowrap" style={{ color: txtSec }}>{fmtDate(r.data_inicio)}</td>
                      <td className="px-3 py-3 font-medium" style={{ color: txt }}>{r.atb_nome || '—'}</td>
                      <td className="px-3 py-3" style={{ color: txtSec }}>{r.via || '—'}</td>
                      <td className="px-3 py-3 text-center" style={{ color: txtSec }}>{dias}d</td>
                      <td className="px-3 py-3"><StatusBadge status={r.status_antimicrobiano} /></td>
                      <td className="px-3 py-3">
                        {pendenteCCIH
                          ? <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full border bg-amber-50 text-amber-700 border-amber-200">Sim</span>
                          : <CcihBadge parecer={r.ccih_parecer} />
                        }
                      </td>
                      <td className="px-3 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <Button variant="outline" size="sm" onClick={() => openEdit(r)} className="h-7 px-2">
                            <Edit2 size={13} />
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setExpandedId(isOpen ? null : r.id)} className="h-7 px-2">
                            {isOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {isOpen && (
                      <tr key={`${r.id}-detail`} style={{ borderTop: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}` }}>
                        <td colSpan={10} className="px-4 py-4">
                          <ExpandedDetail r={r} txt={txt} txtSec={txtSec} txtMut={txtMut} mode={mode} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 overflow-y-auto" style={{ background: 'rgba(0,0,0,0.55)' }}>
          <div className="w-full max-w-3xl my-6 p-6 space-y-5" style={{
            background: mode === 'dark' ? 'rgba(10,15,20,0.95)' : 'rgba(255,255,255,0.97)',
            backdropFilter: 'blur(40px)', WebkitBackdropFilter: 'blur(40px)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            borderRadius: 18,
          }}>
            {/* Modal header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: txt }}>
                {editingId ? 'Editar Registro' : 'Novo Registro — Antimicrobiano'}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ color: txtMut }}><X size={18} /></button>
            </div>

            {formError && (
              <div className="p-2 rounded bg-red-100 border border-red-200 text-red-800 text-sm">{formError}</div>
            )}

            {/* Seção Paciente */}
            <SectionTitle label="Paciente" txt={txt} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Nome do paciente *" style={lbl}>
                <input value={form.paciente_nome} onChange={e => set('paciente_nome', e.target.value)} style={inp} />
              </Field>
              <Field label="Prontuário *" style={lbl}>
                <input value={form.prontuario} onChange={e => set('prontuario', e.target.value)} style={inp} />
              </Field>
              <Field label="Setor / Leito" style={lbl}>
                <input value={form.setor_leito || ''} onChange={e => set('setor_leito', e.target.value)} style={inp} />
              </Field>
              <Field label="Data de internação" style={lbl}>
                <input type="date" value={form.data_internacao || ''} onChange={e => set('data_internacao', e.target.value)} style={inp} />
              </Field>
              <Field label="Dias de internação" style={lbl}>
                <input type="number" min="0" value={form.dias_internacao ?? ''} onChange={e => set('dias_internacao', e.target.value ? Number(e.target.value) : undefined)} style={inp} />
              </Field>
              <Field label="Status do paciente" style={lbl}>
                <select value={form.status_paciente || ''} onChange={e => set('status_paciente', e.target.value as StatusPaciente)} style={inp as any}>
                  <option value="internado">Internado</option>
                  <option value="alta">Alta</option>
                  <option value="obito">Óbito</option>
                </select>
              </Field>
              <Field label="Data de alta / óbito" style={lbl}>
                <input type="date" value={form.data_alta_obito || ''} onChange={e => set('data_alta_obito', e.target.value)} style={inp} />
              </Field>
            </div>

            {/* Seção Antibiótico */}
            <div style={divider} />
            <SectionTitle label="Antibiótico" txt={txt} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="ATB (selecione do estoque)" style={lbl}>
                <select
                  value={form.pharmacy_item_id || ''}
                  onChange={e => {
                    const id = e.target.value
                    const item = atbItems.find(i => i.id === id)
                    set('pharmacy_item_id', id)
                    if (item) set('atb_nome', item.name)
                  }}
                  style={inp as any}
                >
                  <option value="">— selecionar item —</option>
                  {atbItems.map(i => <option key={i.id} value={i.id}>{i.name}</option>)}
                </select>
              </Field>
              <Field label="Nome do ATB (livre)" style={lbl}>
                <input value={form.atb_nome || ''} onChange={e => set('atb_nome', e.target.value)} style={inp} placeholder="Ou preencha manualmente" />
              </Field>
              <Field label="Via de administração" style={lbl}>
                <select value={form.via || ''} onChange={e => set('via', e.target.value as Via)} style={inp as any}>
                  <option value="">— selecionar —</option>
                  {(['IV','VO','IM','SC','Tópico'] as Via[]).map(v => <option key={v} value={v}>{v}</option>)}
                </select>
              </Field>
              <Field label="Indicação" style={lbl}>
                <input value={form.indicacao || ''} onChange={e => set('indicacao', e.target.value)} style={inp} />
              </Field>
              <Field label="Origem da infecção" style={lbl}>
                <input value={form.origem_infeccao || ''} onChange={e => set('origem_infeccao', e.target.value)} style={inp} />
              </Field>
              <Field label="Dose" style={lbl}>
                <input value={form.dose || ''} onChange={e => set('dose', e.target.value)} style={inp} placeholder="Ex: 500mg" />
              </Field>
              <Field label="Posologia" style={lbl}>
                <input value={form.posologia || ''} onChange={e => set('posologia', e.target.value)} style={inp} placeholder="Ex: 8/8h" />
              </Field>
            </div>
            <Field label="Justificativa" style={lbl}>
              <textarea rows={2} value={form.justificativa || ''} onChange={e => set('justificativa', e.target.value)} style={{ ...inp, resize: 'vertical' as const }} />
            </Field>

            {/* Seção Tratamento */}
            <div style={divider} />
            <SectionTitle label="Tratamento" txt={txt} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Data de início *" style={lbl}>
                <input type="date" value={form.data_inicio} onChange={e => set('data_inicio', e.target.value)} style={inp} />
              </Field>
              <Field label="Tempo previsto (dias)" style={lbl}>
                <input type="number" min="0" value={form.tempo_previsto_dias ?? ''} onChange={e => set('tempo_previsto_dias', e.target.value ? Number(e.target.value) : undefined)} style={inp} />
              </Field>
              <Field label="Data final prevista" style={lbl}>
                <input type="date" value={form.data_final_prevista || ''} onChange={e => set('data_final_prevista', e.target.value)} style={inp} />
              </Field>
              <Field label="Data final real" style={lbl}>
                <input type="date" value={form.data_final || ''} onChange={e => set('data_final', e.target.value)} style={inp} />
              </Field>
              <Field label="Dias em uso (calculado/manual)" style={lbl}>
                <input type="number" min="0" value={form.dias_em_uso ?? ''} onChange={e => set('dias_em_uso', e.target.value ? Number(e.target.value) : undefined)} style={inp} />
              </Field>
              <Field label="Status do antimicrobiano" style={lbl}>
                <select value={form.status_antimicrobiano || 'em_uso'} onChange={e => set('status_antimicrobiano', e.target.value as StatusAntimicrobiano)} style={inp as any}>
                  <option value="em_uso">Em uso</option>
                  <option value="suspenso">Suspenso</option>
                  <option value="concluido">Concluído</option>
                </select>
              </Field>
            </div>

            {/* Seção CCIH */}
            <div style={divider} />
            <SectionTitle label="CCIH" txt={txt} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Field label="Data de avaliação CCIH" style={lbl}>
                <input type="date" value={form.ccih_data_avaliacao || ''} onChange={e => set('ccih_data_avaliacao', e.target.value)} style={inp} />
              </Field>
              <Field label="Parecer CCIH" style={lbl}>
                <select value={form.ccih_parecer || 'Aguardando'} onChange={e => set('ccih_parecer', e.target.value as CcihParecer)} style={inp as any}>
                  <option value="Aguardando">Aguardando</option>
                  <option value="Aprovado">Aprovado</option>
                  <option value="Recusado">Recusado</option>
                </select>
              </Field>
            </div>
            <Field label="Observação CCIH" style={lbl}>
              <textarea rows={2} value={form.ccih_observacao || ''} onChange={e => set('ccih_observacao', e.target.value)} style={{ ...inp, resize: 'vertical' as const }} />
            </Field>

            {/* Observações gerais */}
            <div style={divider} />
            <Field label="Observações gerais" style={lbl}>
              <textarea rows={2} value={form.observacoes || ''} onChange={e => set('observacoes', e.target.value)} style={{ ...inp, resize: 'vertical' as const }} />
            </Field>

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowModal(false)}>Cancelar</Button>
              <Button onClick={save} disabled={saving} className="bg-purple-600 hover:bg-purple-700 text-white">
                {saving && <Loader2 size={14} className="mr-2 animate-spin" />} Salvar
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------
function SectionTitle({ label, txt }: { label: string; txt: string }) {
  return (
    <h3 className="text-sm font-semibold uppercase tracking-wider" style={{ color: txt }}>
      {label}
    </h3>
  )
}

function Field({ label, style, children }: { label: string; style: React.CSSProperties; children: React.ReactNode }) {
  return (
    <div>
      <label style={style}>{label}</label>
      {children}
    </div>
  )
}

function ExpandedDetail({
  r, txt, txtSec, txtMut, mode,
}: {
  r: AntimicrobialControl
  txt: string; txtSec: string; txtMut: string; mode: string
}) {
  const row = (label: string, value: string | number | null | undefined) => (
    <div key={label} className="flex gap-2">
      <span className="text-xs font-semibold uppercase w-40 shrink-0" style={{ color: txtMut }}>{label}</span>
      <span className="text-sm" style={{ color: value ? txtSec : txtMut }}>{value || '—'}</span>
    </div>
  )

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-x-8 gap-y-2 p-2 rounded-xl" style={{
      background: mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
      border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'}`,
    }}>
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: txt }}>Paciente</p>
        {row('Setor/Leito', r.setor_leito)}
        {row('Data internação', fmtDate(r.data_internacao))}
        {row('Dias internação', r.dias_internacao)}
        {row('Status paciente', r.status_paciente)}
        {row('Data alta/óbito', fmtDate(r.data_alta_obito))}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: txt }}>Antibiótico</p>
        {row('Via', r.via)}
        {row('Dose', r.dose)}
        {row('Posologia', r.posologia)}
        {row('Indicação', r.indicacao)}
        {row('Origem infecção', r.origem_infeccao)}
        {row('Justificativa', r.justificativa)}
      </div>
      <div className="space-y-2">
        <p className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: txt }}>Tratamento / CCIH</p>
        {row('Tempo previsto', r.tempo_previsto_dias ? `${r.tempo_previsto_dias} dias` : null)}
        {row('Início', fmtDate(r.data_inicio))}
        {row('Fim previsto', fmtDate(r.data_final_prevista))}
        {row('Fim real', fmtDate(r.data_final))}
        {row('Avaliação CCIH', fmtDate(r.ccih_data_avaliacao))}
        {row('Obs. CCIH', r.ccih_observacao)}
        {row('Observações', r.observacoes)}
      </div>
    </div>
  )
}
