// =====================================================================
// Nova Entrada — ALMOXARIFADO (arquivo separado de farmacia)
//
// Historico: essa tela era compartilhada com farmacia via `type` prop
// em nf-entry.tsx, mas as regras da farmacia (fornecedores cadastrados,
// lote/validade obrigatorios etc) foram entrando no arquivo comum e
// acabaram impactando o fluxo do almoxarifado, que e mais simples.
//
// Este arquivo restaura o comportamento estavel da entrada de almox
// (baseado no commit 4ac55e0 "feat(estoque): entradas em lote
// multi-tipo + saidas em lote") + suporte a ?loc=<CODE> pra a entrada
// ir no estoque especifico (ALMOX ou SAT_T).
//
// NAO MODIFICAR pra necessidades da farmacia. Farmacia usa nf-entry.tsx.
// =====================================================================

import { useState, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  ArrowLeft, FileText, Building2, Search, Plus, Trash2, Loader2, Package, CheckCircle2, AlertCircle,
  PackagePlus, X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CurrencyInput } from '@/components/ui/currency-input'
import { supabase } from '@/lib/supabase'
import { itemsService } from '@/lib/services/items'
import type { ItemCategory, UnitType } from '@/lib/services/items'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { novaRodadaId, useTravaEnvio, lerAvisoEntrada, descreverParecida, avisoValidade, type EntradaParecida } from '@/lib/utils/entradas'
import { hojeLocal, termoIlike, lerQuantidade, erroQuantidade } from '@/lib/utils/seguro'

interface ItemRow {
  id: string
  code: string | null
  name: string
  unit: string
}

interface LineItem {
  // Identidade da LINHA, nao do item: o mesmo material pode aparecer varias
  // vezes, uma por lote. Sem isto o React repete chave e embaralha as linhas.
  _uid: string
  item_id: string
  name: string
  code: string
  unit: string
  // Texto do campo; convertido so ao validar/enviar (vazio fica vazio).
  quantity: string
  batch_number: string
  expiry_date: string
  unit_price: number
}

// Teto por linha (o banco tambem recusa acima disso).
const QTD_MAXIMA = 100000
function erroLinha(q: string): string | null {
  const e = erroQuantidade(q)
  if (e) return e
  if ((lerQuantidade(q) ?? 0) > QTD_MAXIMA) return `Quantidade acima de ${QTD_MAXIMA.toLocaleString('pt-BR')}: confira.`
  return null
}

const ENTRY_TYPES = ['Compra', 'Empréstimo', 'Doação', 'Permuta', 'Consignado', 'Troca de validade'] as const
// 'Inventário' nao entra em ENTRY_TYPES pra nao aparecer no Almoxarifado —
// so o tipo precisa conhece-lo, porque a Satelite Terreo usa esta tela.
type EntryType = typeof ENTRY_TYPES[number] | 'Inventário'

const LOC_LABELS: Record<string, string> = {
  ALMOX: 'Almoxarifado',
  SAT_T: 'Satélite Térreo',
}

// Unidades e categorias do cadastro rapido de item inedito. Espelham as
// opcoes do cadastro completo (Novo Item da tela de materiais), mas ficam
// LOCAIS de proposito: nada nesta tela pode depender de componente
// compartilhado com a farmacia (ver cabecalho do arquivo).
const UNIT_OPTIONS = [
  'Un', 'Pc', 'Cx', 'Fr', 'Amp', 'Tb', 'Rl', 'Lt', 'Kg', 'Gl',
  'ml', 'g', 'Pr', 'Cj', 'Sc', 'Rm', 'Ct', 'FL',
] as const

const WAREHOUSE_CATEGORIES = [
  'MATERIAL HOSPITALAR',
  'MATERIAL DE EXPEDIENTE',
  'MATERIAL DE HIGIENIZAÇÃO',
  'HIGIENIZAÇÃO E LIMPEZA',
  'EPI',
  'OUTROS',
] as const

const EMPTY_NEW_ITEM = { code: '', name: '', unit: 'Un', category: 'MATERIAL HOSPITALAR' }

function formatCNPJ(value: string) {
  const n = value.replace(/\D/g, '').slice(0, 14)
  return n
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d)/, '$1-$2')
}

export function NfEntryWarehouse() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const locationCode = searchParams.get('loc') || 'ALMOX'
  const locationLabel = LOC_LABELS[locationCode] ?? locationCode
  // Esta tela atende o Almoxarifado E a Satelite Terreo (estoque de material
  // da farmacia). O tipo "Inventario" existe so no lado da farmacia — a lista
  // do almoxarifado fica exatamente como era.
  const isFarmacia = locationCode !== 'ALMOX'
  const tiposEntrada: readonly string[] = isFarmacia
    ? [...ENTRY_TYPES, 'Inventário']
    : ENTRY_TYPES
  const backTo = '/inventory/warehouse'
  const today = hojeLocal()

  // Cabeçalho
  const [entryType, setEntryType] = useState<EntryType>('Compra')
  const isCompra = entryType === 'Compra'
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(today)
  const [afmNumber, setAfmNumber] = useState('')
  const [supplierCnpj, setSupplierCnpj] = useState('')
  const [supplierName, setSupplierName] = useState('')
  // Mercadoria que chegou antes da nota: entra como "NF pendente" e a nota e
  // completada depois NA MESMA entrada (tela Entradas), sem lancar de novo.
  const [nfPendente, setNfPendente] = useState(false)

  // Rodada: um id por abertura desta tela. O banco recusa a mesma rodada duas
  // vezes — duplo clique ou reenvio nao somam de novo.
  const [rodadaId] = useState(novaRodadaId)
  const trava = useTravaEnvio()
  const [parecida, setParecida] = useState<EntradaParecida | null>(null)

  const [lines, setLines] = useState<LineItem[]>([])
  const [search, setSearch] = useState('')
  const [results, setResults] = useState<ItemRow[]>([])
  const [searching, setSearching] = useState(false)
  const [erroBusca, setErroBusca] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  // Cadastro rapido de item inedito (item que nunca existiu no catalogo).
  const [showNewItem, setShowNewItem] = useState(false)
  const [newItem, setNewItem] = useState({ ...EMPTY_NEW_ITEM })
  const [creatingItem, setCreatingItem] = useState(false)
  const travaItem = useTravaEnvio()
  const [newItemError, setNewItemError] = useState<string | null>(null)
  // Aviso de nome parecido com item ja cadastrado (mostra uma vez por nome).
  const [parecidos, setParecidos] = useState<ItemRow[]>([])
  const [parecidosDoNome, setParecidosDoNome] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(async () => {
      const q = search.trim()
      if (!q) { setResults([]); setErroBusca(null); return }
      setSearching(true)
      setErroBusca(null)
      // termoIlike: virgula/parenteses no nome ("LUVA (M), NITRILICA") quebravam
      // a busca (400) e a tela sugeria cadastrar item novo.
      const { data, error: err } = await supabase
        .from('warehouse_items')
        .select('id, code, name, unit')
        .eq('is_active', true)
        .or(`name.ilike.${termoIlike(q)},code.ilike.${termoIlike(q)}`)
        .order('name')
        .limit(20)
      if (err) {
        console.error(err)
        setErroBusca(getErrorMessage(err))
        setResults([])
      } else {
        setResults((data || []) as ItemRow[])
      }
      setSearching(false)
    }, 200)
    return () => clearTimeout(t)
  }, [search])

  function novaLinha(item: ItemRow): LineItem {
    return {
      _uid: `${item.id}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      item_id: item.id, name: item.name, code: item.code || '', unit: item.unit || 'UN',
      quantity: '1', batch_number: '', expiry_date: '', unit_price: 0,
    }
  }
  function addLine(item: ItemRow) {
    // O MESMO item pode entrar em varias linhas — uma por LOTE (NF com o
    // mesmo material em 2 lotes), no Almoxarifado e na Satelite Terreo. A RPC
    // trata cada linha de forma independente, criando/somando o lote por
    // (item, lote, local). Cada linha tem _uid proprio.
    setLines((prev) => [...prev, novaLinha(item)])
    setSearch(''); setResults([])
  }
  function updateLine(uid: string, patch: Partial<LineItem>) {
    setLines((prev) => prev.map((l) => (l._uid === uid ? { ...l, ...patch } : l)))
  }
  function removeLine(uid: string) {
    setLines((prev) => prev.filter((l) => l._uid !== uid))
  }

  // Veio do Editar Item ("Registrar entrada de NF"): ?item=<id> ja entra na lista.
  const itemInicial = searchParams.get('item')
  useEffect(() => {
    if (!itemInicial) return
    let vivo = true
    supabase.from('warehouse_items').select('id, code, name, unit').eq('id', itemInicial).eq('is_active', true).maybeSingle()
      .then(({ data, error: err }) => {
        if (!vivo) return
        if (err) { setError(`Não foi possível carregar o item: ${getErrorMessage(err)}`); return }
        const it = data as ItemRow | null
        if (it) setLines((prev) => (prev.some((l) => l.item_id === it.id) ? prev : [...prev, novaLinha(it)]))
      })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemInicial])

  // ---- Item inedito -------------------------------------------------
  // O almoxarife recebe material que nunca esteve no catalogo e precisa
  // dar entrada na hora. Aqui ele cadastra o minimo (codigo + descritivo
  // + unidade + categoria) e o item ja entra na lista da NF. Os demais
  // campos (estoque min/max, prazo de reposicao, setores) continuam na
  // tela de cadastro completa — nao sao necessarios pra receber a carga.
  //
  // Grava SO em warehouse_items (catalogo do almox/SAT_T). Nao encosta em
  // pharmacy_items nem em nada da farmacia.
  function openNewItem() {
    setNewItem({ ...EMPTY_NEW_ITEM, name: search.trim() })
    setNewItemError(null)
    setShowNewItem(true)
    setResults([])
  }

  function closeNewItem() {
    setShowNewItem(false)
    setNewItemError(null)
    setParecidos([])
    setParecidosDoNome(null)
    setNewItem({ ...EMPTY_NEW_ITEM })
  }

  async function handleCreateItem() {
    const code = newItem.code.trim()
    const name = newItem.name.trim()
    if (!code) { setNewItemError('Informe o código do item.'); return }
    if (name.length < 3) { setNewItemError('O descritivo precisa ter ao menos 3 caracteres.'); return }
    // Duplo clique cadastrava o item duas vezes (o disabled so vale no redesenho).
    if (!travaItem.tentar()) return

    setCreatingItem(true)
    setNewItemError(null)
    try {
      // Nome parecido com item ja cadastrado: avisa uma vez; o 2o clique cadastra.
      if (parecidosDoNome !== name) {
        const achados = await itemsService.nomesParecidos(name, 'warehouse')
        setParecidosDoNome(name)
        if (achados.length > 0) {
          setParecidos(achados)
          return
        }
      }
      // current_stock 0 de proposito: o saldo entra pela propria NF logo
      // abaixo (RPC registrar_entrada_nf), nao pelo cadastro. Se mandasse
      // saldo aqui, a quantidade entraria duas vezes.
      const created = await itemsService.create({
        code,
        name,
        category: newItem.category as ItemCategory,
        unit: newItem.unit as UnitType,
        min_stock: 0,
        max_stock: 0,
        current_stock: 0,
      }, 'warehouse')

      addLine({
        id: created.id,
        code: created.code || code,
        name: created.name || name,
        unit: created.unit || newItem.unit,
      })
      closeNewItem()
      setSearch('')
      setToast(`Item "${name}" cadastrado e adicionado à entrada.`)
      setTimeout(() => setToast(null), 3000)
    } catch (e: any) {
      console.error('Create item error:', e)
      const raw = (e?.message || '').toString()
      if (raw.includes('duplicate key') || raw.includes('unique constraint') || raw.includes('code_unique')) {
        setNewItemError('Já existe um item com esse código. Procure por ele na busca acima ou use outro código.')
      } else if (raw.includes('row-level security') || raw.includes('violates row-level')) {
        setNewItemError('Seu perfil não tem permissão para cadastrar item no catálogo. Fale com o gestor do almoxarifado.')
      } else {
        setNewItemError(getErrorMessage(e))
      }
    } finally {
      setCreatingItem(false)
      travaItem.liberar()
    }
  }

  const totalQty = lines.reduce((s, l) => s + (lerQuantidade(l.quantity) ?? 0), 0)
  const totalValue = lines.reduce((s, l) => s + (lerQuantidade(l.quantity) ?? 0) * (l.unit_price || 0), 0)

  // Validacao "estilo antigo do almox": lote/validade NAO sao obrigatorios
  // — muito material de expediente/limpeza nao tem lote nem validade.
  // No Inventario nao existe fornecedor — a contagem nao vem de ninguem.
  const isInventario = entryType === 'Inventário'
  const canSubmit =
    (isInventario || supplierName.trim()) &&
    (!isCompra || nfPendente || (invoiceNumber.trim() && invoiceDate && afmNumber.trim())) &&
    lines.length > 0 && lines.every((l) => !erroLinha(l.quantity))

  async function handleSubmit(confirmarParecida = false) {
    setError(null)
    const linhaRuim = lines.find((l) => erroLinha(l.quantity))
    if (linhaRuim) {
      setError(`${linhaRuim.name}: ${erroLinha(linhaRuim.quantity)}`)
      return
    }
    if (!canSubmit) {
      setError(isCompra
        ? 'Para Compra, preencha NF, data, AFM, fornecedor e ao menos uma linha válida — ou marque "a NF ainda não chegou".'
        : 'Informe a origem/fornecedor e ao menos uma linha com quantidade válida.')
      return
    }
    // Fecha na hora do clique; so reabre se der erro (no sucesso a tela sai).
    if (!trava.tentar()) return
    setParecida(null)
    setSubmitting(true)
    let gravou = false
    try {
      const { data, error: rpcError } = await supabase.rpc('registrar_entrada_nf', {
        p_item_type: 'warehouse',
        p_invoice_number: invoiceNumber.trim() || null,
        p_invoice_date: invoiceDate || null,
        p_afm_number: afmNumber.trim() || null,
        p_supplier_cnpj: supplierCnpj.trim() || null,
        p_supplier_name: supplierName.trim(),
        p_acquisition_type: entryType,
        p_location_code: locationCode,
        p_entry_group_id: rodadaId,
        p_confirmar_parecida: confirmarParecida,
        p_nf_pendente: isCompra && nfPendente,
        p_items: lines.map((l) => ({
          item_id: l.item_id,
          quantity: lerQuantidade(l.quantity),
          unit_price: l.unit_price ?? 0,
          batch_number: l.batch_number.trim() || null,
          expiry_date: l.expiry_date || null,
        })),
      })
      if (rpcError) throw rpcError
      const n = (data as any)?.itens ?? lines.length
      gravou = true
      setToast(`Entrada (${entryType}) registrada: ${n} ${n === 1 ? 'item' : 'itens'}.`)
      setTimeout(() => navigate(backTo), 1200)
    } catch (e: any) {
      const aviso = lerAvisoEntrada(e)
      if (aviso?.tipo === 'ja_registrada') {
        // O primeiro envio ja gravou (duplo clique / reenvio). Nada foi somado de novo.
        gravou = true
        setToast('Esta entrada já tinha sido registrada — nada foi somado de novo.')
        setTimeout(() => navigate(backTo), 1500)
      } else if (aviso?.tipo === 'parecida') {
        setParecida(aviso.info)
      } else {
        console.error('Entry error:', e)
        setError(getErrorMessage(e))
      }
    } finally {
      setSubmitting(false)
      if (!gravou) trava.liberar()
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate(backTo)} className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white hover:bg-gray-50">
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <FileText className="w-6 h-6 text-emerald-600" />
            Nova Entrada — {locationLabel}
          </h1>
          <p className="text-sm text-gray-500">Lance vários itens de uma vez. Escolha o tipo de entrada.</p>
        </div>
      </div>

      {/* Dados da entrada */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <FileText className="w-4 h-4" /> Dados da Entrada
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <Label htmlFor="etype">Tipo de Entrada *</Label>
            <select
              id="etype"
              value={entryType}
              onChange={(e) => setEntryType(e.target.value as EntryType)}
              className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm"
            >
              {/* Mesmo rotulo da tela de medicamento: a farmacia chama de
                  "Ajuste por inventário". O valor gravado segue 'Inventário'. */}
              {tiposEntrada.map((t) => (
                <option key={t} value={t}>{t === 'Inventário' ? 'Ajuste por inventário' : t}</option>
              ))}
            </select>
          </div>
          <div>
            <Label htmlFor="nf">Número da NF {isCompra && !nfPendente ? '*' : '(opcional)'}</Label>
            <Input id="nf" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} placeholder="Ex: NF-123456" className="mt-1" />
            {isCompra && (
              <label className="flex items-start gap-2 mt-2 text-xs text-gray-600">
                <input type="checkbox" checked={nfPendente} onChange={(e) => setNfPendente(e.target.checked)} className="mt-0.5" />
                <span>A NF ainda não chegou. A entrada fica como <strong>NF pendente</strong> e a nota é completada depois em <strong>Entradas</strong>, sem lançar de novo.</span>
              </label>
            )}
          </div>
          <div>
            <Label htmlFor="data">Data {isCompra && !nfPendente ? '*' : ''}</Label>
            <Input id="data" type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className="mt-1 w-fit min-w-[180px]" />
          </div>
          <div>
            <Label htmlFor="afm">Número da AFM {isCompra && !nfPendente ? '*' : '(opcional)'}</Label>
            <Input id="afm" value={afmNumber} onChange={(e) => setAfmNumber(e.target.value)} placeholder="Ex: AFM-2026-001" className="mt-1" />
          </div>
          <div>
            <Label htmlFor="cnpj">CNPJ (opcional)</Label>
            <Input id="cnpj" value={supplierCnpj} onChange={(e) => setSupplierCnpj(formatCNPJ(e.target.value))} placeholder="00.000.000/0000-00" maxLength={18} className="mt-1" />
          </div>
          <div>
            <Label htmlFor="forn">{isCompra ? 'Fornecedor *' : isInventario ? 'Fornecedor / Origem (opcional)' : 'Fornecedor / Origem *'}</Label>
            <Input id="forn" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} placeholder={isCompra ? 'Empresa fornecedora' : 'Quem forneceu / origem'} className="mt-1" />
          </div>
        </div>
      </div>

      {/* Itens */}
      <div className="bg-white border border-gray-100 rounded-xl shadow-sm p-6 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-700 border-b pb-2">
          <Package className="w-4 h-4" /> Itens da Entrada
        </div>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar item por nome ou código para adicionar..." className="pl-9" />
          {search.trim() && (
            <div className="absolute z-20 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {searching ? (
                <div className="px-4 py-3 text-sm text-gray-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Buscando...</div>
              ) : erroBusca ? (
                <div className="px-4 py-3 text-sm text-red-700 bg-red-50 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> Erro na busca: {erroBusca}. Tente de novo.
                </div>
              ) : (
                <>
                  {results.length === 0 ? (
                    <div className="px-4 py-3 text-sm text-gray-400">Nenhum item encontrado.</div>
                  ) : results.map((i) => {
                    // Item ja na lista nao e bloqueado: clicar de novo cria outra
                    // linha, para lancar um segundo lote do mesmo item.
                    const qtdLinhas = lines.filter((l) => l.item_id === i.id).length
                    return (
                      <button key={i.id} onClick={() => addLine(i)}
                        className="w-full text-left px-4 py-2.5 border-b last:border-0 hover:bg-gray-50 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900 flex items-center gap-1">
                          <Plus className="w-3.5 h-3.5" /> {i.name}
                          {qtdLinhas > 0 && (
                            <span className="text-xs text-blue-500 ml-1">({qtdLinhas} na lista — clique p/ outro lote)</span>
                          )}
                        </span>
                        <span className="text-xs text-gray-400">{i.code || 'sem código'} · {i.unit}</span>
                      </button>
                    )
                  })}
                  {/* Saida pro item que nunca existiu: cadastra na hora. */}
                  <button
                    onClick={openNewItem}
                    className="w-full text-left px-4 py-2.5 border-t border-gray-200 bg-emerald-50/70 hover:bg-emerald-100 flex items-center gap-2 text-sm font-medium text-emerald-700"
                  >
                    <PackagePlus className="w-4 h-4 flex-shrink-0" />
                    <span className="truncate">Cadastrar item novo: “{search.trim()}”</span>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {showNewItem && (
          <div className="border border-emerald-200 bg-emerald-50/40 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-emerald-50 border-b border-emerald-200">
              <span className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                <PackagePlus className="w-4 h-4" /> Cadastrar item novo
              </span>
              <button onClick={closeNewItem} className="text-emerald-700 hover:text-emerald-900 p-1" title="Cancelar cadastro">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="p-4 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="ni-code">Código *</Label>
                  <Input
                    id="ni-code"
                    value={newItem.code}
                    onChange={(e) => setNewItem((p) => ({ ...p, code: e.target.value }))}
                    placeholder="Ex: MAT-045"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="ni-cat">Categoria *</Label>
                  <select
                    id="ni-cat"
                    value={newItem.category}
                    onChange={(e) => setNewItem((p) => ({ ...p, category: e.target.value }))}
                    className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm"
                  >
                    {WAREHOUSE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-[1fr,180px] gap-4">
                <div>
                  <Label htmlFor="ni-name">Descritivo *</Label>
                  <Input
                    id="ni-name"
                    value={newItem.name}
                    onChange={(e) => setNewItem((p) => ({ ...p, name: e.target.value }))}
                    placeholder="Nome/descrição do material"
                    className="mt-1"
                  />
                </div>
                <div>
                  <Label htmlFor="ni-unit">Unidade *</Label>
                  <select
                    id="ni-unit"
                    value={newItem.unit}
                    onChange={(e) => setNewItem((p) => ({ ...p, unit: e.target.value }))}
                    className="mt-1 w-full h-9 rounded-md border border-input px-3 py-1 bg-white text-sm"
                  >
                    {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {newItemError && (
                <div className="p-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {newItemError}
                </div>
              )}
              {parecidos.length > 0 && parecidosDoNome === newItem.name.trim() && (
                <div className="p-3 text-sm text-amber-900 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                  <p><strong>Já existe item com nome parecido.</strong> Confira se não é o mesmo antes de cadastrar outro:</p>
                  <ul className="space-y-1">
                    {parecidos.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2">
                        <span>{p.name} <span className="text-xs text-amber-700">({p.code || 'sem código'})</span></span>
                        <Button size="sm" variant="outline" onClick={() => { addLine(p); closeNewItem() }}>Usar este</Button>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs">Se é outro item mesmo, clique em <strong>Cadastrar e adicionar</strong> de novo.</p>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-gray-500">
                  O item entra no catálogo e já é adicionado à lista abaixo. A quantidade você informa na linha da NF.
                </p>
                <div className="flex gap-2 flex-shrink-0">
                  <Button variant="outline" onClick={closeNewItem} disabled={creatingItem}>Cancelar</Button>
                  <Button onClick={handleCreateItem} disabled={creatingItem} className="bg-emerald-600 hover:bg-emerald-700 text-white">
                    {creatingItem ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Plus className="w-4 h-4 mr-2" />}
                    Cadastrar e adicionar
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {lines.length === 0 ? (
          <p className="text-sm text-center py-6 text-gray-400">Nenhum item adicionado. Use a busca acima.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 uppercase border-b">
                  <th className="text-left py-2 pr-2">Item</th>
                  <th className="text-right py-2 px-2 w-24">Qtd</th>
                  <th className="text-left py-2 px-2 w-32">Lote</th>
                  <th className="text-left py-2 px-2 w-36">Validade</th>
                  <th className="text-right py-2 px-2 w-32">Vlr. Unit.</th>
                  <th className="text-right py-2 px-2 w-28">Total</th>
                  <th className="w-10"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l._uid} className="border-b last:border-0">
                    <td className="py-2 pr-2">
                      <p className="font-medium text-gray-900">{l.name}</p>
                      <p className="text-xs text-gray-400">{l.code || 'sem código'} · {l.unit}</p>
                    </td>
                    <td className="py-2 px-2">
                      <Input
                        type="text"
                        inputMode="numeric"
                        value={l.quantity}
                        placeholder="0"
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => updateLine(l._uid, { quantity: e.target.value })}
                        onWheel={(e) => e.currentTarget.blur()}
                        className={`w-20 text-right ${erroLinha(l.quantity) ? 'border-red-400' : ''}`}
                      />
                      {erroLinha(l.quantity) && <p className="text-xs text-red-600 mt-1 max-w-[8rem]">{erroLinha(l.quantity)}</p>}
                    </td>
                    <td className="py-2 px-2">
                      <Input value={l.batch_number} onChange={(e) => updateLine(l._uid, { batch_number: e.target.value })} placeholder="Lote (opcional)" className="w-28" />
                    </td>
                    <td className="py-2 px-2">
                      <Input type="date" value={l.expiry_date} onChange={(e) => updateLine(l._uid, { expiry_date: e.target.value })} className="w-36" />
                      {avisoValidade(l.expiry_date, invoiceDate || today) && (
                        <p className="text-xs text-amber-700 mt-1 max-w-[9rem]">{avisoValidade(l.expiry_date, invoiceDate || today)}</p>
                      )}
                    </td>
                    <td className="py-2 px-2">
                      <div className="w-28 ml-auto"><CurrencyInput value={l.unit_price} onChange={(v) => updateLine(l._uid, { unit_price: v ?? 0 })} /></div>
                    </td>
                    <td className="py-2 px-2 text-right font-medium text-gray-700">
                      R$ {((lerQuantidade(l.quantity) ?? 0) * (l.unit_price || 0)).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </td>
                    <td className="py-2 text-right">
                      <button onClick={() => removeLine(l._uid)} className="text-red-500 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-gray-200 font-semibold text-gray-800">
                  <td className="py-2 pr-2 text-right">Totais</td>
                  <td className="py-2 px-2 text-right">{totalQty}</td>
                  <td colSpan={3}></td>
                  <td className="py-2 px-2 text-right">R$ {totalValue.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
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

      {parecida && (
        <div className="p-4 text-sm bg-amber-50 border border-amber-300 rounded-lg space-y-3">
          <p className="flex items-start gap-2 text-amber-900">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span><strong>Esta entrada parece repetida.</strong> {descreverParecida(parecida)}</span>
          </p>
          <p className="text-amber-800 text-xs">
            Se a nota só chegou agora para uma mercadoria que já entrou, <strong>não registre de novo</strong>: vá em
            Entradas e complete a entrada que já existe.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => setParecida(null)}>Cancelar</Button>
            <Button size="sm" className="bg-amber-600 hover:bg-amber-700 text-white" onClick={() => handleSubmit(true)} disabled={submitting}>
              É outra entrada — registrar mesmo assim
            </Button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500 flex items-center gap-1"><Building2 className="w-4 h-4" /> Destino: {locationLabel}</p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate(backTo)}>Cancelar</Button>
          <Button onClick={() => handleSubmit()} disabled={!canSubmit || submitting} className="bg-emerald-600 hover:bg-emerald-700 text-white">
            {submitting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CheckCircle2 className="w-4 h-4 mr-2" />}
            Registrar Entrada
          </Button>
        </div>
      </div>

      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 px-5 py-3 rounded-xl shadow-lg bg-green-600 text-white text-sm font-medium"><CheckCircle2 className="w-5 h-5" /> {toast}</div>
      )}
    </div>
  )
}
