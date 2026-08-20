import { useState, useEffect, useMemo } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useTheme } from '@/contexts/theme'
import {
  ArrowLeft, ArrowRight, Search, Trash2, Loader2, AlertCircle, AlertTriangle,
  UserCheck, Stethoscope, Pill, CheckCircle2, Building2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { pharmacyDispensationService } from '@/lib/services/pharmacy-dispensation'
import { patientsService, prescribersService } from '@/lib/services/farmacia-cadastros'
import { departmentsService } from '@/lib/services/departments'
import type { Patient, Prescriber, PatientAdmission } from '@/lib/types/farmacia'
import type { Department } from '@/lib/types/departments'
import type { DispensationType } from '@/lib/types/dispensation'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { useModule } from '@/contexts/module'
interface SelectedItem {
  item_id: string
  name: string
  code: string
  unit: string
  is_mav: boolean
  medication_class: string | null
  // lote escolhido (FEFO por padrão; pode trocar no seletor)
  expiry_tracking_id: string | null
  batch_number: string | null
  expiry_date: string | null
  available_in_batch: number
  item_stock: number // estoque agregado (para opção "sem lote")
  quantity: number
  // MATERIAL: lote digitado na hora ("Outro lote"). Muito material do satélite
  // veio por solicitação do almoxarifado sem lote no sistema — a operadora está
  // com a caixa na mão e digita o que está impresso nela.
  manual_lot?: boolean
}

interface PharmacyItemRow {
  id: string
  code: string | null
  name: string
  unit: string
  current_stock: number
  is_mav: boolean
  medication_class: string | null
}

interface LotRow {
  id: string
  batch_number: string
  expiry_date: string | null
  current_quantity: number
}

// Valor sentinela do seletor de lote para "digitar o lote na hora" (só material).
const MANUAL_LOT = '__manual__'

const STEPS_PRESCRICAO = [
  { label: 'Paciente', icon: UserCheck },
  { label: 'Prescritor', icon: Stethoscope },
  { label: 'Medicamentos', icon: Pill },
  { label: 'Resumo', icon: CheckCircle2 },
]
const STEPS_REQUISICAO = [
  { label: 'Setor', icon: Building2 },
  { label: 'Medicamentos', icon: Pill },
  { label: 'Resumo', icon: CheckCircle2 },
]

export function NewDispensation() {
  const navigate = useNavigate()
  const location = useLocation()
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
  const inputStyle: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(0,0,0,0.3)' : 'rgba(255,255,255,0.7)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.1)'}`,
    borderRadius: 10, padding: '10px 14px', fontSize: 14,
    color: txt, outline: 'none', width: '100%',
  }
  const lbl: React.CSSProperties = {
    color: txtSec, fontSize: 12, fontWeight: 600, textTransform: 'uppercase',
    letterSpacing: 0.5, display: 'block', marginBottom: 4,
  }
  const dropdownStyle: React.CSSProperties = {
    position: 'absolute', zIndex: 50, width: '100%', marginTop: 4,
    background: mode === 'dark' ? 'rgba(15,20,28,0.98)' : 'rgba(255,255,255,0.98)',
    backdropFilter: 'blur(20px)', WebkitBackdropFilter: 'blur(20px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)'}`,
    borderRadius: 10, maxHeight: 260, overflowY: 'auto',
  }

  const [step, setStep] = useState(0)

  // Tipo: 'prescricao' (paciente+prescritor) | 'requisicao' (só setor).
  const navState = (location.state as { patient?: Patient; tipo?: DispensationType } | null) ?? null
  const tipo: DispensationType = navState?.tipo ?? 'prescricao'
  const isRequisicao = tipo === 'requisicao'
  const STEPS = isRequisicao ? STEPS_REQUISICAO : STEPS_PRESCRICAO
  const STEP_RESUMO = STEPS.length - 1
  const STEP_MEDS = isRequisicao ? 1 : 2

  // Etapa Paciente (presc.) — vem pré-selecionado da tela /dispensacao/paciente
  const prefilledPatient = navState?.patient ?? null
  const [patientSearch, setPatientSearch] = useState('')
  const [patientResults, setPatientResults] = useState<Patient[]>([])
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(prefilledPatient)
  const [openAdmission, setOpenAdmission] = useState<PatientAdmission | null>(null)

  // Etapa Setor (req.)
  const [departments, setDepartments] = useState<Department[]>([])
  const [selectedSector, setSelectedSector] = useState<string>('')
  // Data da RM (Requisicao de Material) — opcional: nem toda requisicao chega
  // com a RM datada.
  const [rmDate, setRmDate] = useState('')
  // Paciente na requisicao — OPCIONAL: o pedido e do setor, entao pode nao
  // haver paciente. Texto livre (nao amarra em patients).
  const [reqPatientName, setReqPatientName] = useState('')

  // Prescrição (data) + prescritor
  const [prescriptionDate, setPrescriptionDate] = useState('')

  // Etapa 3 — Prescritor
  const [prescSearch, setPrescSearch] = useState('')
  const [prescResults, setPrescResults] = useState<Prescriber[]>([])
  const [selectedPresc, setSelectedPresc] = useState<Prescriber | null>(null)

  // Etapa 4 — Medicamentos
  const [itemSearch, setItemSearch] = useState('')
  const [itemResults, setItemResults] = useState<PharmacyItemRow[]>([])
  const [searchingItems, setSearchingItems] = useState(false)
  const [addingItem, setAddingItem] = useState<string | null>(null)
  const [lotsByItem, setLotsByItem] = useState<Record<string, LotRow[]>>({})
  const [selectedItems, setSelectedItems] = useState<SelectedItem[]>([])

  // Etapa 5 — Resumo / submit
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [showMavConfirm, setShowMavConfirm] = useState(false)
  const [mavConfirmText, setMavConfirmText] = useState('')

  const hasMav = useMemo(() => selectedItems.some((i) => i.is_mav), [selectedItems])
  const needsApproval = useMemo(
    () => selectedItems.some((i) => i.is_mav || i.medication_class === 'controlados' || i.medication_class === 'antimicrobianos'),
    [selectedItems]
  )

  useEffect(() => {
    if (!isRequisicao) return
    departmentsService.getAll()
      .then(setDepartments)
      .catch((e) => console.error('Falha ao carregar setores:', e))
  }, [isRequisicao])

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!patientSearch.trim() || selectedPatient) return setPatientResults([])
      try { setPatientResults(await patientsService.search(patientSearch)) }
      catch (e) { console.error(e) }
    }, 200)
    return () => clearTimeout(t)
  }, [patientSearch, selectedPatient])

  useEffect(() => {
    if (!selectedPatient) { setOpenAdmission(null); return }
    patientsService.getOpenAdmission(selectedPatient.id)
      .then(setOpenAdmission)
      .catch((e) => console.error(e))
  }, [selectedPatient])

  useEffect(() => {
    const t = setTimeout(async () => {
      if (!prescSearch.trim() || selectedPresc) return setPrescResults([])
      try { setPrescResults(await prescribersService.search(prescSearch)) }
      catch (e) { console.error(e) }
    }, 200)
    return () => clearTimeout(t)
  }, [prescSearch, selectedPresc])

  // Estoque ativo (CAF ou satélite escolhido no seletor). Se null, assume CAF.
  const { activeStock } = useModule()
  const activeStockId = activeStock?.id ?? '42c3b239-c354-4b5b-a2eb-d42b7a9edc10' // fallback CAF
  // SAT_T é estoque de MATERIAL (warehouse): busca no catálogo de material,
  // sem lote/validade, e a baixa vai pela RPC criar_saida_material.
  const isMaterial = activeStock?.itemType === 'warehouse'

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = itemSearch.trim()
      if (!q) { setItemResults([]); return }
      setSearchingItems(true)
      // Busca meds. current_stock aqui é o AGREGADO (soma de todos locais);
      // pra o valor CORRETO do estoque ativo, sobrescrevemos abaixo com
      // item_stocks(activeStockId).
      const { data, error: err } = isMaterial
        ? await supabase
            .from('warehouse_items')
            .select('id, code, name, unit, current_stock')
            .eq('is_active', true)
            .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
            .order('name')
            .limit(20)
        : await supabase
            .from('pharmacy_items')
            .select('id, code, name, unit, current_stock, is_mav, medication_class')
            .eq('is_active', true)
            .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
            .order('name')
            .limit(20)
      if (err) console.error(err)
      let items = (data || []) as PharmacyItemRow[]

      // Substitui current_stock pelo saldo do local ativo (multi-estoque).
      if (items.length > 0) {
        const ids = items.map((i) => i.id)
        const { data: stocks } = await supabase
          .from('item_stocks')
          .select('item_id, quantity')
          .eq('location_id', activeStockId)
          .eq('item_type', isMaterial ? 'warehouse' : 'pharmacy')
          .in('item_id', ids)
        const stockMap = new Map<string, number>()
        for (const s of stocks || []) stockMap.set(s.item_id, s.quantity)
        items = items.map((i) => ({ ...i, current_stock: stockMap.get(i.id) ?? 0 }))
      }

      setItemResults(items)
      setSearchingItems(false)
    }, 200)
    return () => clearTimeout(t)
  }, [itemSearch, activeStockId])

  async function loadLots(itemId: string): Promise<LotRow[]> {
    if (lotsByItem[itemId]) return lotsByItem[itemId]
    // Só lotes DO LOCAL onde a dispensação está sendo feita (activeStockId).
    // Sem o filtro de local, a Satélite 1 via lotes que estão no CAF — cada
    // estoque só pode dispensar dos SEUS próprios lotes. Mesma regra do
    // atendimento de solicitação (FA4: lote por local).
    const { data, error: err } = await supabase
      .from('expiry_tracking')
      .select('id, batch_number, expiry_date, current_quantity')
      .eq('item_id', itemId)
      .eq('location_id', activeStockId)
      .gt('current_quantity', 0)
      .order('expiry_date', { ascending: true, nullsFirst: false })
    if (err) console.error(err)
    const lots = (data || []) as LotRow[]
    setLotsByItem((p) => ({ ...p, [itemId]: lots }))
    return lots
  }

  // Adiciona o item numa nova linha. O MESMO medicamento pode entrar em várias
  // linhas — uma por LOTE — pra dispensar de mais de um lote (igual ao
  // atendimento de solicitação). Cada linha tem seu lote e sua quantidade.
  async function addItem(item: PharmacyItemRow) {
    setAddingItem(item.id)
    try {
      // NAO pre-seleciona FEFO. O operador tem que escolher explicitamente
      // o lote que esta pegando fisicamente da prateleira — evita saldo sair
      // do lote errado por default silencioso. available_in_batch comeca com
      // o estoque total (0 depois quando ele escolhe o lote).
      // Material TAMBÉM tem lote (o inventário do satélite lançou lote/validade
      // em expiry_tracking). Diferença: no material o FEFO já vem
      // pré-selecionado e o lote NÃO é obrigatório — há material antigo sem
      // lote informado, e o saldo do lote não limita a quantidade (pode estar
      // 0 até o inventário; FA5 permite).
      const lots = await loadLots(item.id)
      const fefo = isMaterial ? lots[0] : undefined
      setSelectedItems((prev) => [
        ...prev,
        {
          item_id: item.id, name: item.name, code: item.code || '', unit: item.unit || 'UN',
          is_mav: item.is_mav, medication_class: item.medication_class,
          expiry_tracking_id: fefo?.id ?? null,
          batch_number: fefo?.batch_number ?? null,
          expiry_date: fefo?.expiry_date ?? null,
          available_in_batch: isMaterial ? Number.MAX_SAFE_INTEGER : item.current_stock,
          item_stock: item.current_stock,
          quantity: 1,
        },
      ])
      setItemSearch(''); setItemResults([])
    } finally {
      setAddingItem(null)
    }
  }

  function changeLot(idx: number, lotId: string) {
    setSelectedItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it
      if (lotId === MANUAL_LOT) {
        // "Outro lote (digitar)": libera os campos de lote/validade. Sem id —
        // a RPC reaproveita ou cria a linha em expiry_tracking.
        return {
          ...it, manual_lot: true, expiry_tracking_id: null, batch_number: '', expiry_date: null,
          available_in_batch: Number.MAX_SAFE_INTEGER,
        }
      }
      if (!lotId) {
        // Material sem lote continua liberado (não trava a quantidade).
        const avail = isMaterial ? Number.MAX_SAFE_INTEGER : it.item_stock
        return { ...it, manual_lot: false, expiry_tracking_id: null, batch_number: null, expiry_date: null, available_in_batch: avail, quantity: Math.min(it.quantity, Math.max(1, avail)) }
      }
      const lot = (lotsByItem[it.item_id] || []).find((l) => l.id === lotId)
      if (!lot) return it
      // No material o saldo do lote não limita a quantidade (FA5).
      const avail = isMaterial ? Number.MAX_SAFE_INTEGER : lot.current_quantity
      return {
        ...it, manual_lot: false, expiry_tracking_id: lot.id, batch_number: lot.batch_number,
        expiry_date: lot.expiry_date, available_in_batch: avail,
        quantity: Math.min(it.quantity, Math.max(1, avail)),
      }
    }))
  }

  function removeItem(idx: number) {
    setSelectedItems((prev) => prev.filter((_, i) => i !== idx))
  }

  // "+ Adicionar lote": cria outra linha do MESMO medicamento (lote vazio),
  // logo abaixo, pra dispensar de mais de um lote — igual ao atendimento de
  // solicitação. Os lotes já estão carregados (lotsByItem) da 1ª linha.
  function addAnotherLot(idx: number) {
    setSelectedItems((prev) => {
      const src = prev[idx]
      const copy = [...prev]
      copy.splice(idx + 1, 0, {
        ...src,
        expiry_tracking_id: null,
        batch_number: null,
        expiry_date: null,
        available_in_batch: src.item_stock,
        quantity: 1,
      })
      return copy
    })
  }

  // Lote/validade digitados (material, opção "Outro lote"). Um não depende do
  // outro: pode vir só o lote, quando a validade não está legível na caixa.
  function setManualBatch(idx: number, batch: string) {
    setSelectedItems((prev) => prev.map((it, i) => i === idx ? { ...it, batch_number: batch } : it))
  }

  function setManualExpiry(idx: number, date: string) {
    setSelectedItems((prev) => prev.map((it, i) => i === idx ? { ...it, expiry_date: date || null } : it))
  }

  function setQty(idx: number, qty: number) {
    setSelectedItems((prev) => prev.map((it, i) =>
      i === idx ? { ...it, quantity: Math.max(1, qty) } : it
    ))
  }

  function fmt(d: string | null | undefined) {
    if (!d) return '—'
    return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
  }

  function expiryColor(d: string | null | undefined): string {
    if (!d) return mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.05)'
    const days = Math.floor((new Date(d + 'T00:00:00').getTime() - Date.now()) / 86400000)
    if (days < 0) return 'rgba(239,68,68,0.15)'
    if (days <= 30) return 'rgba(239,68,68,0.10)'
    if (days <= 90) return 'rgba(245,158,11,0.10)'
    return 'rgba(16,185,129,0.10)'
  }

  async function trySubmit() {
    setError('')
    if (hasMav) { setShowMavConfirm(true); setMavConfirmText(''); return }
    await doSubmit()
  }

  async function doSubmit() {
    setSubmitting(true); setError('')
    try {
      // MATERIAL (SAT_T): baixa própria, sem tabelas de medicamento. O trigger
      // debita o item_stocks(SAT_T, warehouse); a RPC abate o lote quando
      // expiry_tracking_id vier preenchido (item sem lote vai sem o campo).
      if (isMaterial) {
        const { error: matErr } = await supabase.rpc('criar_saida_material', {
          p_source_location_code: activeStock?.code ?? 'SAT_T',
          p_sector: selectedSector,
          p_items: selectedItems.map((i) => {
            // Higieniza antes de enviar. O banco converte estes campos em
            // uuid/date/integer e qualquer lixo vira "Valor invalido para o
            // campo", sem dizer qual — foi o que aconteceu quando o valor
            // interno do seletor ('__manual__') escapou no lugar do lote.
            const lote = i.manual_lot ? null
              : (typeof i.expiry_tracking_id === 'string'
                  && /^[0-9a-f-]{36}$/i.test(i.expiry_tracking_id)
                    ? i.expiry_tracking_id : null)
            // Validade so vai se estiver completa (aaaa-mm-dd); parcial ou em
            // formato brasileiro o banco recusa.
            const val = i.manual_lot && /^\d{4}-\d{2}-\d{2}$/.test(i.expiry_date || '')
              ? i.expiry_date : null
            return {
              item_id: i.item_id,
              quantity: Number(i.quantity),
              expiry_tracking_id: lote,
              // Lote digitado: a RPC reaproveita a linha se o lote já existir
              // nesse item/local, senão cria (podendo ficar negativa — FA5).
              batch_number: i.manual_lot ? (i.batch_number || '').trim() || null : null,
              expiry_date: val,
            }
          }),
          p_notes: null,
        })
        if (matErr) throw matErr
        navigate('/dispensacao', { state: { successMsg: 'Dispensação de material registrada' } })
        return
      }
      const result = await pharmacyDispensationService.create(
        isRequisicao
          ? {
              tipo: 'requisicao',
              sector: selectedSector,
              // Ambos opcionais na requisicao: vao nulos quando em branco.
              rm_date: rmDate || null,
              patient_name: reqPatientName.trim() || null,
              mav_confirmado: hasMav ? true : false,
              items: selectedItems.map((i) => ({
                item_id: i.item_id, quantity: i.quantity,
                expiry_tracking_id: i.expiry_tracking_id,
                batch_number: i.batch_number, expiry_date: i.expiry_date,
              })),
            }
          : {
              tipo: 'prescricao',
              patient_name: selectedPatient!.full_name,
              medical_record_number: selectedPatient!.medical_record_number,
              prescribing_doctor: `${selectedPresc!.name} (CRM ${selectedPresc!.crm}/${selectedPresc!.crm_uf})`,
              prescription_date: prescriptionDate,
              patient_id: selectedPatient!.id,
              admission_id: openAdmission?.id ?? null,
              prescriber_id: selectedPresc!.id,
              mav_confirmado: hasMav ? true : false,
              items: selectedItems.map((i) => ({
                item_id: i.item_id, quantity: i.quantity,
                expiry_tracking_id: i.expiry_tracking_id,
                batch_number: i.batch_number, expiry_date: i.expiry_date,
              })),
            },
        // Estoque de origem: se o usuário está em CAF/satélite explícito, respeita.
        // Caso contrário (nenhum escolhido), CAF é o default no backend.
        { sourceLocationCode: activeStock?.code }
      )
      const msg = result?.needsApproval
        ? 'Aguardando aprovação do farmacêutico'
        : 'Dispensação registrada com sucesso'
      navigate('/dispensacao', { state: { successMsg: msg } })
    } catch (e: unknown) {
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false); setShowMavConfirm(false)
    }
  }

  // Dispensacao: LOTE OBRIGATORIO. O operador precisa escolher qual lote esta
  // saindo pra fechar o rastreio (FEFO nao serve como default silencioso — se
  // deixar sem lote, o saldo agregado sai sem rastreabilidade).
  const canAdvance: boolean[] = isRequisicao
    ? [
        !!selectedSector,
        selectedItems.length > 0 && selectedItems.every((i) => i.quantity > 0 && (isMaterial || (i.quantity <= i.available_in_batch && !!i.expiry_tracking_id))),
        true,
      ]
    : [
        !!selectedPatient,
        !!prescriptionDate && !!selectedPresc,
        selectedItems.length > 0 && selectedItems.every((i) => i.quantity > 0 && (isMaterial || (i.quantity <= i.available_in_batch && !!i.expiry_tracking_id))),
        true,
      ]

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate('/dispensacao')}
          style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            width: 40, height: 40, borderRadius: 10, cursor: 'pointer',
            background: mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.06)',
            border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.08)'}`,
            color: txt,
          }}>
          <ArrowLeft size={18} />
        </button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold flex items-center gap-2 flex-wrap" style={{ color: txt }}>
            Nova Dispensação {isRequisicao ? '· Requisição' : '· Prescrição'}
          </h1>
          <p className="text-sm" style={{ color: txtSec }}>
            {isRequisicao
              ? 'Atendimento direto a um setor (sem paciente individual)'
              : 'Dispensação de medicamentos por prescrição médica'}
            {activeStock && ` · saída de ${activeStock.name}`}
          </p>
        </div>
      </div>

      {/* Barra de progresso */}
      <div className="p-4" style={card}>
        <div className="flex items-center justify-between gap-2">
          {STEPS.map((s, i) => {
            const Icon = s.icon
            const active = i === step
            const done = i < step
            return (
              <div key={i} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="flex items-center justify-center w-9 h-9 rounded-full text-sm font-bold transition-all"
                  style={{
                    background: done
                      ? 'rgba(16,185,129,0.85)'
                      : active
                      ? 'rgba(59,130,246,0.85)'
                      : mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)',
                    color: done || active ? '#fff' : txtMut,
                    border: active ? '2px solid rgba(59,130,246,0.6)' : '2px solid transparent',
                  }}>
                  {done ? <CheckCircle2 size={16} /> : <Icon size={16} />}
                </div>
                <span className="text-xs font-medium hidden sm:block" style={{ color: active ? txt : txtMut }}>
                  {isMaterial && s.label === 'Medicamentos' ? 'Materiais' : s.label}
                </span>
              </div>
            )
          })}
        </div>
        <div className="mt-3 h-1 rounded-full" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)' }}>
          <div
            className="h-1 rounded-full transition-all duration-300"
            style={{ width: `${(step / (STEPS.length - 1)) * 100}%`, background: 'rgba(59,130,246,0.7)' }}
          />
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-100 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Etapa 0 — Setor (Requisição) */}
      {isRequisicao && step === 0 && (
        <div className="p-6 space-y-4" style={card}>
          <h2 className="text-lg font-semibold" style={{ color: txt }}>Etapa 1 — Setor solicitante</h2>
          <p className="text-xs" style={{ color: txtMut }}>
            Selecione o setor que receberá os medicamentos. Em requisição, o paciente é opcional e o prescritor não se aplica.
          </p>

          <div>
            <label style={lbl}>Setor *</label>
            <select
              value={selectedSector}
              onChange={(e) => setSelectedSector(e.target.value)}
              style={inputStyle}
            >
              <option value="">— selecionar —</option>
              {departments.map((d) => (
                <option key={d.id} value={d.name}>{d.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label style={lbl}>Data da RM</label>
            <input
              type="date"
              value={rmDate}
              onChange={(e) => setRmDate(e.target.value)}
              style={inputStyle}
            />
            <p className="text-xs mt-1" style={{ color: txtMut }}>
              Data da Requisição de Material. Opcional.
            </p>
          </div>

          <div>
            <label style={lbl}>Paciente</label>
            <input
              value={reqPatientName}
              onChange={(e) => setReqPatientName(e.target.value)}
              placeholder="Nome do paciente (opcional)"
              style={inputStyle}
            />
            <p className="text-xs mt-1" style={{ color: txtMut }}>
              Opcional — preencha só quando a requisição for para um paciente específico.
            </p>
          </div>

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => setStep(1)}
              disabled={!canAdvance[0]}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              Continuar <ArrowRight size={14} className="ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Etapa 1 — Paciente */}
      {!isRequisicao && step === 0 && (
        <div className="p-6 space-y-4" style={card}>
          <h2 className="text-lg font-semibold" style={{ color: txt }}>Etapa 1 — Paciente</h2>

          {selectedPatient ? (
            <div className="p-4 rounded-xl flex items-center justify-between"
              style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)' }}>
              <div className="flex items-center gap-3">
                <UserCheck size={20} className="text-emerald-500" />
                <div>
                  <p className="font-semibold" style={{ color: txt }}>{selectedPatient.full_name}</p>
                  <p className="text-sm" style={{ color: txtSec }}>
                    Prontuário {selectedPatient.medical_record_number}
                    {' · '}
                    {openAdmission
                      ? `Internado desde ${fmt(openAdmission.admission_date)}`
                      : 'Sem internação aberta'}
                  </p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setSelectedPatient(null); setPatientSearch('') }}>
                Trocar
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label style={lbl}>Buscar por prontuário ou nome *</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
                <input
                  value={patientSearch}
                  onChange={(e) => setPatientSearch(e.target.value)}
                  placeholder="Nome do paciente ou número do prontuário..."
                  style={{ ...inputStyle, paddingLeft: 36 }}
                  autoFocus
                />
                {patientResults.length > 0 && (
                  <div style={dropdownStyle}>
                    {patientResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPatient(p); setPatientSearch(''); setPatientResults([]) }}
                        className="w-full text-left px-4 py-3 block"
                        style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` }}>
                        <p className="text-sm font-medium" style={{ color: txt }}>{p.full_name}</p>
                        <p className="text-xs" style={{ color: txtMut }}>Prontuário {p.medical_record_number} · {fmt(p.birth_date)}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs" style={{ color: txtMut }}>
                Paciente não cadastrado?{' '}
                <a href="/farmacia/pacientes" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
                  Cadastrar agora
                </a>
              </p>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              onClick={() => setStep(1)}
              disabled={!canAdvance[0]}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              Confirmar Paciente <ArrowRight size={14} className="ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Etapa 2 — Prescritor + Data */}
      {!isRequisicao && step === 1 && (
        <div className="p-6 space-y-4" style={card}>
          <h2 className="text-lg font-semibold" style={{ color: txt }}>Etapa 2 — Prescritor e Data</h2>

          <div>
            <label style={lbl}>Data da Prescrição *</label>
            <input
              type="date"
              value={prescriptionDate}
              onChange={(e) => setPrescriptionDate(e.target.value)}
              style={inputStyle}
            />
          </div>

          {selectedPresc ? (
            <div className="p-4 rounded-xl flex items-center justify-between"
              style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.25)' }}>
              <div className="flex items-center gap-3">
                <Stethoscope size={20} className="text-blue-500" />
                <div>
                  <p className="font-semibold" style={{ color: txt }}>{selectedPresc.name}</p>
                  <p className="text-sm" style={{ color: txtSec }}>CRM {selectedPresc.crm}/{selectedPresc.crm_uf}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => { setSelectedPresc(null); setPrescSearch('') }}>
                Trocar
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <label style={lbl}>Buscar por nome ou CRM *</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
                <input
                  value={prescSearch}
                  onChange={(e) => setPrescSearch(e.target.value)}
                  placeholder="Nome do prescritor ou CRM..."
                  style={{ ...inputStyle, paddingLeft: 36 }}
                  autoFocus
                />
                {prescResults.length > 0 && (
                  <div style={dropdownStyle}>
                    {prescResults.map((p) => (
                      <button
                        key={p.id}
                        onClick={() => { setSelectedPresc(p); setPrescSearch(''); setPrescResults([]) }}
                        className="w-full text-left px-4 py-3 block"
                        style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` }}>
                        <p className="text-sm font-medium" style={{ color: txt }}>{p.name}</p>
                        <p className="text-xs" style={{ color: txtMut }}>CRM {p.crm}/{p.crm_uf}</p>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(0)}>
              <ArrowLeft size={14} className="mr-2" /> Voltar
            </Button>
            <Button
              onClick={() => setStep(2)}
              disabled={!canAdvance[1]}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              Continuar <ArrowRight size={14} className="ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Etapa Medicamentos */}
      {step === STEP_MEDS && (
        <div className="p-6 space-y-4" style={card}>
          <h2 className="text-lg font-semibold" style={{ color: txt }}>
            Etapa {STEP_MEDS + 1} — {isMaterial ? 'Materiais' : 'Medicamentos'}
          </h2>
          <p className="text-xs" style={{ color: txtMut }}>
            {isMaterial
              ? 'Busque e clique para adicionar o material. O lote que vence primeiro (FEFO) é escolhido automaticamente — você pode trocar abaixo ou deixar sem lote.'
              : 'Busque e clique para adicionar. O lote que vence primeiro (FEFO) é escolhido automaticamente — você pode trocar abaixo.'}
          </p>

          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: txtMut }} />
            <input
              value={itemSearch}
              onChange={(e) => setItemSearch(e.target.value)}
              placeholder={isMaterial ? 'Buscar material por nome ou código...' : 'Buscar medicamento por nome ou código...'}
              style={{ ...inputStyle, paddingLeft: 36 }}
            />
            {itemSearch.trim() && (
              <div style={dropdownStyle}>
                {searchingItems ? (
                  <div className="flex items-center gap-2 text-sm px-4 py-3" style={{ color: txtMut }}>
                    <Loader2 size={14} className="animate-spin" /> Buscando...
                  </div>
                ) : itemResults.length === 0 ? (
                  <div className="px-4 py-3 text-sm" style={{ color: txtMut }}>Nenhum medicamento encontrado.</div>
                ) : itemResults.map((i) => {
                  // Item já na lista não é mais bloqueado: clicar de novo cria
                  // outra linha, pra dispensar de um segundo lote.
                  const qtdLinhas = selectedItems.filter((s) => s.item_id === i.id).length
                  const out = i.current_stock <= 0
                  return (
                    <button
                      key={i.id}
                      onClick={() => addItem(i)}
                      disabled={addingItem === i.id}
                      className="w-full text-left px-4 py-3 block disabled:opacity-50"
                      style={{ borderBottom: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.04)'}` }}>
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium flex items-center gap-1" style={{ color: txt }}>
                          <Pill size={13} /> {i.name}
                          {i.is_mav && (
                            <span className="ml-1 text-xs px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-200">⚠️ MAV</span>
                          )}
                          {qtdLinhas > 0 && (
                            <span className="ml-1 text-xs text-blue-500">
                              ({qtdLinhas} {qtdLinhas === 1 ? 'lote' : 'lotes'} — clique p/ outro)
                            </span>
                          )}
                        </p>
                        <span className="text-xs ml-2 flex items-center gap-1" style={{ color: out ? '#dc2626' : txtMut }}>
                          {addingItem === i.id && <Loader2 size={12} className="animate-spin" />}
                          {i.current_stock} {i.unit || 'UN'}
                        </span>
                      </div>
                      <p className="text-xs" style={{ color: txtMut }}>{i.code || 'sem código'}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {selectedItems.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: txtMut }}>
              {isMaterial ? 'Nenhum material adicionado. Use a busca acima.' : 'Nenhum medicamento adicionado. Use a busca acima.'}
            </p>
          ) : (
            <div className="space-y-2">
              {selectedItems.map((it, idx) => {
                const lots = lotsByItem[it.item_id] || []
                const over = it.quantity > it.available_in_batch
                return (
                  <div
                    key={idx}
                    className="p-3 rounded-xl space-y-2"
                    style={{
                      background: it.is_mav ? 'rgba(245,158,11,0.08)' : mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                      border: `1px solid ${it.is_mav ? 'rgba(245,158,11,0.3)' : mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}`,
                    }}>
                    {/* Nome + Qtd + Lote (obrigatorio) em uma unica linha —
                        mesmo padrao das outras telas (atendimento,
                        devolucao). Lote NAO pre-selecionado: operador
                        escolhe conscientemente pra bater com o fisico. */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <div className="flex-1 min-w-[180px]">
                        <p className="text-sm font-medium flex items-center gap-1 flex-wrap" style={{ color: txt }}>
                          <Pill size={13} /> {it.name}
                          {it.is_mav && (
                            <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 border border-amber-300">⚠️ MAV</span>
                          )}
                        </p>
                        <p className="text-xs" style={{ color: txtMut }}>{it.code || 'sem código'}</p>
                      </div>
                      <input
                        type="number"
                        min={1}
                        max={it.available_in_batch}
                        value={it.quantity}
                        onChange={(e) => setQty(idx, parseInt(e.target.value) || 1)}
                        onWheel={(e) => e.currentTarget.blur()}
                        style={{ ...inputStyle, width: 80, borderColor: over ? '#dc2626' : (inputStyle.border as string) }}
                      />
                      <span className="text-xs" style={{ color: txtMut }}>{it.unit}</span>
                      {/* Lote: obrigatório no medicamento; no material vem com o
                          FEFO pré-selecionado e pode ficar vazio (item sem
                          lote registrado ainda pode ser dispensado). */}
                      <select
                        value={it.manual_lot ? MANUAL_LOT : (it.expiry_tracking_id ?? '')}
                        onChange={(e) => changeLot(idx, e.target.value)}
                        title={isMaterial ? 'Lote (opcional) — escolha o mesmo do físico' : 'Lote (obrigatório) — escolha o mesmo do físico'}
                        style={{
                          ...inputStyle,
                          width: 'auto',
                          minWidth: 240,
                          padding: '6px 10px',
                          background: it.expiry_tracking_id ? expiryColor(it.expiry_date) : undefined,
                          borderColor: isMaterial || it.expiry_tracking_id ? undefined : '#ef4444',
                        }}>
                        <option value="">
                          {lots.length === 0 ? 'Sem lote registrado' : isMaterial ? '— Sem lote —' : '— Selecione o lote * —'}
                        </option>
                        {lots.map((l) => (
                          <option key={l.id} value={l.id}>
                            Lote {l.batch_number} · Val {fmt(l.expiry_date)} · {l.current_quantity} un
                          </option>
                        ))}
                        {/* Material que veio do almoxarifado sem lote no
                            sistema: a operadora digita o que está na caixa. */}
                        {isMaterial && <option value={MANUAL_LOT}>+ Outro lote (digitar)</option>}
                      </select>
                      <Button
                        variant="outline" size="sm"
                        onClick={() => removeItem(idx)}
                        className="text-red-600 border-red-200 hover:bg-red-50 h-8 px-2">
                        <Trash2 size={14} />
                      </Button>
                      {!isMaterial && (
                        <span className="text-xs" style={{ color: over ? '#dc2626' : txtMut }}>
                          Disponível: {it.available_in_batch}
                        </span>
                      )}
                    </div>
                    {/* Campos do lote digitado. Só aparecem no material e só
                        quando "Outro lote (digitar)" está escolhido. */}
                    {isMaterial && it.manual_lot && (
                      <div className="flex items-center gap-3 flex-wrap">
                        <input
                          type="text"
                          value={it.batch_number ?? ''}
                          onChange={(e) => setManualBatch(idx, e.target.value)}
                          placeholder="Lote impresso na caixa"
                          style={{ ...inputStyle, width: 'auto', minWidth: 220, padding: '6px 10px' }}
                        />
                        <input
                          type="date"
                          value={it.expiry_date ?? ''}
                          onChange={(e) => setManualExpiry(idx, e.target.value)}
                          title="Validade (opcional)"
                          style={{ ...inputStyle, width: 'auto', padding: '6px 10px' }}
                        />
                        <span className="text-xs" style={{ color: txtMut }}>
                          Validade opcional — deixe em branco se não souber.
                        </span>
                      </div>
                    )}
                    {/* Multi-lote: dispensar o mesmo medicamento de mais de um
                        lote — cria outra linha logo abaixo, cada uma com seu
                        lote e sua quantidade (igual ao atendimento). */}
                    {!isMaterial && (
                    <button
                      type="button"
                      onClick={() => addAnotherLot(idx)}
                      className="text-xs text-blue-500 hover:text-blue-700"
                    >+ Adicionar lote deste medicamento</button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {hasMav && (
            <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 flex items-start gap-2 text-sm">
              <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-amber-800">
                <strong>Atenção:</strong> contém Medicamento(s) de Alta Vigilância. Será solicitada confirmação <strong>"CONFIRMO"</strong> antes de salvar.
              </p>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <Button variant="outline" onClick={() => setStep(STEP_MEDS - 1)}>
              <ArrowLeft size={14} className="mr-2" /> Voltar
            </Button>
            <Button
              onClick={() => setStep(STEP_RESUMO)}
              disabled={!canAdvance[STEP_MEDS]}
              className="bg-blue-600 hover:bg-blue-700 text-white">
              Revisar Resumo <ArrowRight size={14} className="ml-2" />
            </Button>
          </div>
        </div>
      )}

      {/* Etapa Resumo */}
      {step === STEP_RESUMO && (
        <div className="p-6 space-y-5" style={card}>
          <h2 className="text-lg font-semibold" style={{ color: txt }}>
            Etapa {STEP_RESUMO + 1} — Resumo
          </h2>

          {isRequisicao ? (
            <div className="p-4 rounded-xl space-y-1"
              style={{ background: 'rgba(99,102,241,0.07)', border: '1px solid rgba(99,102,241,0.2)' }}>
              <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtMut }}>Setor solicitante</p>
              <p className="font-semibold flex items-center gap-2" style={{ color: txt }}>
                <Building2 size={16} className="text-indigo-500" /> {selectedSector}
              </p>
              <p className="text-xs" style={{ color: txtSec }}>Tipo: Requisição (sem paciente individual)</p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="p-4 rounded-xl space-y-1"
                  style={{ background: 'rgba(16,185,129,0.07)', border: '1px solid rgba(16,185,129,0.2)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtMut }}>Paciente</p>
                  <p className="font-semibold" style={{ color: txt }}>{selectedPatient?.full_name}</p>
                  <p className="text-sm" style={{ color: txtSec }}>
                    Prontuário {selectedPatient?.medical_record_number}
                    {openAdmission ? ` · Internado desde ${fmt(openAdmission.admission_date)}` : ''}
                  </p>
                </div>

                <div className="p-4 rounded-xl space-y-1"
                  style={{ background: 'rgba(59,130,246,0.07)', border: '1px solid rgba(59,130,246,0.2)' }}>
                  <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtMut }}>Prescritor</p>
                  <p className="font-semibold" style={{ color: txt }}>{selectedPresc?.name}</p>
                  <p className="text-sm" style={{ color: txtSec }}>CRM {selectedPresc?.crm}/{selectedPresc?.crm_uf}</p>
                </div>
              </div>

              <div className="p-4 rounded-xl"
                style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)', border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
                <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtMut }}>Data da Prescrição</p>
                <p className="font-semibold" style={{ color: txt }}>{fmt(prescriptionDate)}</p>
              </div>
            </>
          )}

          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: txtMut }}>
              Medicamentos ({selectedItems.length})
            </p>
            {selectedItems.map((it, idx) => (
              <div
                key={idx}
                className="p-3 rounded-xl flex items-center justify-between gap-2"
                style={{
                  background: it.is_mav ? 'rgba(245,158,11,0.08)' : mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
                  border: `1px solid ${it.is_mav ? 'rgba(245,158,11,0.25)' : mode === 'dark' ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)'}`,
                }}>
                <div>
                  <p className="text-sm font-medium flex items-center gap-1" style={{ color: txt }}>
                    <Pill size={13} /> {it.name}
                    {it.is_mav && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-amber-200 text-amber-800 border border-amber-300">⚠️ MAV</span>
                    )}
                  </p>
                  <p className="text-xs" style={{ color: txtMut }}>
                    {it.batch_number ? `Lote ${it.batch_number} · Val ${fmt(it.expiry_date)}` : 'Sem lote específico'}
                  </p>
                </div>
                <span className="text-sm font-bold" style={{ color: txt }}>
                  {it.quantity} {it.unit}
                </span>
              </div>
            ))}
          </div>

          {needsApproval && (
            <div className="p-4 rounded-xl flex items-start gap-3 bg-amber-50 border border-amber-200">
              <AlertTriangle className="text-amber-600 flex-shrink-0 mt-0.5" size={20} />
              <p className="text-sm text-amber-800">
                <strong>Esta dispensação requer aprovação farmacêutica.</strong> Ela ficará com status
                "Aguardando aprovação" até que um farmacêutico autorize.
              </p>
            </div>
          )}

          <div className="flex justify-between pt-2">
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setStep(STEP_MEDS)}>
                <ArrowLeft size={14} className="mr-2" /> Voltar
              </Button>
              <Button variant="outline" onClick={() => setStep(0)}>
                Editar do início
              </Button>
            </div>
            <Button
              onClick={trySubmit}
              disabled={submitting}
              className="bg-emerald-600 hover:bg-emerald-700 text-white">
              {submitting
                ? <Loader2 size={14} className="mr-2 animate-spin" />
                : <CheckCircle2 size={14} className="mr-2" />}
              Confirmar Dispensação
            </Button>
          </div>
        </div>
      )}

      {/* Modal MAV */}
      {showMavConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-md p-6 space-y-4" style={card}>
            <div className="flex items-center gap-2 text-amber-600">
              <AlertTriangle size={20} />
              <h3 className="text-lg font-bold" style={{ color: txt }}>ATENÇÃO — Medicamento de Alta Vigilância</h3>
            </div>
            <p className="text-sm" style={{ color: txt }}>
              Esta dispensação contém <strong>{selectedItems.filter((i) => i.is_mav).length} MAV(s)</strong>:
            </p>
            <ul className="space-y-1 text-sm">
              {selectedItems.filter((i) => i.is_mav).map((i, idx) => (
                <li key={idx} className="p-2 rounded-lg bg-amber-50 border border-amber-200" style={{ color: txt }}>
                  <strong>{i.name}</strong> — {i.quantity} {i.unit}
                  {i.batch_number && (
                    <span style={{ color: txtSec }}> · Lote {i.batch_number}, Val {fmt(i.expiry_date)}</span>
                  )}
                </li>
              ))}
            </ul>
            <div className="text-xs space-y-0.5" style={{ color: txtSec }}>
              {isRequisicao ? (
                <p>✓ Setor solicitante: {selectedSector}</p>
              ) : (
                <>
                  <p>✓ Paciente: {selectedPatient?.full_name} ({selectedPatient?.medical_record_number})</p>
                  <p>✓ Prescritor: {selectedPresc?.name} (CRM {selectedPresc?.crm})</p>
                  <p>✓ Data da prescrição: {fmt(prescriptionDate)}</p>
                </>
              )}
            </div>
            <div>
              <label style={lbl}>Para confirmar, digite "CONFIRMO" *</label>
              <input
                value={mavConfirmText}
                onChange={(e) => setMavConfirmText(e.target.value)}
                style={inputStyle}
                placeholder="CONFIRMO"
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setShowMavConfirm(false)}>Cancelar</Button>
              <Button
                onClick={doSubmit}
                disabled={mavConfirmText.trim().toUpperCase() !== 'CONFIRMO' || submitting}
                className="bg-amber-600 hover:bg-amber-700 text-white">
                {submitting ? <Loader2 size={14} className="mr-2 animate-spin" /> : <AlertTriangle size={14} className="mr-2" />}
                Confirmar MAV
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
