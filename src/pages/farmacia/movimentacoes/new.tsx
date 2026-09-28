import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Loader2, Search, Trash2, AlertCircle, ArrowRightLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth'
import {
  pharmacyLoanService,
  LOAN_TYPE_LABELS,
  LOAN_SCOPE_LABELS,
  type LoanType,
  type LoanDirection,
  type LoanItemInput,
  type LoanScope,
} from '@/lib/services/pharmacy-loan'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { hojeLocal } from '@/lib/utils/seguro'
import { externalUnitsService } from '@/lib/services/external-units'

const HECC_NAME = 'HOSPITAL ESTADUAL COSTA DOS COQUEIROS'

interface PharmacyItemLite {
  id: string
  code: string
  name: string
  unit: string | null
  current_stock: number
  last_purchase_price: number | null
  reference_price: number | null
  _kind: 'pharmacy' | 'warehouse'
}

interface RowState extends LoanItemInput {
  _key: string
  current_stock?: number
  _kind?: 'pharmacy' | 'warehouse'
}

export function NewPharmacyLoan({ scope }: { scope: LoanScope }) {
  const navigate = useNavigate()
  const { user } = useAuth()

  const baseRoute = scope === 'pharmacy' ? '/farmacia/movimentacoes' : '/almoxarifado/movimentacoes'

  // Cabeçalho
  const [origem, setOrigem] = useState(HECC_NAME)
  const [destino, setDestino] = useState('')
  const [contatoOrigem, setContatoOrigem] = useState(user?.full_name || '')
  const [contatoDestino, setContatoDestino] = useState('')
  const [formDate, setFormDate] = useState(hojeLocal())
  // Unidades externas cadastradas (parceiros) — carregadas do banco. Junto
  // com HECC formam as opcoes de origem/destino no dropdown.
  const [externalUnits, setExternalUnits] = useState<string[]>([])

  useEffect(() => {
    ;(async () => {
      try {
        const list = await externalUnitsService.list()
        setExternalUnits(list.map((u: any) => u.name).filter(Boolean))
      } catch (e) {
        console.error('Falha ao carregar unidades externas:', e)
      }
    })()
  }, [])

  // Tipos de movimentação
  const [enviandoEnabled, setEnviandoEnabled] = useState(true)
  const [enviandoType, setEnviandoType] = useState<LoanType>('emprestimo')
  const [recebendoEnabled, setRecebendoEnabled] = useState(false)
  const [recebendoType, setRecebendoType] = useState<LoanType>('emprestimo')

  // Assinaturas
  const [solicitanteName, setSolicitanteName] = useState(user?.full_name || '')
  const [cedenteName, setCedenteName] = useState('')
  const [notes, setNotes] = useState('')

  // Itens
  const [items, setItems] = useState<RowState[]>([])

  // Catálogo do escopo escolhido (Farmácia OU Almoxarifado)
  const [catalog, setCatalog] = useState<PharmacyItemLite[]>([])
  const [loadingCatalog, setLoadingCatalog] = useState(true)
  const [activeSearch, setActiveSearch] = useState<LoanDirection | null>(null)
  const [searchTerm, setSearchTerm] = useState('')

  // Submit
  const [submitting, setSubmitting] = useState(false)
  const enviandoRef = useRef(false)
  const chaveRef = useRef<string>(crypto.randomUUID())
  const [error, setError] = useState('')

  useEffect(() => {
    loadCatalog()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  async function loadCatalog() {
    try {
      setLoadingCatalog(true)
      const table = scope === 'pharmacy' ? 'pharmacy_items' : 'warehouse_items'
      const { data, error } = await supabase
        .from(table)
        .select('id, code, name, unit, current_stock, last_purchase_price, reference_price')
        .eq('is_active', true)
        .order('name')
      if (error) throw error
      setCatalog(((data as any[]) || []).map((r) => ({ ...r, _kind: scope })))
    } catch (e) {
      console.error('Error loading catalog:', e)
    } finally {
      setLoadingCatalog(false)
    }
  }

  const filteredCatalog = useMemo(() => {
    if (!searchTerm.trim()) return []
    const q = searchTerm.toLowerCase()
    return catalog
      .filter((c) => c.name.toLowerCase().includes(q) || (c.code || '').toLowerCase().includes(q))
      .slice(0, 20)
  }, [catalog, searchTerm])

  const newKey = () => Math.random().toString(36).slice(2)

  const addRowFromCatalog = (direction: LoanDirection, item: PharmacyItemLite) => {
    setItems((prev) => [
      ...prev,
      {
        _key: newKey(),
        direction,
        pharmacy_item_id: item._kind === 'pharmacy' ? item.id : null,
        warehouse_item_id: item._kind === 'warehouse' ? item.id : null,
        _kind: item._kind,
        item_description: item.name,
        unit: item.unit || 'Un',
        quantity: 1,
        unit_price: item.last_purchase_price ?? item.reference_price ?? 0,
        validity_date: null,
        batch_number: '',
        codigo_simpas: item.code,
        observation: '',
        current_stock: item.current_stock,
      },
    ])
    setSearchTerm('')
    setActiveSearch(null)
  }

  // addManualRow removida — todo item da movimentacao precisa vir do
  // catalogo (via busca) pra manter integridade referencial. Linhas
  // manuais geravam registros que nao batiam com o cadastro de items.

  const updateRow = (key: string, patch: Partial<RowState>) => {
    setItems((prev) => prev.map((r) => (r._key === key ? { ...r, ...patch } : r)))
  }

  const removeRow = (key: string) => {
    setItems((prev) => prev.filter((r) => r._key !== key))
  }

  const enviandoRows = items.filter((i) => i.direction === 'enviando')
  const recebendoRows = items.filter((i) => i.direction === 'recebendo')

  const totalEnviado = enviandoRows.reduce(
    (acc, r) => acc + (Number(r.quantity) || 0) * (Number(r.unit_price) || 0),
    0
  )
  const totalRecebido = recebendoRows.reduce(
    (acc, r) => acc + (Number(r.quantity) || 0) * (Number(r.unit_price) || 0),
    0
  )

  // Retorna o motivo especifico pelo qual o submit e invalido (ou null se ok).
  // Antes o form ficava so com o botao "Registrar" desabilitado ou mostrava
  // "Valor invalido para o campo" sem dizer QUAL, e o operador ficava perdido.
  const validate = (): string | null => {
    if (!origem.trim()) return 'Informe a Origem.'
    if (!destino.trim()) return 'Informe o Destino.'
    if (!enviandoEnabled && !recebendoEnabled) return 'Marque pelo menos "ENVIANDO" ou "RECEBENDO".'
    if (items.length === 0) return 'Adicione pelo menos um item (busque pelo nome ou codigo).'
    const bad = items.find((r) => !r.item_description.trim() || r.quantity <= 0)
    if (bad) return `Verifique o item "${bad.item_description || '(sem nome)'}" — quantidade obrigatoria.`
    const semLote = items.find((r) => !r.batch_number || !r.batch_number.trim())
    if (semLote) return `Lote obrigatorio no item "${semLote.item_description}".`
    const semValidade = items.find((r) => !r.validity_date)
    if (semValidade) return `Validade obrigatoria no item "${semValidade.item_description}".`
    if (enviandoEnabled && enviandoRows.length === 0) return 'Voce marcou ENVIANDO mas nao adicionou nenhum item enviado.'
    if (recebendoEnabled && recebendoRows.length === 0) return 'Voce marcou RECEBENDO mas nao adicionou nenhum item recebido.'
    return null
  }

  const canSubmit = validate() === null

  const handleSubmit = async () => {
    const err = validate()
    if (err) {
      setError(err)
      return
    }
    if (enviandoRef.current) return
    enviandoRef.current = true
    setSubmitting(true)
    setError('')
    try {
      const result = await pharmacyLoanService.create({
        scope,
        origem,
        destino,
        contato_origem: contatoOrigem,
        contato_destino: contatoDestino,
        form_date: formDate,
        enviando_type: enviandoEnabled ? enviandoType : null,
        recebendo_type: recebendoEnabled ? recebendoType : null,
        signature_solicitante_name: solicitanteName,
        signature_cedente_name: cedenteName,
        notes,
        items: items.map((r) => ({
          direction: r.direction,
          pharmacy_item_id: r.pharmacy_item_id,
          warehouse_item_id: r.warehouse_item_id,
          item_description: r.item_description,
          unit: r.unit || undefined,
          quantity: Number(r.quantity),
          unit_price: r.unit_price ? Number(r.unit_price) : null,
          validity_date: r.validity_date || null,
          batch_number: r.batch_number || null,
          codigo_simpas: r.codigo_simpas || null,
          observation: r.observation || null,
        })),
      }, chaveRef.current)
      navigate(`${baseRoute}/${result.id}`)
    } catch (e: any) {
      setError(getErrorMessage(e))
      enviandoRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="sm" onClick={() => navigate(baseRoute)}>
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar
        </Button>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary-100 rounded-lg">
            <ArrowRightLeft className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Nova Movimentação — {LOAN_SCOPE_LABELS[scope]}</h1>
            <p className="text-sm text-gray-500">
              Empréstimo, devolução, permuta, troca de validade, consignação ou doação de itens do estoque de {LOAN_SCOPE_LABELS[scope]}.
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-lg bg-red-50 border border-red-200 flex items-center gap-2 text-red-800 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      )}

      {/* Cabeçalho */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Cabeçalho</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="origem">Origem *</Label>
            <select
              id="origem"
              value={origem}
              onChange={(e) => setOrigem(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <option value={HECC_NAME}>{HECC_NAME}</option>
              {externalUnits.map((name) => (
                <option key={`orig-${name}`} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="destino">Destino *</Label>
            <select
              id="destino"
              value={destino}
              onChange={(e) => setDestino(e.target.value)}
              className="mt-1 flex h-10 w-full rounded-md border border-input bg-white px-3 py-2 text-sm ring-offset-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500"
            >
              <option value="">— Selecione o destino —</option>
              <option value={HECC_NAME}>{HECC_NAME}</option>
              {externalUnits.map((name) => (
                <option key={`dest-${name}`} value={name}>{name}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="contato_origem">Contato (Origem)</Label>
            <Input
              id="contato_origem"
              value={contatoOrigem}
              onChange={(e) => setContatoOrigem(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="contato_destino">Contato (Destino)</Label>
            <Input
              id="contato_destino"
              value={contatoDestino}
              onChange={(e) => setContatoDestino(e.target.value)}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="form_date">Data</Label>
            {/* Data usa w-fit pra nao esticar pra largura toda da coluna —
                um input de data com ~180px ja e o suficiente. */}
            <Input
              id="form_date"
              type="date"
              value={formDate}
              onChange={(e) => setFormDate(e.target.value)}
              className="mt-1 w-fit min-w-[180px]"
            />
          </div>
        </div>
        <p className="text-xs text-gray-400 mt-3">
          Não está na lista?{' '}
          <a href="/farmacia/unidades-externas" target="_blank" rel="noopener noreferrer" className="text-blue-500 underline">
            Cadastrar unidade externa
          </a>
        </p>
      </div>

      {/* ENVIANDO */}
      <DirectionBlock
        title="ENVIANDO"
        enabled={enviandoEnabled}
        onEnabledChange={(v) => {
          setEnviandoEnabled(v)
          if (!v) setItems((prev) => prev.filter((r) => r.direction !== 'enviando'))
        }}
        type={enviandoType}
        onTypeChange={setEnviandoType}
        colorClass="bg-amber-50 border-amber-200 text-amber-900"
        rows={enviandoRows}
        updateRow={updateRow}
        removeRow={removeRow}
        searchOpen={activeSearch === 'enviando'}
        onSearchOpen={() => {
          setActiveSearch('enviando')
          setSearchTerm('')
        }}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        searchResults={filteredCatalog}
        onPick={(item) => addRowFromCatalog('enviando', item)}
        total={totalEnviado}
        loadingCatalog={loadingCatalog}
        scope={scope}
      />

      {/* RECEBENDO */}
      <DirectionBlock
        title="RECEBENDO"
        enabled={recebendoEnabled}
        onEnabledChange={(v) => {
          setRecebendoEnabled(v)
          if (!v) setItems((prev) => prev.filter((r) => r.direction !== 'recebendo'))
        }}
        type={recebendoType}
        onTypeChange={setRecebendoType}
        colorClass="bg-emerald-50 border-emerald-200 text-emerald-900"
        rows={recebendoRows}
        updateRow={updateRow}
        removeRow={removeRow}
        searchOpen={activeSearch === 'recebendo'}
        onSearchOpen={() => {
          setActiveSearch('recebendo')
          setSearchTerm('')
        }}
        searchTerm={searchTerm}
        setSearchTerm={setSearchTerm}
        searchResults={filteredCatalog}
        onPick={(item) => addRowFromCatalog('recebendo', item)}
        total={totalRecebido}
        loadingCatalog={loadingCatalog}
        scope={scope}
      />

      {/* Assinaturas e observações */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">Assinaturas e Observações</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <Label htmlFor="solicitante">Assinatura do Solicitante (nome)</Label>
            <Input
              id="solicitante"
              value={solicitanteName}
              onChange={(e) => setSolicitanteName(e.target.value)}
              className="mt-1"
              placeholder="Ex: Lais Cardoso dos Anjos, Farmacêutica, CRF-BA 14858"
            />
          </div>
          <div>
            <Label htmlFor="cedente">Assinatura do Cedente (nome)</Label>
            <Input
              id="cedente"
              value={cedenteName}
              onChange={(e) => setCedenteName(e.target.value)}
              className="mt-1"
              placeholder="Ex: Silvio Roberto B. C., Farmacêutico, CRF-BA xxxxx"
            />
          </div>
        </div>
        <div>
          <Label htmlFor="notes">Observações</Label>
          <textarea
            id="notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
            placeholder="Observações adicionais (opcional)"
          />
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end gap-3 pb-8">
        <Button variant="outline" onClick={() => navigate(baseRoute)}>
          Cancelar
        </Button>
        <Button
          onClick={handleSubmit}
          disabled={!canSubmit || submitting}
          className="bg-primary-500 hover:bg-primary-600 text-white"
        >
          {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Salvar Movimentação
        </Button>
      </div>
    </div>
  )
}

function DirectionBlock(props: {
  title: string
  enabled: boolean
  onEnabledChange: (v: boolean) => void
  type: LoanType
  onTypeChange: (t: LoanType) => void
  colorClass: string
  rows: RowState[]
  updateRow: (key: string, patch: Partial<RowState>) => void
  removeRow: (key: string) => void
  searchOpen: boolean
  onSearchOpen: () => void
  searchTerm: string
  setSearchTerm: (s: string) => void
  searchResults: PharmacyItemLite[]
  onPick: (item: PharmacyItemLite) => void
  total: number
  loadingCatalog: boolean
  scope: LoanScope
}) {
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
      <div className="flex items-center justify-between mb-4">
        <label className="flex items-center gap-3 cursor-pointer">
          <input
            type="checkbox"
            checked={props.enabled}
            onChange={(e) => props.onEnabledChange(e.target.checked)}
            className="w-5 h-5 rounded"
          />
          <h2 className={`text-lg font-semibold px-3 py-1 rounded-md border ${props.colorClass}`}>
            ( {props.enabled ? 'X' : ' '} ) {props.title}
          </h2>
        </label>
        {props.enabled && (
          <div className="flex items-center gap-2">
            <Label className="text-sm">Tipo:</Label>
            <select
              value={props.type}
              onChange={(e) => props.onTypeChange(e.target.value as LoanType)}
              className="h-9 rounded-md border border-input bg-white px-3 py-1 text-sm"
            >
              {(Object.keys(LOAN_TYPE_LABELS) as LoanType[]).map((k) => (
                <option key={k} value={k}>
                  {LOAN_TYPE_LABELS[k]}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {props.enabled && (
        <>
          {/* Busca / adicionar */}
          <div className="space-y-2 mb-4">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <Input
                placeholder={
                  props.loadingCatalog
                    ? `Carregando ${props.scope === 'pharmacy' ? 'medicamentos' : 'itens do almoxarifado'}...`
                    : `Buscar item de ${props.scope === 'pharmacy' ? 'farmácia' : 'almoxarifado'} por nome ou código...`
                }
                disabled={props.loadingCatalog}
                value={props.searchOpen ? props.searchTerm : ''}
                onFocus={props.onSearchOpen}
                onChange={(e) => {
                  props.onSearchOpen()
                  props.setSearchTerm(e.target.value)
                }}
                className="pl-9"
              />
            </div>
            {props.searchOpen && props.searchResults.length > 0 && (
              <div className="rounded-lg border border-gray-200 overflow-hidden max-h-64 overflow-y-auto">
                {props.searchResults.map((it) => (
                  <button
                    key={`${it._kind}-${it.id}`}
                    type="button"
                    onClick={() => props.onPick(it)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
                  >
                    <div className="text-sm font-medium text-gray-900">{it.name}</div>
                    <div className="text-xs text-gray-500 font-mono mt-0.5">
                      {it.code} • {it.unit || 'Un'} • Estoque: {it.current_stock}
                      {it.last_purchase_price != null && ` • R$ ${it.last_purchase_price.toFixed(2)}`}
                    </div>
                  </button>
                ))}
              </div>
            )}
            {/* "Adicionar linha manual" removida — todo item precisa vir do
                catalogo (via busca acima) pra manter integridade. */}
          </div>

          {/* Linhas */}
          {props.rows.length === 0 ? (
            <div className="text-center py-6 text-sm text-gray-500 border-2 border-dashed border-gray-200 rounded-lg">
              Nenhum item adicionado. Use a busca acima.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-2 py-1 text-left font-medium text-gray-600 min-w-[240px]">Item</th>
                    <th className="px-2 py-1 text-center font-medium text-gray-600">UF</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600">Qtde *</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600">R$ Unit.</th>
                    <th className="px-2 py-1 text-right font-medium text-gray-600">R$ Total</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-600">Validade *</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-600">Lote *</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-600">Código SIMPAS</th>
                    <th className="px-2 py-1 text-left font-medium text-gray-600">Observação</th>
                    <th className="px-2 py-1"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {props.rows.map((r) => {
                    const total = (Number(r.quantity) || 0) * (Number(r.unit_price) || 0)
                    return (
                      <tr key={r._key} className="hover:bg-gray-50">
                        <td className="px-2 py-1">
                          <input
                            value={r.item_description}
                            onChange={(e) =>
                              props.updateRow(r._key, { item_description: e.target.value })
                            }
                            className="w-full min-w-[240px] px-2 py-1 text-xs border border-gray-200 rounded"
                            title={r.item_description}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={r.unit || ''}
                            onChange={(e) => props.updateRow(r._key, { unit: e.target.value })}
                            className="w-12 px-1 py-1 text-xs text-center border border-gray-200 rounded"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            min={1}
                            value={r.quantity}
                            onChange={(e) =>
                              props.updateRow(r._key, { quantity: parseFloat(e.target.value) || 0 })
                            }
                            onWheel={(e) => e.currentTarget.blur()}
                            className="w-16 px-1 py-1 text-xs text-right border border-gray-200 rounded"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="number"
                            step="0.01"
                            min={0}
                            value={r.unit_price ?? ''}
                            onChange={(e) =>
                              props.updateRow(r._key, {
                                unit_price: e.target.value === '' ? null : parseFloat(e.target.value),
                              })
                            }
                            onWheel={(e) => e.currentTarget.blur()}
                            className="w-20 px-1 py-1 text-xs text-right border border-gray-200 rounded"
                          />
                        </td>
                        <td className="px-2 py-1 text-right text-gray-700 font-medium">
                          {total ? `R$ ${total.toFixed(2)}` : '—'}
                        </td>
                        <td className="px-2 py-1">
                          <input
                            type="date"
                            value={r.validity_date || ''}
                            onChange={(e) =>
                              props.updateRow(r._key, { validity_date: e.target.value || null })
                            }
                            className={`w-32 px-1 py-1 text-xs border rounded ${!r.validity_date ? 'border-red-300' : 'border-gray-200'}`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={r.batch_number || ''}
                            onChange={(e) =>
                              props.updateRow(r._key, { batch_number: e.target.value })
                            }
                            placeholder="Obrigatório"
                            className={`w-24 px-1 py-1 text-xs border rounded ${!r.batch_number || !r.batch_number.trim() ? 'border-red-300' : 'border-gray-200'}`}
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={r.codigo_simpas || ''}
                            onChange={(e) =>
                              props.updateRow(r._key, { codigo_simpas: e.target.value })
                            }
                            className="w-32 px-1 py-1 text-xs font-mono border border-gray-200 rounded"
                          />
                        </td>
                        <td className="px-2 py-1">
                          <input
                            value={r.observation || ''}
                            onChange={(e) =>
                              props.updateRow(r._key, { observation: e.target.value })
                            }
                            className="w-32 px-1 py-1 text-xs border border-gray-200 rounded"
                          />
                        </td>
                        <td className="px-2 py-1 text-center">
                          <button
                            type="button"
                            onClick={() => props.removeRow(r._key)}
                            className="text-red-500 hover:text-red-700 p-1"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-gray-200 bg-gray-50">
                    <td colSpan={4} className="px-2 py-2 text-right font-medium text-gray-700">
                      TOTAL {props.title}:
                    </td>
                    <td className="px-2 py-2 text-right font-bold text-gray-900">
                      R$ {props.total.toFixed(2)}
                    </td>
                    <td colSpan={5}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
