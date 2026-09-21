import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Boxes, Package, Search, Plus, Trash2, Loader2, AlertCircle, CheckCircle2, UserPlus, Users,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth'
import { kitsService, type Kit } from '@/lib/services/kits'
import { patientsService } from '@/lib/services/farmacia-cadastros'
import { getErrorMessage } from '@/lib/utils/error-messages'

// PEDIDO DE ENFERMAGEM — kits e material avulso, sempre com paciente.
// Atendido pela Farmacia Satelite Terreo. Spec:
// docs/superpowers/specs/2026-09-20-kits-enfermagem-design.md
//
// O enfermeiro pede em KITS ("5 x Kit Banho", dizendo pra quem). A satelite
// recebe os ITENS SOMADOS. A soma e feita no banco pela RPC; a previa embaixo
// existe pro enfermeiro ver o que vai chegar la.

interface Paciente { id: string; full_name: string; medical_record_number: string }
interface ItemBusca { id: string; name: string; code: string | null; unit: string | null }

interface KitEscolhido {
  _key: string
  kit_id: string
  kit_name: string
  pacientes: Array<{ patient_id: string; patient_name: string; quantity: number }>
}

interface AvulsoEscolhido {
  _key: string
  item_id: string
  item_name: string
  unit: string | null
  patient_id: string
  patient_name: string
  quantity: number
}

export function NovoPedidoEnfermagem() {
  const navigate = useNavigate()
  const { user } = useAuth()

  const [podePedir, setPodePedir] = useState<boolean | null>(null)
  const [kitsDisponiveis, setKitsDisponiveis] = useState<Kit[]>([])
  const [composicoes, setComposicoes] = useState<Record<string, Array<{ item_id: string; name: string; quantity: number }>>>({})

  const [kitsEscolhidos, setKitsEscolhidos] = useState<KitEscolhido[]>([])
  const [avulsos, setAvulsos] = useState<AvulsoEscolhido[]>([])
  const [justification, setJustification] = useState('')

  const [buscaPaciente, setBuscaPaciente] = useState('')
  const [pacientes, setPacientes] = useState<Paciente[]>([])
  const [alvo, setAlvo] = useState<{ tipo: 'kit' | 'avulso'; key: string } | null>(null)

  const [novoPacienteNome, setNovoPacienteNome] = useState('')
  const [novoPacienteProntuario, setNovoPacienteProntuario] = useState('')
  const [criandoPaciente, setCriandoPaciente] = useState(false)

  const [buscaItem, setBuscaItem] = useState('')
  const [itensBusca, setItensBusca] = useState<ItemBusca[]>([])

  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    if (!user?.department_id) { setPodePedir(false); return }
    kitsService.isSetorDaSatelite(user.department_id).then(setPodePedir)
  }, [user?.department_id])

  useEffect(() => {
    kitsService.list().then(setKitsDisponiveis).catch((e) => console.error(e))
  }, [])

  // Busca de paciente (nome ou prontuario), so quando ha um destino escolhido.
  useEffect(() => {
    const t = setTimeout(async () => {
      const q = buscaPaciente.trim()
      if (q.length < 2) { setPacientes([]); return }
      const { data } = await supabase
        .from('patients')
        .select('id, full_name, medical_record_number')
        .eq('is_active', true)
        .or(`full_name.ilike.%${q}%,medical_record_number.ilike.%${q}%`)
        .order('full_name')
        .limit(10)
      setPacientes((data || []) as Paciente[])
    }, 250)
    return () => clearTimeout(t)
  }, [buscaPaciente])

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = buscaItem.trim()
      if (!q) { setItensBusca([]); return }
      const { data } = await supabase
        .from('warehouse_items')
        .select('id, name, code, unit')
        .eq('is_active', true)
        .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
        .order('name')
        .limit(20)
      setItensBusca((data || []) as ItemBusca[])
    }, 200)
    return () => clearTimeout(t)
  }, [buscaItem])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 2500)
    return () => clearTimeout(t)
  }, [toast])

  const newKey = () => Math.random().toString(36).slice(2)

  async function addKit(kitId: string) {
    const kit = kitsDisponiveis.find((k) => k.id === kitId)
    if (!kit) return
    if (!composicoes[kitId]) {
      const itens = await kitsService.listItems(kitId)
      setComposicoes((prev) => ({
        ...prev,
        [kitId]: itens.map((i) => ({ item_id: i.warehouse_item_id!, name: i.item_name || 'Item', quantity: i.quantity })),
      }))
    }
    setKitsEscolhidos((prev) => [...prev, { _key: newKey(), kit_id: kit.id, kit_name: kit.name, pacientes: [] }])
  }

  function escolherPaciente(p: Paciente) {
    if (!alvo) return
    if (alvo.tipo === 'kit') {
      setKitsEscolhidos((prev) => prev.map((k) => {
        if (k._key !== alvo.key) return k
        if (k.pacientes.some((x) => x.patient_id === p.id)) return k
        return { ...k, pacientes: [...k.pacientes, { patient_id: p.id, patient_name: p.full_name, quantity: 1 }] }
      }))
    } else {
      setAvulsos((prev) => prev.map((a) => a._key === alvo.key
        ? { ...a, patient_id: p.id, patient_name: p.full_name } : a))
    }
    setAlvo(null); setBuscaPaciente(''); setPacientes([])
  }

  async function criarPaciente() {
    setError(null)
    if (!novoPacienteNome.trim() || !novoPacienteProntuario.trim()) {
      setError('Nome e prontuário são obrigatórios para cadastrar o paciente.')
      return
    }
    setCriandoPaciente(true)
    try {
      const p = await patientsService.create({
        full_name: novoPacienteNome.trim(),
        medical_record_number: novoPacienteProntuario.trim(),
        already_admitted: true,
      })
      escolherPaciente({ id: p.id, full_name: p.full_name, medical_record_number: p.medical_record_number })
      setNovoPacienteNome(''); setNovoPacienteProntuario('')
      setToast('Paciente cadastrado.')
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setCriandoPaciente(false)
    }
  }

  function addAvulso(item: ItemBusca) {
    setAvulsos((prev) => [...prev, {
      _key: newKey(), item_id: item.id, item_name: item.name, unit: item.unit,
      patient_id: '', patient_name: '', quantity: 1,
    }])
    setBuscaItem(''); setItensBusca([])
  }

  // Previa do que a Satelite Terreo vai receber: kits explodidos + avulsos.
  const resumo = useMemo(() => {
    const mapa = new Map<string, { name: string; quantity: number }>()
    for (const k of kitsEscolhidos) {
      const total = k.pacientes.reduce((s, p) => s + (p.quantity || 0), 0)
      for (const c of composicoes[k.kit_id] || []) {
        const atual = mapa.get(c.item_id)
        const qtd = c.quantity * total
        mapa.set(c.item_id, { name: c.name, quantity: (atual?.quantity || 0) + qtd })
      }
    }
    for (const a of avulsos) {
      const atual = mapa.get(a.item_id)
      mapa.set(a.item_id, { name: a.item_name, quantity: (atual?.quantity || 0) + (a.quantity || 0) })
    }
    return [...mapa.values()].sort((x, y) => x.name.localeCompare(y.name, 'pt-BR'))
  }, [kitsEscolhidos, avulsos, composicoes])

  const totalKits = kitsEscolhidos.reduce((s, k) => s + k.pacientes.reduce((t, p) => t + (p.quantity || 0), 0), 0)

  const canSubmit =
    podePedir === true &&
    (kitsEscolhidos.length > 0 || avulsos.length > 0) &&
    kitsEscolhidos.every((k) => k.pacientes.length > 0 && k.pacientes.every((p) => p.quantity > 0)) &&
    avulsos.every((a) => a.patient_id && a.quantity > 0)

  async function handleSubmit() {
    setError(null)
    if (!canSubmit) {
      setError(kitsEscolhidos.some((k) => k.pacientes.length === 0)
        ? 'Informe ao menos um paciente em cada kit.'
        : avulsos.some((a) => !a.patient_id)
          ? 'Informe o paciente de cada item avulso.'
          : 'Adicione ao menos um kit ou item avulso.')
      return
    }
    setSubmitting(true)
    try {
      const r = await kitsService.criarPedido({
        department_id: user!.department_id!,
        kits: kitsEscolhidos.map((k) => ({
          kit_id: k.kit_id,
          kit_name: k.kit_name,
          pacientes: k.pacientes,
        })),
        avulsos: avulsos.map((a) => ({
          item_id: a.item_id, item_name: a.item_name, unit: a.unit,
          patient_id: a.patient_id, patient_name: a.patient_name, quantity: a.quantity,
        })),
        justification,
      })
      setToast(`Pedido ${r.request_number} enviado para a Satélite Térreo.`)
      setTimeout(() => navigate('/requests'), 1400)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (podePedir === false) {
    return (
      <div className="max-w-2xl mx-auto mt-10 bg-white border border-gray-100 rounded-xl p-8 text-center">
        <AlertCircle className="w-8 h-8 text-amber-500 mx-auto mb-3" />
        <h1 className="text-lg font-semibold text-gray-900">Pedido de enfermagem indisponível</h1>
        <p className="text-sm text-gray-500 mt-2">
          Esta tela é dos setores atendidos pela Farmácia Satélite Térreo. Se o seu setor deveria estar
          aqui, peça ao gestor para apontar o setor para a Satélite Térreo.
        </p>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(-1)} className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Boxes className="w-6 h-6 text-emerald-600" /> Pedido de Enfermagem
          </h1>
          <p className="text-sm text-gray-500">
            Kits e material avulso, sempre com o paciente. Atendido pela Satélite Térreo.
          </p>
        </div>
      </div>

      {/* Kits */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <span className="flex items-center gap-2"><Boxes className="w-4 h-4" /> Kits</span>
          {totalKits > 0 && <span className="text-xs font-normal text-gray-500">{totalKits} kit(s)</span>}
        </div>

        <div className="flex gap-2 flex-wrap">
          {kitsDisponiveis.length === 0 ? (
            <p className="text-sm text-gray-400">Nenhum kit cadastrado ainda.</p>
          ) : kitsDisponiveis.map((k) => (
            <Button key={k.id} variant="outline" size="sm" className="gap-1" onClick={() => addKit(k.id)}>
              <Plus className="w-3.5 h-3.5" /> {k.name}
            </Button>
          ))}
        </div>

        {kitsEscolhidos.map((k, idx) => (
          <div key={k._key} className="border border-gray-200 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="font-medium text-gray-900">{k.kit_name}</span>
              <button onClick={() => setKitsEscolhidos((prev) => prev.filter((_, i) => i !== idx))}
                className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
            </div>

            {k.pacientes.map((p, pi) => (
              <div key={p.patient_id} className="flex items-center gap-2">
                <span className="flex-1 text-sm">{p.patient_name}</span>
                <Input type="number" min={1} value={p.quantity} className="h-8 w-24"
                  onChange={(e) => setKitsEscolhidos((prev) => prev.map((x, i) => i === idx
                    ? { ...x, pacientes: x.pacientes.map((y, j) => j === pi ? { ...y, quantity: Number(e.target.value) } : y) }
                    : x))} />
                <button onClick={() => setKitsEscolhidos((prev) => prev.map((x, i) => i === idx
                  ? { ...x, pacientes: x.pacientes.filter((_, j) => j !== pi) } : x))}
                  className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}

            <Button variant="ghost" size="sm" className="gap-1"
              onClick={() => { setAlvo({ tipo: 'kit', key: k._key }); setBuscaPaciente('') }}>
              <Users className="w-3.5 h-3.5" /> Adicionar paciente
            </Button>
          </div>
        ))}
      </div>

      {/* Avulsos */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <Package className="w-4 h-4" /> Material avulso
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={buscaItem} onChange={(e) => setBuscaItem(e.target.value)} placeholder="Buscar material por nome ou código..." className="pl-9" />
        </div>
        {itensBusca.length > 0 && (
          <div className="border border-gray-200 rounded-md max-h-40 overflow-auto">
            {itensBusca.map((i) => (
              <button key={i.id} type="button" onClick={() => addAvulso(i)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">{i.name}</button>
            ))}
          </div>
        )}

        {avulsos.map((a, idx) => (
          <div key={a._key} className="border border-gray-200 rounded-lg p-3 flex items-center gap-2 flex-wrap">
            <span className="flex-1 min-w-[12rem] text-sm">{a.item_name}</span>
            <Button variant="outline" size="sm"
              onClick={() => { setAlvo({ tipo: 'avulso', key: a._key }); setBuscaPaciente('') }}>
              {a.patient_name || 'Escolher paciente'}
            </Button>
            <Input type="number" min={1} value={a.quantity} className="h-8 w-24"
              onChange={(e) => setAvulsos((prev) => prev.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))} />
            <button onClick={() => setAvulsos((prev) => prev.filter((_, i) => i !== idx))}
              className="text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
          </div>
        ))}
      </div>

      {/* Busca de paciente — aparece quando ha um kit ou avulso esperando paciente */}
      {alvo && (
        <div className="bg-white border-2 border-emerald-200 rounded-xl shadow-sm p-6 space-y-3">
          <div className="flex items-center justify-between text-sm font-semibold text-gray-700">
            <span className="flex items-center gap-2"><Users className="w-4 h-4" /> Escolher paciente</span>
            <button onClick={() => { setAlvo(null); setBuscaPaciente('') }} className="text-xs text-gray-500 hover:underline">cancelar</button>
          </div>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input autoFocus value={buscaPaciente} onChange={(e) => setBuscaPaciente(e.target.value)}
              placeholder="Buscar por nome ou prontuário..." className="pl-9" />
          </div>
          {pacientes.length > 0 && (
            <div className="border border-gray-200 rounded-md max-h-48 overflow-auto">
              {pacientes.map((p) => (
                <button key={p.id} type="button" onClick={() => escolherPaciente(p)}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                  {p.full_name} <span className="text-xs text-gray-400">· Pront. {p.medical_record_number}</span>
                </button>
              ))}
            </div>
          )}
          {buscaPaciente.trim().length >= 2 && pacientes.length === 0 && (
            <div className="border-t pt-3 space-y-2">
              <p className="text-xs text-gray-500">Paciente não encontrado. Cadastre abaixo:</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="np-nome">Nome</Label>
                  <Input id="np-nome" value={novoPacienteNome} onChange={(e) => setNovoPacienteNome(e.target.value)} className="mt-1" />
                </div>
                <div>
                  <Label htmlFor="np-pront">Prontuário</Label>
                  <Input id="np-pront" value={novoPacienteProntuario} onChange={(e) => setNovoPacienteProntuario(e.target.value)} className="mt-1" />
                </div>
              </div>
              <Button size="sm" className="gap-1" onClick={criarPaciente} disabled={criandoPaciente}>
                {criandoPaciente ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                Cadastrar e usar
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Resumo */}
      {resumo.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-3">
          <div className="text-sm font-semibold text-gray-700 border-b pb-2">
            O que a Satélite Térreo vai receber
          </div>
          <table className="w-full text-sm">
            <tbody>
              {resumo.map((r) => (
                <tr key={r.name} className="border-b border-gray-50 last:border-0">
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5 text-right font-medium w-24">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div>
            <Label htmlFor="just">Observação (opcional)</Label>
            <Input id="just" value={justification} onChange={(e) => setJustification(e.target.value)}
              placeholder="Algo que a satélite precise saber" className="mt-1" />
          </div>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 text-sm text-red-600">
          <AlertCircle className="w-4 h-4 mt-0.5" /> {error}
        </div>
      )}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
        <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="gap-2">
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Enviar pedido
        </Button>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-900 text-white text-sm px-4 py-2 rounded-lg shadow-lg flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" /> {toast}
        </div>
      )}
    </div>
  )
}
