import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, PackageMinus, Building2, Search, Plus, Trash2, Loader2, CheckCircle2, AlertCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { suppliersService } from '@/lib/services/farmacia-cadastros'
import { departmentsService } from '@/lib/services/departments'
import { externalUnitsService } from '@/lib/services/external-units'
import { PHARMACY_STOCKS } from '@/lib/constants/stock-locations'
interface SaidaBatchProps {
  type: 'pharmacy' | 'warehouse'
}

interface ItemRow {
  id: string
  code: string | null
  name: string
  unit: string
}
interface LotRow {
  id: string
  batch_number: string
  expiry_date: string | null
  current_quantity: number
}
interface LineItem {
  item_id: string
  name: string
  code: string
  unit: string
  quantity: number
  expiry_tracking_id: string | null
}

// Motivos de saída avulsa (quebras, vencimentos, transferência interna,
// devolução ao fornecedor, defeitos). Doação / Permuta / Empréstimo /
// Consignado / Troca de validade são fluxos separados em NOVA MOVIMENTAÇÃO
// (formulário próprio + pendência de aprovação).
const REASONS = [
  { value: 'quebra', label: 'Quebra / Avaria' },
  { value: 'vencimento', label: 'Vencimento' },
  { value: 'transferencia', label: 'Transferência (para um destino)' },
  { value: 'devolucao_fornecedor', label: 'Devolução ao fornecedor' },
  { value: 'defeito_fabricacao', label: 'Defeito de fabricação' },
  { value: 'embalagem_violada', label: 'Embalagem violada' },
  { value: 'outro', label: 'Outro' },
] as const

// Motivos que exigem informar um destino (quem recebe).
const REQUIRES_DESTINO = new Set(['transferencia', 'devolucao_fornecedor'])

interface DestinoOption { tipo: 'fornecedor' | 'unidade_externa' | 'setor_interno'; nome: string }

function fmt(d: string | null) {
  if (!d) return '—'
  return new Date(d + 'T00:00:00').toLocaleDateString('pt-BR')
}

export function SaidaBatch({ type }: SaidaBatchProps) {
  const navigate = useNavigate()
  const table = type === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
  const backTo = type === 'pharmacy' ? '/inventory/pharmacy' : '/inventory/warehouse'
  // ?loc=<CAF|SAT_1|SAT_2|SAT_T|ALMOX> — a saida eh debitada DESSE estoque.
  // Sem query param, fallback pro central.
  const [searchParams] = useSearchParams()
  const locationCode = searchParams.get('loc') || (type === 'pharmacy' ? 'CAF' : 'ALMOX')
  const LOC_LABELS: Record<string, string> = {
    CAF: 'CAF',
    SAT_1: 'Satélite 1º Andar',
    SAT_2: 'Satélite 2º Andar',
    SAT_T: 'Satélite Térreo',
    ALMOX: 'Almoxarifado',
  }
  const locationLabel = LOC_LABELS[locationCode] ?? locationCode
  // ID do local ativo — resolvido do catálogo fixo (síncrono, sem race). Os
  // lotes têm que ser SÓ deste estoque: sem isso, a saída de um satélite lista
  // lotes do CAF e das outras farmácias (estoques não isolados).
  const locationId = PHARMACY_STOCKS.find((s) => s.code === locationCode)?.id ?? null

  const [reason, setReason] = useState<string>('quebra')
  const [reasonDetail, setReasonDetail] = useState('')
  const [destino, setDestino] = useState('') // "tipo|nome"
  const [destinos, setDestinos] = useState<{ fornecedores: DestinoOption[]; externas: DestinoOption[]; setores: DestinoOption[] }>({
    fornecedores: [], externas: [], setores: [],
  })
  const [lines, setLines] = useState<LineItem[]>([])
  const [lotsByItem, setLotsByItem] = useState<Record<string, LotRow[]>>({})

  // Carrega as opções de destino (fornecedores, unidades externas, setores)
  useEffect(() => {
    ;(async () => {
      try {
        const [sup, ext, deps] = await Promise.all([
          suppliersService.list().catch(() => []),
          externalUnitsService.list().catch(() => []),
          departmentsService.getAll().catch(() => []),
        ])
        setDestinos({
          fornecedores: sup.map((s) => ({ tipo: 'fornecedor' as const, nome: s.name })),
          externas: ext.map((e) => ({ tipo: 'unidade_externa' as const, nome: e.name })),
          setores: deps.map((d) => ({ tipo: 'setor_interno' as const, nome: d.name })),
        })
      } catch (e) { console.error(e) }
    })()
  }, [])

  const needsDestino = REQUIRES_DESTINO.has(reason)

  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ItemRow[]>([])
  const [searching, setSearching] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = search.trim()
      if (!q) { setResults([]); return }
      setSearching(true)
      const { data, error: err } = await supabase
        .from(table)
        .select('id, code, name, unit')
        .eq('is_active', true)
        .or(`name.ilike.%${q}%,code.ilike.%${q}%`)
        .order('name')
        .limit(20)
      if (err) console.error(err)
      setResults((data || []) as ItemRow[])
      setSearching(false)
    }, 200)
    return () => clearTimeout(t)
  }, [search, table])

  async function loadLots(itemId: string): Promise<LotRow[]> {
    if (lotsByItem[itemId]) return lotsByItem[itemId]
    let query = supabase
      .from('expiry_tracking')
      .select('id, batch_number, expiry_date, current_quantity')
      .eq('item_id', itemId)
      .gt('current_quantity', 0)
    // Isola por estoque: só os lotes DESTE local (CAF/Satélite ativo).
    if (locationId) query = query.eq('location_id', locationId)
    const { data } = await query.order('expiry_date', { ascending: true, nullsFirst: false })
    const lots = (data || []) as LotRow[]
    setLotsByItem((p) => ({ ...p, [itemId]: lots }))
    return lots
  }

  async function addLine(item: ItemRow) {
    if (lines.some((l) => l.item_id === item.id)) { setSearch(''); setResults([]); return }
    let fefo: LotRow | undefined
    if (type === 'pharmacy') {
      const lots = await loadLots(item.id)
      fefo = lots[0]
    }
    setLines((prev) => [...prev, {
      item_id: item.id, name: item.name, code: item.code || '', unit: item.unit || 'UN',
      quantity: 1, expiry_tracking_id: fefo?.id ?? null,
    }])
    setSearch(''); setResults([])
  }
  function updateLine(idx: number, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)))
  }
  function removeLine(idx: number) {
    setLines((prev) => prev.filter((_, i) => i !== idx))
  }

  const totalQty = lines.reduce((s, l) => s + (l.quantity || 0), 0)
  // Farmacia: lote OBRIGATORIO em cada linha (rastreio de baixa por lote).
  // Almox: mantem opcional — muito material sem lote (canetas, papel, etc).
  const linhasSemLote = type === 'pharmacy' && lines.some((l) => !l.expiry_tracking_id)
  const canSubmit =
    reason &&
    lines.length > 0 &&
    lines.every((l) => l.quantity > 0) &&
    (!needsDestino || !!destino) &&
    !linhasSemLote

  async function handleSubmit() {
    setError(null)
    if (!canSubmit) {
      if (linhasSemLote) {
        setError('Selecione o lote em todas as linhas — obrigatório pra farmácia.')
        return
      }
      setError(needsDestino && !destino
        ? 'Para este motivo, informe o destino.'
        : 'Selecione o motivo e ao menos uma linha com quantidade válida.')
      return
    }
    const [destinoTipo, destinoNome] = destino ? destino.split('|') : [null, null]
    setSubmitting(true)
    try {
      const { data, error: rpcError } = await supabase.rpc('registrar_saida_lote', {
        p_item_type: type,
        p_reason: reason,
        p_reason_detail: reasonDetail.trim() || null,
        p_notes: null,
        p_location_code: locationCode,
        p_destino_tipo: destinoTipo,
        p_destino_nome: destinoNome,
        p_items: lines.map((l) => ({
          item_id: l.item_id,
          quantity: l.quantity,
          expiry_tracking_id: l.expiry_tracking_id,
        })),
      })
      if (rpcError) throw rpcError
      const n = (data as any)?.itens ?? lines.length
      setToast(`Saída registrada: ${n} ${n === 1 ? 'item' : 'itens'}.`)
      setTimeout(() => navigate(backTo), 1200)
    } catch (e: any) {
      console.error('Saida error:', e)
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(backTo)} className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 flex-wrap">
            <PackageMinus className="w-6 h-6 text-red-600" />
            Registrar Saída — {type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
          </h1>
          <p className="text-sm text-gray-500">Dê baixa em vários itens de uma vez. Escolha o motivo.</p>
        </div>
      </div>

      {/* Motivo */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <PackageMinus className="w-4 h-4" /> Motivo da Saída
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="reason">Motivo *</Label>
            <select id="reason" value={reason} onChange={(e) => setReason(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm">
              {REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </div>
          <div>
            <Label htmlFor="detail">Detalhe / Observação {reason === 'outro' ? '*' : '(opcional)'}</Label>
            <Input id="detail" value={reasonDetail} onChange={(e) => setReasonDetail(e.target.value)} placeholder="Descreva o motivo" className="mt-1" />
          </div>
          {/* Destino aparece SEMPRE (fornecedores + hospitais parceiros + setores
              internos). E obrigatorio pra transferencia / devolucao_fornecedor;
              opcional pros demais motivos (quebra, vencimento etc) — util quando
              o operador precisa registrar a quem se destinava a saida. */}
          <div className="md:col-span-2">
            <Label htmlFor="destino">Destino {needsDestino ? '*' : '(opcional)'}</Label>
            <select id="destino" value={destino} onChange={(e) => setDestino(e.target.value)}
              className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm">
              <option value="">— Selecione o destino —</option>
              {destinos.fornecedores.length > 0 && (
                <optgroup label="Fornecedores">
                  {destinos.fornecedores.map((d) => <option key={'f'+d.nome} value={`${d.tipo}|${d.nome}`}>{d.nome}</option>)}
                </optgroup>
              )}
              {destinos.externas.length > 0 && (
                <optgroup label="Hospitais parceiros (unidades externas)">
                  {destinos.externas.map((d) => <option key={'e'+d.nome} value={`${d.tipo}|${d.nome}`}>{d.nome}</option>)}
                </optgroup>
              )}
              {destinos.setores.length > 0 && (
                <optgroup label="Setores (internos)">
                  {destinos.setores.map((d) => <option key={'s'+d.nome} value={`${d.tipo}|${d.nome}`}>{d.nome}</option>)}
                </optgroup>
              )}
            </select>
            <p className="text-xs text-gray-400 mt-1">
              Não está na lista?{' '}
              <a href="/farmacia/unidades-externas" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Cadastrar unidade externa</a>
              {' · '}
              <a href="/farmacia/fornecedores" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">Cadastrar fornecedor</a>
            </p>
          </div>
        </div>
      </div>

      {/* Itens */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <PackageMinus className="w-4 h-4" /> Itens da Saída
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item por nome ou código para adicionar..." className="pl-9" />
          {search.trim() && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searching ? (
                <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Buscando...</div>
              ) : results.length === 0 ? (
                <div className="px-4 py-3 text-sm text-gray-400">Nenhum item encontrado.</div>
              ) : results.map((i) => {
                const already = lines.some((l) => l.item_id === i.id)
                return (
                  <button key={i.id} onClick={() => addLine(i)} disabled={already}
                    className="w-full text-left px-4 py-2.5 border-b last:border-0 hover:bg-gray-50 disabled:opacity-50 flex items-center justify-between">
                    <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
                      <Plus className="w-3.5 h-3.5" /> {i.name}
                      {already && <span className="text-xs text-gray-400 ml-1">(já na lista)</span>}
                    </span>
                    <span className="text-xs text-gray-400">{i.code || 'sem código'} · {i.unit}</span>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {lines.length === 0 ? (
          <p className="text-sm text-center py-6 text-gray-400">Nenhum item adicionado. Use a busca acima.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b">
                  <th className="text-left py-2 pr-2">Item</th>
                  <th className="text-right py-2 px-2 w-24">Qtd</th>
                  {type === 'pharmacy' && <th className="text-left py-2 px-2 w-72">Lote (FEFO)</th>}
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, idx) => {
                  const lots = lotsByItem[l.item_id] || []
                  return (
                    <tr key={l.item_id} className="border-b last:border-0">
                      <td className="py-2 pr-2">
                        <p className="font-medium text-gray-900">{l.name}</p>
                        <p className="text-xs text-gray-400">{l.code || 'sem código'} · {l.unit}</p>
                      </td>
                      <td className="py-2 px-2">
                        <Input
                          type="number"
                          min={1}
                          value={l.quantity === 0 ? '' : l.quantity}
                          placeholder="0"
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => updateLine(idx, { quantity: e.target.value === '' ? 0 : parseInt(e.target.value) || 0 })}
                          onWheel={(e) => e.currentTarget.blur()}
                          className="w-20 text-right"
                        />
                      </td>
                      {type === 'pharmacy' && (
                        <td className="py-2 px-2">
                          <select
                            value={l.expiry_tracking_id ?? ''}
                            onChange={(e) => updateLine(idx, { expiry_tracking_id: e.target.value || null })}
                            className={`w-full h-9 rounded-md border px-2 py-1 bg-white text-xs ${
                              l.expiry_tracking_id ? 'border-input' : 'border-red-300'
                            }`}
                          >
                            <option value="">— Selecione o lote —</option>
                            {lots.map((lo, li) => (
                              <option key={lo.id} value={lo.id}>
                                {li === 0 ? '★ ' : ''}Lote {lo.batch_number} · Val {fmt(lo.expiry_date)} · {lo.current_quantity} un
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      <td className="py-2 text-right">
                        <button onClick={() => removeLine(idx)} className="text-red-500 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold text-gray-800">
                  <td className="py-2 pr-2 text-right">Total</td>
                  <td className="py-2 px-2 text-right">{totalQty}</td>
                  {type === 'pharmacy' && <td></td>}
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>

      {error && (
        <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2"><AlertCircle className="w-4 h-4" /> {error}</div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 flex items-center gap-1"><Building2 className="w-4 h-4" /> Origem: {locationLabel}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(backTo)}>Cancelar</Button>
          <Button onClick={handleSubmit} disabled={!canSubmit || submitting} className="bg-red-600 hover:bg-red-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <PackageMinus className="w-4 h-4 mr-2" />}
            Registrar Saída
          </Button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-green-600 text-white text-sm font-medium"><CheckCircle2 className="w-5 h-5" /> {toast}</div>
      )}
    </div>
  )
}
