// =====================================================================
// Devolução da Enfermagem — 2 etapas (decisão de 16/09/2026)
// Enfermagem (setores em farmacia_setores_enfermagem): registra a devolução,
//   que fica PENDENTE. Origem obrigatória: o posto/setor de onde voltou.
// Farmácia (atendente/gestor/administrador/farmacêutico): CONFIRMA as pendentes,
//   item a item, e desde 17/09/2026 também REGISTRA devolução — que já nasce
//   confirmada, porque é a própria farmácia que recebe. Origem obrigatória.
// Tudo grava por RPC (farmacia_devolucao_enviar / farmacia_devolucao_confirmar):
// lote, saldo, movimento e status numa transação só.
// =====================================================================

import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import { ArrowLeft, Search, Plus, Trash2, Loader2, AlertCircle, CheckCircle2, Clock, Undo2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { stockService } from '@/lib/services/stock'
import { getErrorMessage } from '@/lib/utils/error-messages'
import type { StockLocation } from '@/lib/types/stock'

export const MOTIVO_OPTIONS = [
  { value: 'recusa_paciente', label: 'Recusa do paciente' },
  { value: 'sem_acesso_venoso', label: 'Sem acesso venoso' },
  { value: 'encontrado_posto', label: 'Encontrado no posto (box/gaveta)' },
  { value: 'melhora_clinica', label: 'Melhora clínica' },
  { value: 'suspensao_medica', label: 'Suspensão médica' },
  { value: 'erro_dispensacao', label: 'Erro de dispensação' },
  { value: 'alta_paciente', label: 'Alta do paciente' },
  { value: 'obito', label: 'Óbito' },
  { value: 'troca_terapeutica', label: 'Troca terapêutica' },
  { value: 'outro', label: 'Outro' },
] as const

type MotivoValue = typeof MOTIVO_OPTIONS[number]['value'] | ''

interface ItemRow {
  id: string
  code: string | null
  name: string
  unit: string
}
interface ReturnLine {
  // Identidade da LINHA (não do item): o mesmo medicamento pode aparecer em
  // várias linhas, uma por lote.
  uid: string
  item_id: string
  item_name: string
  unit: string
  quantity: number
  batch_number: string
  expiry_date: string
}

interface PendingReturn {
  id: string
  return_number: number
  patient_name: string | null
  patient_prontuario: string | null
  return_reason: string | null
  observacao: string | null
  returned_at: string
  target_location_id: string
  origem: string | null
  destino: string | null
  enviado_por: string | null
  items: Array<{
    id: string
    item_id: string
    quantity: number
    batch_number: string | null
    expiry_date: string | null
    item_name?: string
    unit?: string
  }>
}

const PHARMACY_ROLES = new Set(['atendente', 'gestor', 'administrador', 'pharmacist'])

function rotuloMotivo(v: string | null) {
  return MOTIVO_OPTIONS.find((o) => o.value === v)?.label ?? v ?? '—'
}

function dataBR(d: string | null) {
  if (!d) return '—'
  const [a, m, dia] = d.slice(0, 10).split('-')
  return `${dia}/${m}/${a}`
}

export function DevolucaoInterna() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { mode } = useTheme()
  const { activeStock } = useModule()

  const isPharmacy = !!user?.role && PHARMACY_ROLES.has(user.role)

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
    borderRadius: 10,
    padding: '10px 14px',
    fontSize: 14,
    color: txt,
    outline: 'none',
    width: '100%',
  }
  const labelStyle: React.CSSProperties = {
    color: txtSec,
    fontSize: 13,
    fontWeight: 600,
    marginBottom: 4,
    display: 'block',
  }
  const divisor = `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'}`

  // ---- Quem é quem ----
  // Setores de enfermagem vêm do banco (a mesma lista que a RPC confere).
  const [setoresEnfermagem, setSetoresEnfermagem] = useState<Array<{ id: string; name: string }>>([])
  const [carregandoPerfil, setCarregandoPerfil] = useState(true)
  const isEnfermagem = !!user?.department_id && setoresEnfermagem.some((s) => s.id === user.department_id)

  const [activeTab, setActiveTab] = useState<'nova' | 'pendentes'>('nova')

  // ---- Form (enfermagem) ----
  const [patientName, setPatientName] = useState('')
  const [prontuario, setProntuario] = useState('')
  const [motivo, setMotivo] = useState<MotivoValue>('')
  const [observacao, setObservacao] = useState('')
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10))
  const [lines, setLines] = useState<ReturnLine[]>([])
  const [search, setSearch] = useState('')
  const [items, setItems] = useState<ItemRow[]>([])
  const [locations, setLocations] = useState<StockLocation[]>([])
  const [targetLocationId, setTargetLocationId] = useState<string>('')
  // Sem pré-preenchimento: o setor do usuário é quase sempre "Unidade de
  // Internação", e a devolução precisa dizer de QUAL posto voltou.
  const [sourceDepartmentId, setSourceDepartmentId] = useState<string>('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // ---- Pendentes (farmácia) ----
  const [pendentes, setPendentes] = useState<PendingReturn[]>([])
  const [loadingPendentes, setLoadingPendentes] = useState(false)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [recebidos, setRecebidos] = useState<Record<string, number>>({})
  const [divergenceNotes, setDivergenceNotes] = useState<Record<string, string>>({})
  const [confirmingSubmit, setConfirmingSubmit] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const { data: setores } = await supabase
          .from('farmacia_setores_enfermagem')
          .select('department_id, departments(name)')
        const lista = (setores ?? [])
          .map((s: any) => ({ id: s.department_id as string, name: (s.departments?.name as string) ?? '' }))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
        setSetoresEnfermagem(lista)

        const locs = await stockService.getLocations()
        const pharmacyLocs = locs.filter((l) => l.code === 'CAF' || l.code.startsWith('SAT'))
        setLocations(pharmacyLocs)
        const initial = (activeStock && pharmacyLocs.find((l) => l.id === activeStock.id)?.id) || ''
        setTargetLocationId(initial)
      } catch (e: any) {
        setError(getErrorMessage(e))
      } finally {
        setCarregandoPerfil(false)
      }
      const { data } = await supabase
        .from('pharmacy_items')
        .select('id, code, name, unit')
        .eq('is_active', true)
        .order('name')
        .limit(2000)
      setItems((data || []) as ItemRow[])
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeStock?.id])

  // Farmácia (que não é enfermagem) abre direto nos pendentes.
  useEffect(() => {
    if (!carregandoPerfil && isPharmacy && !isEnfermagem) setActiveTab('pendentes')
  }, [carregandoPerfil, isPharmacy, isEnfermagem])

  const loadPendentes = async () => {
    setLoadingPendentes(true)
    try {
      let query = supabase
        .from('stock_returns')
        .select(`
          id, return_number, patient_name, patient_prontuario, return_reason, observacao,
          returned_at, target_location_id,
          departments(name),
          stock_locations!stock_returns_target_location_id_fkey(name),
          users!stock_returns_returned_by_user_id_fkey(full_name),
          stock_return_items (id, item_id, quantity, batch_number, expiry_date)
        `)
        .eq('return_status', 'pending')
        .order('returned_at', { ascending: true })
      // No satélite, só o que foi devolvido para ele. No CAF (ou sem estoque
      // escolhido), todas.
      if (activeStock && activeStock.code.startsWith('SAT')) {
        query = query.eq('target_location_id', activeStock.id)
      }
      const { data, error: err } = await query
      if (err) throw err

      const rows: PendingReturn[] = (data || []).map((r: any) => ({
        id: r.id,
        return_number: r.return_number,
        patient_name: r.patient_name,
        patient_prontuario: r.patient_prontuario,
        return_reason: r.return_reason,
        observacao: r.observacao,
        returned_at: r.returned_at,
        target_location_id: r.target_location_id,
        origem: r.departments?.name ?? null,
        destino: r.stock_locations?.name ?? null,
        enviado_por: r.users?.full_name ?? null,
        items: r.stock_return_items || [],
      }))

      const ids = Array.from(new Set(rows.flatMap((r) => r.items.map((i) => i.item_id))))
      if (ids.length > 0) {
        const { data: pharmItems } = await supabase.from('pharmacy_items').select('id, name, unit').in('id', ids)
        const mapa: Record<string, { name: string; unit: string }> = {}
        ;(pharmItems || []).forEach((pi: any) => { mapa[pi.id] = { name: pi.name, unit: pi.unit } })
        rows.forEach((r) => {
          r.items = r.items.map((i) => ({ ...i, item_name: mapa[i.item_id]?.name ?? i.item_id, unit: mapa[i.item_id]?.unit }))
        })
      }
      setPendentes(rows)
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setLoadingPendentes(false)
    }
  }

  useEffect(() => {
    if (isPharmacy && activeTab === 'pendentes') loadPendentes()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPharmacy, activeTab, activeStock?.id])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return items.slice(0, 15)
    return items
      .filter((i) => i.name.toLowerCase().includes(q) || (i.code || '').toLowerCase().includes(q))
      .slice(0, 15)
  }, [items, search])

  const addItem = (i: ItemRow) => {
    setLines((prev) => [
      ...prev,
      { uid: crypto.randomUUID(), item_id: i.id, item_name: i.name, unit: i.unit, quantity: 1, batch_number: '', expiry_date: '' },
    ])
    setSearch('')
  }
  const updateQty = (uid: string, q: number) =>
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, quantity: Math.max(1, q) } : l)))
  const setBatch = (uid: string, v: string) =>
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, batch_number: v } : l)))
  const setValidade = (uid: string, v: string) =>
    setLines((prev) => prev.map((l) => (l.uid === uid ? { ...l, expiry_date: v } : l)))
  const removeLine = (uid: string) => setLines((prev) => prev.filter((l) => l.uid !== uid))

  const canSubmit =
    (isEnfermagem || isPharmacy) &&
    !!targetLocationId &&
    !!sourceDepartmentId &&
    lines.length > 0 &&
    lines.every((l) => l.quantity > 0 && !!l.batch_number.trim() && !!l.expiry_date) &&
    motivo !== ''

  const handleSubmit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    setError('')
    setSuccess('')
    try {
      const { data, error: e1 } = await supabase.rpc('farmacia_devolucao_enviar', {
        p_origem_department_id: sourceDepartmentId,
        p_target_location_id: targetLocationId,
        p_returned_at: returnDate,
        p_motivo: motivo,
        p_observacao: observacao.trim() || null,
        p_patient_name: patientName.trim() || null,
        p_prontuario: prontuario.trim() || null,
        p_itens: lines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          batch_number: l.batch_number.trim(),
          expiry_date: l.expiry_date,
        })),
      })
      if (e1) throw e1
      const numero = (data as any)?.numero
      setSuccess((data as any)?.status === 'confirmed'
        ? `Devolução ${numero ? `nº ${numero} ` : ''}registrada e confirmada. O estoque já foi atualizado.`
        : `Devolução ${numero ? `nº ${numero} ` : ''}enviada. Ela fica pendente até a farmácia confirmar o recebimento.`)
      setPatientName('')
      setProntuario('')
      setMotivo('')
      setObservacao('')
      setSourceDepartmentId('')
      setLines([])
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const abrirConfirmacao = (p: PendingReturn) => {
    if (confirmingId === p.id) { setConfirmingId(null); return }
    setConfirmingId(p.id)
    setRecebidos((prev) => {
      const novo = { ...prev }
      p.items.forEach((it) => { if (novo[it.id] === undefined) novo[it.id] = it.quantity })
      return novo
    })
  }

  const handleConfirm = async (p: PendingReturn) => {
    setConfirmingSubmit(p.id)
    setError('')
    setSuccess('')
    try {
      const { error: e1 } = await supabase.rpc('farmacia_devolucao_confirmar', {
        p_return_id: p.id,
        p_itens: p.items.map((it) => ({ id: it.id, confirmed_quantity: recebidos[it.id] ?? it.quantity })),
        p_divergencia: divergenceNotes[p.id]?.trim() || null,
      })
      if (e1) throw e1
      setSuccess(`Recebimento da devolução nº ${p.return_number} confirmado.`)
      setConfirmingId(null)
      await loadPendentes()
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setConfirmingSubmit(null)
    }
  }

  // Farmácia também registra (17/09/2026): nasce confirmada, porque é ela quem recebe.
  const mostraNova = isEnfermagem || isPharmacy
  const mostraPendentes = isPharmacy

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate(-1)}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
            background: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            color: txt,
          }}
        >
          <ArrowLeft size={18} />
        </button>
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap" style={{ color: txt }}>
            <Undo2 size={22} /> Devolução da Enfermagem
          </h1>
          <p className="text-sm" style={{ color: txtSec }}>
            {isEnfermagem
              ? 'Registre a devolução. Ela fica pendente até a farmácia confirmar o recebimento.'
              : isPharmacy
                ? 'Registre devoluções recebidas na farmácia ou confirme as enviadas pela enfermagem.'
                : mostraPendentes
                ? 'Confirme o recebimento das devoluções enviadas pela enfermagem.'
                : 'Devoluções são registradas pela enfermagem e confirmadas pela farmácia.'}
          </p>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && (
        <div className="p-4 rounded-xl bg-emerald-100 border border-emerald-200 flex items-center gap-2 text-emerald-800 text-sm">
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {carregandoPerfil ? (
        <div className="p-12 flex justify-center" style={glass}>
          <Loader2 className="w-6 h-6 animate-spin" style={{ color: txtMut }} />
        </div>
      ) : !mostraNova && !mostraPendentes ? (
        <div className="p-8 text-center space-y-2" style={glass}>
          <p className="font-semibold" style={{ color: txt }}>Seu perfil não registra devoluções.</p>
          <p className="text-sm" style={{ color: txtSec }}>
            A devolução é feita pela enfermagem ({setoresEnfermagem.map((s) => s.name).join(', ')}) e confirmada pela farmácia.
            Se você é da enfermagem e vê esta mensagem, peça ao administrador para conferir o setor do seu usuário.
          </p>
        </div>
      ) : (
        <>
          {mostraNova && mostraPendentes && (
            <div className="flex gap-2">
              {(['nova', 'pendentes'] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => { setActiveTab(tab); setError(''); setSuccess('') }}
                  style={{
                    padding: '8px 20px', borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: 'pointer',
                    background: activeTab === tab
                      ? (mode === 'dark' ? 'rgba(16,185,129,0.25)' : 'rgba(16,185,129,0.15)')
                      : (mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'),
                    color: activeTab === tab ? '#10b981' : txtSec,
                    border: `1px solid ${activeTab === tab ? '#10b981' : 'transparent'}`,
                  }}
                >
                  {tab === 'nova' ? 'Nova Devolução' : 'Pendentes'}
                </button>
              ))}
            </div>
          )}

          {/* ===== NOVA DEVOLUÇÃO (enfermagem) ===== */}
          {mostraNova && activeTab === 'nova' && (
            <>
              <div className="p-4 rounded-xl flex flex-col md:flex-row items-stretch md:items-center gap-3"
                style={{
                  background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)',
                  border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
                }}>
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: txtMut }}>De (Posto/setor de origem) *</p>
                  <select
                    value={sourceDepartmentId}
                    onChange={(e) => setSourceDepartmentId(e.target.value)}
                    style={{ ...inputStyle, padding: '6px 10px', fontSize: 14, fontWeight: 600 }}
                  >
                    <option value="">— De onde o medicamento está voltando? —</option>
                    {setoresEnfermagem.map((d) => (
                      <option key={d.id} value={d.id}>{d.name}</option>
                    ))}
                  </select>
                </div>
                <div className="hidden md:block" style={{ color: txtMut }}>➜</div>
                <div className="flex-1">
                  <p className="text-xs font-semibold uppercase tracking-wide mb-1" style={{ color: txtMut }}>Para (Farmácia) *</p>
                  {activeStock && activeStock.code.startsWith('SAT') ? (
                    <div
                      className="p-3 rounded-lg flex items-center justify-between"
                      style={{
                        background: mode === 'dark' ? 'rgba(45,180,140,0.15)' : 'rgba(45,180,140,0.10)',
                        border: `1px solid ${mode === 'dark' ? 'rgba(45,180,140,0.3)' : 'rgba(45,180,140,0.2)'}`,
                      }}
                    >
                      <span style={{ color: txt, fontWeight: 600, fontSize: 14 }}>{activeStock.name}</span>
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: 'rgba(45,180,140,0.2)', color: '#0d5a3a' }}>Fixo</span>
                    </div>
                  ) : (
                    <select
                      value={targetLocationId}
                      onChange={(e) => setTargetLocationId(e.target.value)}
                      style={{ ...inputStyle, padding: '6px 10px', fontSize: 14, fontWeight: 600 }}
                    >
                      <option value="">— Para qual farmácia? —</option>
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>{l.name}</option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="p-6 space-y-5" style={glass}>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label style={labelStyle}>Prontuário <span style={{ color: txtMut, fontWeight: 400 }}>(opcional)</span></label>
                    <input value={prontuario} onChange={(e) => setProntuario(e.target.value)} placeholder="Número do prontuário" style={inputStyle} />
                  </div>
                  <div>
                    <label style={labelStyle}>Nome do Paciente <span style={{ color: txtMut, fontWeight: 400 }}>(opcional)</span></label>
                    <input value={patientName} onChange={(e) => setPatientName(e.target.value)} placeholder="Nome completo do paciente" style={inputStyle} />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label style={labelStyle}>Motivo da Devolução <span style={{ color: '#ef4444' }}>*</span></label>
                    <select value={motivo} onChange={(e) => setMotivo(e.target.value as MotivoValue)} style={{ ...inputStyle, appearance: 'auto', cursor: 'pointer' }}>
                      <option value="" disabled>Selecione o motivo...</option>
                      {MOTIVO_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label style={labelStyle}>Data da Devolução <span style={{ color: '#ef4444' }}>*</span></label>
                    <input type="date" value={returnDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReturnDate(e.target.value)} style={{ ...inputStyle, cursor: 'pointer' }} />
                  </div>
                </div>

                <div>
                  <label style={labelStyle}>Observação <span style={{ color: txtMut, fontWeight: 400 }}>(opcional)</span></label>
                  <textarea
                    value={observacao}
                    onChange={(e) => setObservacao(e.target.value)}
                    rows={2}
                    placeholder="Informações adicionais sobre a devolução."
                    style={{ ...inputStyle, resize: 'vertical' as const }}
                  />
                </div>

                <div>
                  <label style={labelStyle}>Adicionar Item</label>
                  <div className="relative">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
                    <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item por nome ou código..." style={{ ...inputStyle, paddingLeft: 36 }} />
                    {search && (
                      <div
                        className="mt-2 max-h-56 overflow-y-auto rounded-lg"
                        style={{
                          border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
                          background: mode === 'dark' ? 'rgba(10,15,20,0.9)' : 'rgba(255,255,255,0.95)',
                          position: 'relative',
                          zIndex: 10,
                        }}
                      >
                        {filtered.length === 0 ? (
                          <p className="p-3 text-sm text-center" style={{ color: txtMut }}>Nenhum item encontrado</p>
                        ) : (
                          filtered.map((i) => {
                            const qtdLinhas = lines.filter((l) => l.item_id === i.id).length
                            return (
                              <button key={i.id} onClick={() => addItem(i)} className="w-full text-left p-3 hover:bg-gray-100 dark:hover:bg-white/5 transition-colors block">
                                <p className="text-sm font-medium" style={{ color: txt }}>
                                  {i.name}
                                  {qtdLinhas > 0 && (
                                    <span className="ml-1 text-xs text-blue-500">({qtdLinhas} {qtdLinhas === 1 ? 'lote' : 'lotes'} — clique p/ outro)</span>
                                  )}
                                </p>
                                <p className="text-xs" style={{ color: txtMut }}>{i.code || 'sem código'} • {i.unit}</p>
                              </button>
                            )
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {lines.length > 0 && (
                  <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}` }}>
                    <table className="w-full">
                      <thead>
                        <tr className="text-xs" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)', color: txtMut }}>
                          <th className="text-left p-2">Item</th>
                          <th className="text-right p-2 w-24">Qtd *</th>
                          <th className="text-left p-2 w-56">Lote *</th>
                          <th className="text-left p-2 w-40">Validade *</th>
                          <th className="w-12"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {lines.map((l) => (
                          <tr key={l.uid} style={{ borderTop: divisor }}>
                            <td className="p-2 text-sm" style={{ color: txt }}>
                              {l.item_name} <span style={{ color: txtMut }}>({l.unit})</span>
                            </td>
                            <td className="p-2">
                              <input
                                type="number" min={1} value={l.quantity}
                                onChange={(e) => updateQty(l.uid, parseInt(e.target.value) || 1)}
                                onWheel={(e) => e.currentTarget.blur()}
                                style={{ ...inputStyle, padding: '4px 8px', textAlign: 'right' }}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="text" value={l.batch_number} onChange={(e) => setBatch(l.uid, e.target.value)} placeholder="Ex: L010203"
                                style={{ ...inputStyle, padding: '4px 8px', fontSize: 13, borderColor: l.batch_number.trim() ? undefined : '#ef4444' }}
                              />
                            </td>
                            <td className="p-2">
                              <input
                                type="date" value={l.expiry_date} onChange={(e) => setValidade(l.uid, e.target.value)}
                                style={{ ...inputStyle, padding: '4px 8px', fontSize: 13, borderColor: l.expiry_date ? undefined : '#ef4444' }}
                              />
                            </td>
                            <td className="p-2">
                              <Button variant="ghost" size="sm" onClick={() => removeLine(l.uid)} className="text-red-600 hover:bg-red-50 h-8 px-2">
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <div className="flex justify-end gap-2 pt-2">
                  <Button variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
                  <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    {isEnfermagem ? 'Enviar para a Farmácia' : 'Registrar Devolução'}
                  </Button>
                </div>
              </div>
            </>
          )}

          {/* ===== PENDENTES (farmácia) ===== */}
          {mostraPendentes && activeTab === 'pendentes' && (
            <div className="space-y-4">
              {loadingPendentes ? (
                <div className="p-12 flex justify-center" style={glass}>
                  <Loader2 className="w-6 h-6 animate-spin" style={{ color: txtMut }} />
                </div>
              ) : pendentes.length === 0 ? (
                <div className="p-8 text-center" style={glass}>
                  <CheckCircle2 size={32} className="mx-auto mb-3" style={{ color: '#10b981' }} />
                  <p className="text-sm font-medium" style={{ color: txtSec }}>
                    Nenhuma devolução pendente{activeStock && activeStock.code.startsWith('SAT') ? ` para ${activeStock.name}` : ''}.
                  </p>
                </div>
              ) : (
                pendentes.map((p) => {
                  const aberto = confirmingId === p.id
                  const temDivergencia = p.items.some((it) => (recebidos[it.id] ?? it.quantity) !== it.quantity)
                  return (
                    <div key={p.id} className="p-5 space-y-4" style={glass}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <Clock size={14} style={{ color: '#f59e0b' }} />
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.15)', color: '#f59e0b' }}>
                              Pendente
                            </span>
                            <span className="text-xs" style={{ color: txtMut }}>Nº {p.return_number} • {dataBR(p.returned_at)}</span>
                          </div>
                          <p className="font-semibold" style={{ color: txt }}>
                            {p.origem ?? '—'} <span style={{ color: txtMut }}>➜</span> {p.destino ?? '—'}
                          </p>
                          <p className="text-sm" style={{ color: txtSec }}>
                            Enviado por {p.enviado_por ?? '—'} • Motivo: {rotuloMotivo(p.return_reason)}
                          </p>
                          {(p.patient_name || p.patient_prontuario) && (
                            <p className="text-sm" style={{ color: txtSec }}>
                              Paciente: {p.patient_name || '—'}{p.patient_prontuario ? ` • Prontuário ${p.patient_prontuario}` : ''}
                            </p>
                          )}
                          {p.observacao && <p className="text-sm" style={{ color: txtSec }}>Obs.: {p.observacao}</p>}
                        </div>
                        <Button size="sm" onClick={() => abrirConfirmacao(p)} className="bg-emerald-600 hover:bg-emerald-700 text-white flex-shrink-0">
                          <CheckCircle2 size={14} className="mr-1" />
                          Confirmar Recebimento
                        </Button>
                      </div>

                      <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.07)'}` }}>
                        <table className="w-full">
                          <thead>
                            <tr style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
                              <th className="text-left p-2 text-xs" style={{ color: txtMut }}>Item</th>
                              <th className="text-left p-2 text-xs" style={{ color: txtMut }}>Lote / validade</th>
                              <th className="text-right p-2 text-xs w-24" style={{ color: txtMut }}>Enviado</th>
                              {aberto && <th className="text-right p-2 text-xs w-28" style={{ color: '#10b981' }}>Recebido *</th>}
                            </tr>
                          </thead>
                          <tbody>
                            {p.items.map((it) => (
                              <tr key={it.id} style={{ borderTop: divisor }}>
                                <td className="p-2 text-sm" style={{ color: txt }}>
                                  {it.item_name} {it.unit && <span style={{ color: txtMut }}>({it.unit})</span>}
                                </td>
                                <td className="p-2 text-sm" style={{ color: txtSec }}>
                                  {it.batch_number || '—'} • {dataBR(it.expiry_date)}
                                </td>
                                <td className="p-2 text-sm text-right font-semibold" style={{ color: txt }}>{it.quantity}</td>
                                {aberto && (
                                  <td className="p-2">
                                    <input
                                      type="number" min={0} max={it.quantity}
                                      value={recebidos[it.id] ?? it.quantity}
                                      onChange={(e) => {
                                        const v = Math.max(0, Math.min(it.quantity, parseInt(e.target.value) || 0))
                                        setRecebidos((prev) => ({ ...prev, [it.id]: v }))
                                      }}
                                      onWheel={(e) => e.currentTarget.blur()}
                                      style={{ ...inputStyle, padding: '4px 8px', textAlign: 'right' }}
                                    />
                                  </td>
                                )}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {aberto && (
                        <div className="p-4 space-y-3 rounded-xl" style={{ background: mode === 'dark' ? 'rgba(16,185,129,0.08)' : 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.25)' }}>
                          <label style={{ ...labelStyle, color: temDivergencia ? '#dc2626' : '#10b981' }}>
                            {temDivergencia ? 'Divergência (obrigatório: a quantidade recebida é diferente da enviada)' : 'Observações sobre divergências (opcional)'}
                          </label>
                          <textarea
                            value={divergenceNotes[p.id] || ''}
                            onChange={(e) => setDivergenceNotes((prev) => ({ ...prev, [p.id]: e.target.value }))}
                            rows={2}
                            placeholder="Ex.: chegaram 8 das 10 ampolas; 2 quebradas."
                            style={{ ...inputStyle, resize: 'vertical' as const }}
                          />
                          <p className="text-xs" style={{ color: txtMut }}>
                            Ao confirmar, a quantidade recebida entra no estoque de {p.destino ?? 'destino'} no lote informado.
                          </p>
                          <div className="flex justify-end gap-2">
                            <Button variant="outline" size="sm" onClick={() => setConfirmingId(null)}>Cancelar</Button>
                            <Button
                              size="sm"
                              disabled={confirmingSubmit === p.id || (temDivergencia && (divergenceNotes[p.id]?.trim().length ?? 0) < 5)}
                              onClick={() => handleConfirm(p)}
                              className="bg-emerald-600 hover:bg-emerald-700 text-white"
                            >
                              {confirmingSubmit === p.id ? <Loader2 size={14} className="mr-1 animate-spin" /> : <CheckCircle2 size={14} className="mr-1" />}
                              Confirmar
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
