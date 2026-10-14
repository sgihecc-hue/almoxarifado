import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Download, AlertCircle,
  Loader2, ArrowUpDown, Package2, FileSpreadsheet, FileText,
  Eye, Plus, Edit, Trash2, PackageMinus, ShoppingCart, Printer
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { saveAs } from 'file-saver'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { itemsService } from '@/lib/services/items'
import { AdvancedFilters } from '@/components/inventory/advanced-filters'
import { ImportDialog } from '@/components/inventory/import-dialog'
import { AddItemDialog } from '@/components/inventory/add-item-dialog'
import { EditStockDialog } from '@/components/inventory/edit-stock-dialog'
import { DeleteItemDialog } from '@/components/inventory/delete-item-dialog'
import { EditItemDialog } from '@/components/inventory/edit-item-dialog'
import { useAuth } from '@/contexts/auth'
import { supabase } from '@/lib/supabase'
import { pharmacyStockById } from '@/lib/constants/stock-locations'
import type { Item, FilterOptions } from '@/lib/services/items'
import { buscarTodas, hojeLocal, normalizarBusca } from '@/lib/utils/seguro'

interface WarehouseItemsProps {
  // Quando um satelite (ex.: SAT_T) opera sobre itens do almoxarifado, a rota
  // /inventory/stock/:id passa o location. Sem prop = almoxarifado central.
  locationId?: string
  locationName?: string
}

export function WarehouseItems({ locationId, locationName }: WarehouseItemsProps = {}) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortColumn, setSortColumn] = useState<string | null>(null)
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc')
  const [filters, setFilters] = useState<FilterOptions>({
    categories: [],
    status: []
  })
  const [showImportDialog, setShowImportDialog] = useState(false)
  const [showAddItemDialog, setShowAddItemDialog] = useState(false)
  const [showEditStockDialog, setShowEditStockDialog] = useState(false)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [selectedItem, setSelectedItem] = useState<Item | null>(null)
  const [hideZeroStock, setHideZeroStock] = useState(true)
  // N16: categorias reais do cadastro (DISTINCT), guardadas da carga sem
  // filtro de categoria (senao a lista encolhe ao filtrar).
  const [categoriasReais, setCategoriasReais] = useState<string[]>([])
  const [showEditItemDialog, setShowEditItemDialog] = useState(false)
  // Saldo local (item_id -> quantity NESTE location) quando ha locationId.
  // Vazio => usa o current_stock global do cadastro.
  const [localQtyById, setLocalQtyById] = useState<Map<string, number>>(new Map())
  // Lotes do item NESTE local, ordenados por validade (o mais proximo primeiro).
  // So e preenchido quando ha locationId — no Almoxarifado a tela segue
  // mostrando o campo de lote do proprio cadastro, como sempre.
  type LoteLocal = { batch_number: string | null; expiry_date: string | null; current_quantity: number }
  const [lotesById, setLotesById] = useState<Map<string, LoteLocal[]>>(new Map())
  // Consumo/dia CALCULADO das saídas dos últimos 30 dias (RPC
  // warehouse_consumo_diario). item_id -> unidades/dia.
  const [consumoDiaById, setConsumoDiaById] = useState<Map<string, number>>(new Map())
  // Aba "A comprar" (Rafaela 13/10): itens no ponto de ressuprimento com a
  // quantidade a comprar. Ultima COMPRA de cada item (soma das linhas da mesma
  // entrada: uma NF com 2 lotes vira 2 linhas em stock_entries).
  const [aba, setAba] = useState<'todos' | 'comprar'>('todos')
  // A aba lista TODOS os itens (o almox confere a planilha inteira, 14/10);
  // o filtro deixa so os que estao no ponto de ressuprimento.
  const [soPontoPedido, setSoPontoPedido] = useState(false)
  // Item com mais de um lote: o "+N" abre a lista (Anderson 14/10 — so via
  // tooltip ninguem achava o outro lote).
  const [lotesAbertos, setLotesAbertos] = useState<Set<string>>(new Set())
  const alternarLotes = (id: string) => setLotesAbertos((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })
  type UltimaCompra = { qtd: number; data: string }
  const [ultimaCompraById, setUltimaCompraById] = useState<Map<string, UltimaCompra>>(new Map())

  const handleEditItem = (item: Item) => {
    setSelectedItem(item)
    setShowEditItemDialog(true)
  }

  // Além de administrador e gestor, a edição pode ser concedida pessoa a
  // pessoa (tabela almox_permissoes_edicao). A gravação passa pela RPC
  // almox_editar_item, que confere a permissão de novo e exige motivo.
  const [temPermissaoEdicao, setTemPermissaoEdicao] = useState(false)
  useEffect(() => {
    if (!user?.id) return
    let vivo = true
    supabase
      .from('almox_permissoes_edicao')
      .select('user_id')
      .eq('user_id', user.id)
      .maybeSingle()
      .then(({ data }) => { if (vivo) setTemPermissaoEdicao(!!data) })
    return () => { vivo = false }
  }, [user?.id])

  const isAdmin = user?.role === 'administrador'
  const canEdit = user?.role === 'administrador' || user?.role === 'gestor' || temPermissaoEdicao

  // Saldo do item NESTE location (quando prop presente). Fallback pro campo
  // global do cadastro — usado pela rota do almoxarifado central.
  const getLocalQty = (item: Item): number => {
    if (!locationId) return item.current_stock ?? 0
    return localQtyById.get(item.id) ?? 0
  }

  // Consumo/dia do item: o CALCULADO (saídas dos últimos 30 dias) tem
  // prioridade; se não houver saída registrada, cai no valor informado à mão
  // no cadastro (avg_daily_consumption). null = não dá pra calcular.
  const consumoDia = (item: Item): number | null => {
    const calc = consumoDiaById.get(item.id)
    if (calc != null && calc > 0) return calc
    const manual = (item as any).avg_daily_consumption
    if (manual != null && !Number.isNaN(Number(manual)) && Number(manual) > 0) return Number(manual)
    return null
  }

  // Prazo de reposição PADRÃO (dias): o usuário definiu que é 30 dias para
  // todos os materiais. Cada item pode ter um prazo próprio (lead_time_days)
  // que, se preenchido, tem prioridade; senão usa este padrão.
  const PRAZO_REPOSICAO_PADRAO = 30

  // Ponto de Ressuprimento = (consumo/dia × prazo de reposição) + estoque
  // mínimo. Sempre retorna um número (nada de "—"): sem consumo conhecido, o
  // consumo entra como 0 e o ponto cai no estoque mínimo.
  const pontoRessuprimento = (item: Item): number => {
    const cd = consumoDia(item) ?? 0
    const lead = (item.lead_time_days && item.lead_time_days > 0)
      ? item.lead_time_days
      : PRAZO_REPOSICAO_PADRAO
    return Math.ceil(cd * lead + (item.min_stock || 0))
  }

  const loadItems = async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await itemsService.getByType('warehouse', filters)
      setItems(data)
      if (!filters.categories?.length) {
        setCategoriasReais(
          [...new Set(data.map((i) => (i.category as string | null) ?? '').filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, 'pt-BR'))
        )
      }

      // Consumo/dia calculado das saídas reais (últimos 30 dias).
      const { data: consumo, error: consumoErr } = await supabase.rpc('warehouse_consumo_diario')
      if (consumoErr) {
        console.error('warehouse_consumo_diario:', consumoErr)
        setConsumoDiaById(new Map())
      } else {
        setConsumoDiaById(new Map(
          (consumo ?? []).map((r: any) => [r.item_id as string, Number(r.consumo_dia)])
        ))
      }

      // Ultima compra por item (so no almoxarifado central, onde a aba existe).
      if (!locationId) {
        type Ent = { item_id: string; quantity: number; created_at: string; entry_group_id: string | null; invoice_number: string | null }
        const ents = await buscarTodas<Ent>((de, ate) =>
          supabase
            .from('stock_entries')
            .select('item_id, quantity, created_at, entry_group_id, invoice_number')
            .eq('item_type', 'warehouse')
            .eq('acquisition_type', 'Compra')
            .is('anulada_em', null)
            .order('created_at', { ascending: false })
            .order('id')
            .range(de, ate) as unknown as PromiseLike<{ data: Ent[] | null; error: unknown }>
        )
        const chave = (e: Ent) => e.entry_group_id ?? `${e.invoice_number ?? ''}|${e.created_at.slice(0, 10)}`
        const mapa = new Map<string, UltimaCompra & { k: string }>()
        for (const e of ents) {
          const atual = mapa.get(e.item_id)
          if (!atual) mapa.set(e.item_id, { qtd: Number(e.quantity) || 0, data: e.created_at, k: chave(e) })
          else if (atual.k === chave(e)) atual.qtd += Number(e.quantity) || 0
        }
        setUltimaCompraById(new Map([...mapa].map(([id, v]) => [id, { qtd: v.qtd, data: v.data }])))
      }

      // Se estamos num satelite (SAT_T), carrega saldo por location de item_stocks.
      if (locationId) {
        const { data: stocks, error: stocksErr } = await supabase
          .from('item_stocks')
          .select('item_id, quantity')
          .eq('location_id', locationId)
          .eq('item_type', 'warehouse')
        if (stocksErr) throw stocksErr
        setLocalQtyById(new Map((stocks ?? []).map((s: any) => [s.item_id, s.quantity])))

        // Lotes reais deste local. A tela mostrava warehouse_items.batch_number
        // — um campo unico do cadastro — entao um item com varios lotes exibia
        // so um, e quem entrou sem preencher esse campo aparecia sem lote.
        // Paginado: o PostgREST corta em 1000 linhas em silencio.
        const lotes = await buscarTodas<any>((de, ate) =>
          supabase
            .from('expiry_tracking')
            .select('id, item_id, batch_number, expiry_date, current_quantity')
            .eq('location_id', locationId)
            .order('expiry_date', { ascending: true, nullsFirst: false })
            .order('id')
            .range(de, ate)
        )
        const mapa = new Map<string, LoteLocal[]>()
        for (const l of lotes as any[]) {
          const lista = mapa.get(l.item_id) ?? []
          lista.push({ batch_number: l.batch_number, expiry_date: l.expiry_date, current_quantity: l.current_quantity })
          mapa.set(l.item_id, lista)
        }
        setLotesById(mapa)
      } else {
        setLocalQtyById(new Map())
        // Almoxarifado: lotes reais do ALMOX (o fechamento do inventário refaz
        // os lotes pelo contado). O lote/validade do cadastro ficou velho e o
        // Exportar saía com vencimento errado (Rafaela, 09/10).
        const { data: almox } = await supabase.from('stock_locations').select('id').eq('code', 'ALMOX').maybeSingle()
        const mapa = new Map<string, LoteLocal[]>()
        if (almox?.id) {
          const lotes = await buscarTodas<any>((de, ate) =>
            supabase
              .from('expiry_tracking')
              .select('id, item_id, batch_number, expiry_date, current_quantity')
              .eq('location_id', almox.id)
              .gt('current_quantity', 0)
              .order('expiry_date', { ascending: true, nullsFirst: false })
              .order('id')
              .range(de, ate)
          )
          for (const l of lotes as any[]) {
            const lista = mapa.get(l.item_id) ?? []
            lista.push({ batch_number: l.batch_number, expiry_date: l.expiry_date, current_quantity: l.current_quantity })
            mapa.set(l.item_id, lista)
          }
        }
        setLotesById(mapa)
      }
    } catch (error) {
      console.error('Error loading items:', error)
      setError('Erro ao carregar itens. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, locationId])

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const handleExport = async () => {
    try {
      setError(null)
      // Exporta exatamente as linhas da tela, com o saldo do LOCAL exibido.
      await itemsService.exportToExcel(
        filteredItems.map((i) => ({ ...i, current_stock: getLocalQty(i) })),
        `itens_almoxarifado_${hojeLocal()}`,
        // Num satélite vão os lotes DAQUELE local; no Almoxarifado, o do cadastro (igual à tela).
        locationId ? lotesById : new Map(filteredItems.map((i) => [i.id, lotesById.get(i.id) ??
          ((i as any).batch_number || (i as any).expiry_date
            ? [{ batch_number: (i as any).batch_number ?? null, expiry_date: (i as any).expiry_date ?? null }]
            : [])])),
      )
    } catch (error) {
      console.error('Error exporting items:', error)
      setError('Erro ao exportar itens. Por favor, tente novamente.')
    }
  }
  void setShowEditStockDialog // keep reference

  const handleDelete = (item: Item) => {
    setSelectedItem(item)
    setShowDeleteDialog(true)
  }

  const sortedItems = [...items].sort((a, b) => {
    if (!sortColumn) return 0

    const aValue = a[sortColumn as keyof Item]
    const bValue = b[sortColumn as keyof Item]

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc' 
        ? aValue.localeCompare(bValue, 'pt-BR')
        : bValue.localeCompare(aValue, 'pt-BR')
    }

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' 
        ? aValue - bValue
        : bValue - aValue
    }

    return 0
  })

  const termo = normalizarBusca(searchTerm)
  const casaBusca = (item: Item) =>
    termo === '' ||
    normalizarBusca(item.name).includes(termo) ||
    normalizarBusca(item.code).includes(termo)

  const filteredItems = sortedItems
    .filter(item => !hideZeroStock || getLocalQty(item) > 0)
    .filter(casaBusca)

  // ---- A comprar ----
  // Entra quem esta no ponto de ressuprimento (inclui Sem Estoque e Estoque
  // Baixo, que ficam abaixo dele). Estoque maximo = 2x a ultima compra (regra
  // do almox); sem compra lancada, estimado por 90 dias de consumo + minimo;
  // sem compra e sem consumo, fica em branco para o almox decidir.
  const DIAS_COBERTURA_ESTIMADA = 90
  const noPontoPedido = (item: Item) => {
    const sp = pontoRessuprimento(item)
    return sp > 0 && getLocalQty(item) <= sp
  }
  const linhasComprar = sortedItems
    .filter(casaBusca)
    .filter((item) => !soPontoPedido || noPontoPedido(item))
    .map((item) => {
      const atual = getLocalQty(item)
      const uc = ultimaCompraById.get(item.id) ?? null
      const cd = consumoDia(item)
      let maximo: number | null = null
      let base: 'compra' | 'consumo' | 'sem base' = 'sem base'
      if (uc && uc.qtd > 0) { maximo = uc.qtd * 2; base = 'compra' }
      else if (cd != null && cd > 0) { maximo = Math.ceil(cd * DIAS_COBERTURA_ESTIMADA + (item.min_stock || 0)); base = 'consumo' }
      const comprar = maximo == null ? null : Math.max(0, maximo - atual)
      return { item, atual, uc, cd, maximo, base, comprar, sp: pontoRessuprimento(item), pedido: noPontoPedido(item) }
    })
    .sort((a, b) => a.item.name.localeCompare(b.item.name, 'pt-BR'))
  const totalComprarNaoFiltrado = sortedItems.filter(noPontoPedido).length
  const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR')
  const textoMaximo = (l: typeof linhasComprar[number]) =>
    l.maximo == null ? 'sem base' : `${l.maximo}${l.base === 'consumo' ? ' (estimado)' : ''}`

  const exportarComprar = () => {
    const linhas = linhasComprar.map((l) => ({
      'Codigo': l.item.code ?? '',
      'Nome': l.item.name,
      'Unidade': l.item.unit ?? '',
      'Estoque atual': l.atual,
      'Consumo/semana': l.cd != null ? Math.round(l.cd * 7) : '',
      'Ponto de ressuprimento': l.sp,
      'Ultima compra (qtd)': l.uc ? l.uc.qtd : '',
      'Ultima compra (data)': l.uc ? dataCurta(l.uc.data) : '',
      'Estoque maximo': l.maximo ?? '',
      'Base do maximo': l.base === 'compra' ? '2x ultima compra' : l.base === 'consumo' ? `estimado: ${DIAS_COBERTURA_ESTIMADA} dias de consumo + minimo` : 'sem compra e sem consumo',
      'Qtd a comprar': l.comprar ?? '',
      'No ponto de pedido': l.pedido ? 'Sim' : 'Nao',
    }))
    const ws = XLSX.utils.json_to_sheet(linhas)
    ws['!cols'] = [{ wch: 20 }, { wch: 55 }, { wch: 8 }, { wch: 13 }, { wch: 14 }, { wch: 20 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 38 }, { wch: 13 }, { wch: 18 }]
    if (ws['!ref']) ws['!autofilter'] = { ref: ws['!ref'] }
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'A comprar')
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
    saveAs(new Blob([buf], { type: 'application/octet-stream' }), `almox_a_comprar_${hojeLocal()}.xlsx`)
  }

  const imprimirComprar = () => {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')
    const corpo = linhasComprar.map((l) => `<tr>
<td>${esc(l.item.code ?? '')}</td><td>${esc(l.item.name)}</td><td>${esc(l.item.unit ?? '')}</td>
<td class="n">${l.atual}</td><td class="n">${l.uc ? `${l.uc.qtd} <small>(${dataCurta(l.uc.data)})</small>` : '-'}</td>
<td class="n">${esc(textoMaximo(l))}</td><td class="n"><b>${l.comprar ?? '-'}</b></td><td>${l.pedido ? 'Sim' : ''}</td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Almoxarifado - A comprar</title>
<style>body{font-family:Arial,sans-serif;margin:24px;color:#111}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 14px;color:#555;font-size:12px}
table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #ccc;padding:6px}th{background:#f2f2f2;text-align:left}
td.n,th.n{text-align:right}small{color:#666}</style></head><body>
<h1>Almoxarifado HECC · ${soPontoPedido ? 'Itens no ponto de pedido' : 'Estoque máximo e compra'}</h1>
<p>Gerado em ${new Date().toLocaleString('pt-BR')} · ${linhasComprar.length} itens · Estoque máximo = 2x a última compra (estimado = ${DIAS_COBERTURA_ESTIMADA} dias de consumo + mínimo, quando não há compra lançada)</p>
<table><thead><tr><th>Código</th><th>Nome</th><th>Un.</th><th class="n">Estoque atual</th><th class="n">Última compra</th><th class="n">Estoque máximo</th><th class="n">Qtd a comprar</th><th>Ponto de pedido</th></tr></thead>
<tbody>${corpo}</tbody></table>
<script>window.onload=function(){window.print()}</script></body></html>`
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(html)
    w.document.close()
  }

  const zeroStockCount = sortedItems.filter(item => getLocalQty(item) === 0).length
  // L5: a lista abre com "ocultar zerados" ligado; quem busca um item zerado
  // via "nenhum item" e achava que o item nao existia. Conta os escondidos.
  const zeradosOcultosNaBusca = hideZeroStock && termo !== ''
    ? sortedItems.filter(item => getLocalQty(item) <= 0 && casaBusca(item)).length
    : 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando itens...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={loadItems}>Tentar Novamente</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
        {/* Header — mesmo padrao de pharmacy-items: SEMPRE coluna (titulo full-width,
            botoes em flex-wrap embaixo). 5 botoes + sidebar quebravam titulo em varias
            linhas entre 640-1280px com o antigo xl:flex-row. */}
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-purple-100 rounded-lg flex-shrink-0">
              <Package2 className="w-6 h-6 text-purple-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 leading-tight break-words">
                {locationName ? `Estoque — ${locationName}` : 'Itens do Almoxarifado'}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Gestão avançada do estoque de materiais
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowImportDialog(true)}
            >
              <FileSpreadsheet className="w-4 h-4 mr-2" />
              Importar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExport}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
            {/* Entrada e Saida aparecem tanto no almox central quanto no
                SAT_T (satelite de materiais) — cada um grava no seu proprio
                estoque via ?loc=<code>. "Novo Item" (cadastro) so no almox
                central, pq e catalogo unico compartilhado. */}
            {(() => {
              const locCode = locationId ? pharmacyStockById(locationId)?.code ?? 'ALMOX' : 'ALMOX'
              return (
                <>
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => navigate(`/inventory/warehouse/nf-entry?loc=${locCode}`)}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Nova Entrada
                  </Button>
                  <Button
                    className="bg-red-600 hover:bg-red-700 text-white"
                    onClick={() => navigate(`/inventory/warehouse/saida-lote?loc=${locCode}`)}
                  >
                    <PackageMinus className="w-4 h-4 mr-2" />
                    Registrar Saída
                  </Button>
                </>
              )
            })()}
            {!locationId && (
              <Button
                className="bg-primary-500 hover:bg-primary-600 text-white"
                onClick={() => setShowAddItemDialog(true)}
              >
                <Plus className="w-4 h-4 mr-2" />
                Novo Item
              </Button>
            )}
            <AdvancedFilters
              categories={categoriasReais}
              onFilterChange={setFilters}
              defaultFilters={filters}
            />
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center">
          <label className="flex items-center gap-2 text-sm text-gray-700 select-none whitespace-nowrap cursor-pointer">
            <input
              type="checkbox"
              checked={hideZeroStock}
              onChange={(e) => setHideZeroStock(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
            />
            Ocultar itens zerados
            {hideZeroStock && zeroStockCount > 0 && (
              <span className="text-xs text-gray-500">({zeroStockCount} ocultos)</span>
            )}
          </label>
          {(() => {
            // Valor do almox (pedido da Rafaela, 08/10): saldo x última compra;
            // item nunca comprado vale pelo valor referencial.
            const vu = (it: Item) => Number((it as any).last_purchase_price) || Number((it as any).reference_price) || Number(it.price) || 0
            let total = 0, comSaldo = 0, semValor = 0
            for (const it of items) {
              const q = getLocalQty(it)
              if (q <= 0) continue
              comSaldo++
              if (!vu(it)) semValor++
              total += q * vu(it)
            }
            return (
              <span className="text-sm rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1 text-emerald-900">
                Valor total do estoque: <strong>{total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</strong>
                <span className="text-xs text-emerald-800"> · {comSaldo} itens com saldo{semValor > 0 ? ` · ${semValor} sem valor` : ''}</span>
              </span>
            )
          })()}
        </div>

        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por nome, código..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {zeradosOcultosNaBusca > 0 && (
          <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-800">
            <span>
              {zeradosOcultosNaBusca} {zeradosOcultosNaBusca === 1 ? 'item zerado oculto' : 'itens zerados ocultos'} nesta busca
            </span>
            <Button variant="outline" size="sm" onClick={() => setHideZeroStock(false)}>
              Mostrar
            </Button>
          </div>
        )}
      </div>

      {/* Abas (so no almoxarifado central) */}
      {!locationId && (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={aba === 'todos' ? 'default' : 'outline'} size="sm" onClick={() => setAba('todos')}>
            <Package2 className="w-4 h-4 mr-2" />
            Todos os itens
          </Button>
          <Button variant={aba === 'comprar' ? 'default' : 'outline'} size="sm" onClick={() => setAba('comprar')}>
            <ShoppingCart className="w-4 h-4 mr-2" />
            A comprar ({totalComprarNaoFiltrado})
          </Button>
          {aba === 'comprar' && (
            <>
              <label className="flex items-center gap-2 text-sm text-gray-700 select-none cursor-pointer px-2">
                <input
                  type="checkbox"
                  checked={soPontoPedido}
                  onChange={(e) => setSoPontoPedido(e.target.checked)}
                  className="w-4 h-4 rounded border-gray-300 text-primary-500 focus:ring-primary-500"
                />
                Só no ponto de pedido
              </label>
              <Button variant="outline" size="sm" onClick={imprimirComprar} disabled={linhasComprar.length === 0}>
                <Printer className="w-4 h-4 mr-2" />
                Imprimir
              </Button>
              <Button variant="outline" size="sm" onClick={exportarComprar} disabled={linhasComprar.length === 0}>
                <Download className="w-4 h-4 mr-2" />
                Excel
              </Button>
            </>
          )}
        </div>
      )}

      {!locationId && aba === 'comprar' ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <p className="px-4 pt-4 text-xs text-gray-500">
            {linhasComprar.length} itens{soPontoPedido ? ' no ponto de pedido' : ''}. Estoque máximo = 2x a última compra. Sem compra lançada, o máximo é
            estimado por {DIAS_COBERTURA_ESTIMADA} dias de consumo + estoque mínimo. Sem compra e sem consumo, fica em branco.
          </p>
          <div className="overflow-x-scroll pb-1 min-w-0" style={{ scrollbarWidth: 'thin' }}>
            <table className="w-full border-collapse min-w-[1000px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {['Código', 'Nome', 'Unidade', 'Estoque Atual', 'Consumo/semana', 'Ponto de Ressuprimento', 'Última Compra', 'Estoque Máximo', 'Qtd a Comprar'].map((h, i) => (
                    <th key={h} className={`px-4 py-3 text-sm font-medium text-gray-600 ${i >= 3 ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {linhasComprar.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-500">Nenhum item encontrado.</td></tr>
                ) : linhasComprar.map((l) => (
                  <tr key={l.item.id} className={l.pedido ? 'bg-blue-50/40 hover:bg-blue-50' : 'hover:bg-gray-50'}>
                    <td className="px-4 py-3 text-sm text-gray-600">{l.item.code}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">
                      {l.item.name}
                      {l.pedido && <span className="ml-2 px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-600 border border-blue-200 whitespace-nowrap">Ponto de Pedido</span>}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">{l.item.unit}</td>
                    <td className="px-4 py-3 text-sm text-right font-medium">{l.atual}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{l.cd != null ? Math.round(l.cd * 7) : '—'}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">{l.sp}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {l.uc ? <>{l.uc.qtd} <span className="text-xs text-gray-400">({dataCurta(l.uc.data)})</span></> : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700">
                      {l.maximo == null
                        ? <span className="text-xs text-gray-400">sem base</span>
                        : <>{l.maximo}{l.base === 'consumo' && <span className="ml-1 text-xs text-amber-600">estimado</span>}</>}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-blue-700">{l.comprar ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
      /* Inventory Table — barra de rolagem sempre visivel embaixo. */
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-scroll pb-1 min-w-0" style={{ scrollbarWidth: 'thin' }}>
          <table className="w-full border-collapse min-w-[1200px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th 
                  className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('code')}
                >
                  <div className="flex items-center gap-2">
                    Código
                    {sortColumn === 'code' && (
                      <ArrowUpDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-2">
                    Nome
                    {sortColumn === 'name' && (
                      <ArrowUpDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-left text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('category')}
                >
                  <div className="flex items-center gap-2">
                    Categoria
                    {sortColumn === 'category' && (
                      <ArrowUpDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                  Unidade
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                  Lote
                </th>
                <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">
                  Validade
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                  Valor da Última Compra
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">
                  Valor Referencial
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600" title="Média semanal das saídas dos últimos 30 dias (ou valor informado no cadastro)">
                  Consumo/semana
                </th>
                <th 
                  className="px-4 py-3 text-right text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('current_stock')}
                >
                  <div className="flex items-center justify-end gap-2">
                    Estoque Atual
                    {sortColumn === 'current_stock' && (
                      <ArrowUpDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
                <th 
                  className="px-4 py-3 text-right text-sm font-medium text-gray-600 cursor-pointer hover:bg-gray-100"
                  onClick={() => handleSort('min_stock')}
                >
                  <div className="flex items-center justify-end gap-2">
                    Estoque Mínimo
                    {sortColumn === 'min_stock' && (
                      <ArrowUpDown className="w-4 h-4" />
                    )}
                  </div>
                </th>
                <th className="px-4 py-3 text-right text-sm font-medium text-gray-600" title="(consumo médio por dia × prazo de reposição em dias) + estoque mínimo">
                  Ponto de Ressuprimento
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                  Status
                </th>
                <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((item) => {
                const cd = consumoDia(item)              // un/dia (calc ou manual) ou null
                const supplyPoint = pontoRessuprimento(item) // número ou null
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm text-gray-600">{item.code}</td>
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{item.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{item.category}</td>
                    <td className="px-4 py-3 text-sm text-center text-gray-700 font-medium">{item.unit}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {(() => {
                        // Num satelite mostra os lotes DAQUELE local; no
                        // Almoxarifado segue o campo do cadastro, como antes.
                        if (!locationId && !lotesById.has(item.id)) return (item as any).batch_number || '-'
                        const ls = lotesById.get(item.id) ?? []
                        if (ls.length === 0) return '-'
                        if (ls.length > 1 && lotesAbertos.has(item.id)) {
                          const fmtV = (d: string | null) => (d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : 'sem validade')
                          return (
                            <div className="space-y-1">
                              {ls.map((l, i) => (
                                <div key={i} className="whitespace-nowrap text-xs">
                                  <span className="font-medium text-gray-800">{l.batch_number || 'sem lote'}</span>
                                  <span className="text-gray-500"> · {fmtV(l.expiry_date)} · {l.current_quantity}</span>
                                </div>
                              ))}
                              <button type="button" onClick={() => alternarLotes(item.id)} className="text-xs text-blue-600 hover:underline">fechar</button>
                            </div>
                          )
                        }
                        return (
                          <span>
                            {ls[0].batch_number || 'sem lote'}
                            {ls.length > 1 && (
                              <button
                                type="button"
                                onClick={() => alternarLotes(item.id)}
                                className="ml-1 px-1.5 rounded bg-blue-50 text-xs text-blue-600 border border-blue-200 hover:bg-blue-100"
                                title="Ver todos os lotes"
                              >
                                +{ls.length - 1}
                              </button>
                            )}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {(() => {
                        const fmt = (d: string | null) =>
                          d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '-'
                        if (!locationId && !lotesById.has(item.id)) return fmt(item.expiry_date ?? null)
                        const ls = lotesById.get(item.id) ?? []
                        return ls.length === 0 ? '-' : fmt(ls[0].expiry_date)
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {(item as any).last_purchase_price != null
                        ? Number((item as any).last_purchase_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {(item as any).reference_price != null
                        ? Number((item as any).reference_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                        : '-'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {/* Consumo SEMANAL = média diária × 7. Número inteiro +
                          unidade (igual às colunas de quantidade). O "/semana"
                          já está no cabeçalho da coluna. */}
                      {cd != null ? `${Math.round(cd * 7)} ${item.unit}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium">
                      {getLocalQty(item)} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {item.min_stock} {item.unit}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {supplyPoint} {item.unit}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        {(() => {
                          const q = getLocalQty(item)
                          if (q === 0)                             return <span className="px-2 py-1 text-xs font-medium rounded-full bg-red-50 text-red-600 border border-red-200">Sem Estoque</span>
                          if (q <= item.min_stock)                 return <span className="px-2 py-1 text-xs font-medium rounded-full bg-yellow-50 text-yellow-600 border border-yellow-200">Estoque Baixo</span>
                          if (supplyPoint > 0 && q <= supplyPoint) return <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-50 text-blue-600 border border-blue-200">Ponto de Pedido</span>
                          return                                        <span className="px-2 py-1 text-xs font-medium rounded-full bg-green-50 text-green-600 border border-green-200">Normal</span>
                        })()}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex justify-center">
                        <div className="flex items-center gap-1">
                          {canEdit && (
                            <Button variant="outline" size="sm" onClick={() => handleEditItem(item)} title="Editar item" className="text-amber-600 border-amber-200 hover:bg-amber-50 h-8 px-2">
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/inventory/warehouse/${item.id}`)} title="Ver detalhes" className="h-8 px-2">
                            <Eye className="w-4 h-4" />
                          </Button>
                          {isAdmin && (
                            <Button variant="outline" size="sm" onClick={() => handleDelete(item)} title="Excluir" className="text-red-600 border-red-200 hover:bg-red-50 h-8 px-2">
                              <Trash2 className="w-4 h-4" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      )}

      {/* Import Dialog */}
      <ImportDialog
        type="warehouse"
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={loadItems}
      />

      {/* Add Item Dialog */}
      <AddItemDialog
        type="warehouse"
        open={showAddItemDialog}
        onOpenChange={setShowAddItemDialog}
        onSuccess={loadItems}
      />

      {/* Edit Stock Dialog */}
      {selectedItem && (
        <EditStockDialog
          item={selectedItem}
          type="warehouse"
          open={showEditStockDialog}
          onOpenChange={setShowEditStockDialog}
          onSuccess={() => {
            loadItems()
            setSelectedItem(null)
          }}
        />
      )}

      {/* Delete Item Dialog */}
      {selectedItem && (
        <DeleteItemDialog
          item={selectedItem}
          type="warehouse"
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          onSuccess={() => {
            loadItems()
            setSelectedItem(null)
          }}
        />
      )}

      {/* Edit Item Dialog */}
      {selectedItem && (
        <EditItemDialog
          item={selectedItem}
          type="warehouse"
          // So o satelite (SAT_T) edita lote: ele tem saldo por local. O
          // almoxarifado central nao passa isto e segue sem o bloco de lotes.
          allowLotEdit={!!locationId}
          locationId={locationId}
          open={showEditItemDialog}
          onOpenChange={(open) => {
            setShowEditItemDialog(open)
            if (!open) setSelectedItem(null)
          }}
          onSuccess={() => {
            loadItems()
            setSelectedItem(null)
          }}
        />
      )}
    </div>
  )
}