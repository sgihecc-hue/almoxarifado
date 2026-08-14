import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Download, AlertCircle,
  Loader2, ArrowUpDown, Pill, FileSpreadsheet, FileText,
  Eye, Plus, Edit, Trash2, PackageMinus, X, Layers
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { itemsService } from '@/lib/services/items'
import { stockService } from '@/lib/services/stock'
import { supabase } from '@/lib/supabase'
import type { ItemStockWithLocation } from '@/lib/types/stock'

interface LotRow {
  batch_number: string
  expiry_date: string | null
  current_quantity: number
}
import { AdvancedFilters } from '@/components/inventory/advanced-filters'
import { EditStockDialog } from '@/components/inventory/edit-stock-dialog'
import { DeleteItemDialog } from '@/components/inventory/delete-item-dialog'
import { EditItemDialog } from '@/components/inventory/edit-item-dialog'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import type { Item, FilterOptions } from '@/lib/services/items'
import { ImportDialog } from '@/components/inventory/import-dialog'
import { AddItemDialog } from '@/components/inventory/add-item-dialog'

interface PharmacyItemsProps {
  locationId?: string
  locationName?: string
}

export function PharmacyItems({ locationId, locationName }: PharmacyItemsProps = {}) {
  const { user } = useAuth()
  const { activeStock } = useModule()
  const navigate = useNavigate()
  // Local efetivo para filtrar os lotes: a prop da rota /inventory/stock/:id,
  // OU o estoque ativo do contexto quando a tela é aberta pela rota /inventory
  // (sem prop). Sem esse fallback, a rota sem prop listava os lotes de TODOS os
  // locais — e o dropdown de lote mostrava os lotes/saldos da CAF mesmo o
  // usuário estando num satélite (bug reportado). O activeStock.id é o mesmo
  // uuid de stock_locations usado em expiry_tracking.location_id.
  const effectiveLocationId = locationId ?? activeStock?.id
  // SAT_T é estoque de MATERIAL (warehouse), não medicamento. Quando o estoque
  // ativo é warehouse, a tela lê o catálogo de material e o saldo de material.
  const isWarehouseStock = activeStock?.itemType === 'warehouse'
  const catalogItemType: 'pharmacy' | 'warehouse' = isWarehouseStock ? 'warehouse' : 'pharmacy'
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
  // Removidos os checkboxes "Ocultar zerados" e "Ocultar sem lote/validade":
  // vinham marcados por padrão e escondiam itens que o usuário precisava ver.
  // Agora a tela sempre mostra TODOS os itens.
  const [showEditItemDialog, setShowEditItemDialog] = useState(false)
  // Modal de lotes do item
  const [lotModalItem, setLotModalItem] = useState<Item | null>(null)
  // Saldos por local (CAF, SAT_1, SAT_2, SAT_T) carregados em uma chamada.
  // Map<itemId, Map<locationCode, quantity>>
  const [stocksByItem, setStocksByItem] = useState<Map<string, Record<string, number>>>(new Map())
  // Local/prateleira por item x local. Map<itemId, Record<locationCode, shelf>>
  const [shelfByItem, setShelfByItem] = useState<Map<string, Record<string, string>>>(new Map())
  // Lotes ativos por item, ordenados por validade (FEFO).
  const [lotsByItem, setLotsByItem] = useState<Map<string, LotRow[]>>(new Map())
  // Índice do lote selecionado por item (default 0 = FEFO). Quando o usuário
  // troca o lote no dropdown, a coluna Validade atualiza pra refletir esse lote.
  const [selectedLotByItem, setSelectedLotByItem] = useState<Map<string, number>>(new Map())

  const handleEditItem = (item: Item) => {
    setSelectedItem(item)
    setShowEditItemDialog(true)
  }

  const canEdit = user?.role === 'administrador' || user?.role === 'gestor'
  // Operadores da farmácia podem editar o Local/prateleira do item no estoque
  // ativo (atendente e farmacêutico, além de gestor/admin). Igual à RLS de
  // UPDATE de item_stocks.
  const canEditLocal = ['administrador', 'admin', 'gestor', 'atendente', 'pharmacist'].includes(user?.role ?? '')

  // Local/prateleira do item NO ESTOQUE ATIVO.
  const getShelf = (item: Item): string => {
    if (!activeStock) return ''
    return shelfByItem.get(item.id)?.[activeStock.code] ?? ''
  }

  // Grava o Local do item no estoque ativo (upsert em item_stocks — mexe só no
  // shelf_location, nunca na quantidade). Atualiza o estado local na hora.
  async function salvarShelf(item: Item, valor: string) {
    if (!activeStock) return
    const novo = valor.trim()
    const atual = getShelf(item)
    if (novo === atual) return
    // Otimista: reflete já na tela.
    setShelfByItem((prev) => {
      const next = new Map(prev)
      const sb = { ...(next.get(item.id) ?? {}) }
      if (novo) sb[activeStock.code] = novo
      else delete sb[activeStock.code]
      next.set(item.id, sb)
      return next
    })
    const { error } = await supabase
      .from('item_stocks')
      .upsert(
        {
          item_id: item.id,
          item_type: 'pharmacy',
          location_id: activeStock.id,
          shelf_location: novo || null,
        },
        { onConflict: 'item_id,item_type,location_id' }
      )
    if (error) console.error('salvarShelf', error)
  }

  // Saldo do item NO ESTOQUE ATIVO (CAF/SAT_1/SAT_2/SAT_T).
  // Cada satelite tem o seu proprio saldo em item_stocks; a coluna
  // "current_stock" da tabela pharmacy_items eh o total global fossilizado
  // no cadastro do item e nao serve pra visao multi-estoque.
  const getLocalQty = (item: Item): number => {
    if (!activeStock) return item.current_stock ?? 0
    const bucket = stocksByItem.get(item.id) ?? {}
    return bucket[activeStock.code] ?? 0
  }

  useEffect(() => {
    // Recarrega ao trocar de estoque: os lotes são filtrados por local.
    loadItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveLocationId])

  async function loadItems() {
    try {
      setLoading(true)
      setError(null)
      // Carrega itens, saldos por local e lotes ativos em paralelo
      const [pharmacyItems, allStocks, allLots] = await Promise.all([
        // Sem filtros aqui de propósito: eles são aplicados no cliente, sobre o
        // saldo do LOCAL (ver filteredItems). Passá-los aqui filtraria pelo
        // estoque global do cadastro e divergiria do que a tela mostra.
        // SAT_T (warehouse) lê o catálogo de material; os demais, medicamento.
        itemsService.getByType(catalogItemType),
        loadAllPharmacyStocks(),
        loadAllLots(),
      ])

      setItems(pharmacyItems)
      setStocksByItem(allStocks)
      setLotsByItem(allLots)
    } catch (error) {
      console.error('Error loading items:', error)
      setError('Erro ao carregar itens. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  // Busca saldo de todos os itens de farmacia em todos os locais e agrupa por item_id.
  async function loadAllPharmacyStocks(): Promise<Map<string, Record<string, number>>> {
    try {
      // Lista os locais ativos uma vez (com cache no service) e depois busca todos
      // os saldos de cada local de uma so vez (paginacao 1k linhas eh suficiente).
      const locations = await stockService.getLocations()
      const result = new Map<string, Record<string, number>>()

      // Faz uma query por local. Sao 5 locais no maximo => 5 round-trips paralelos.
      const perLocation = await Promise.all(
        locations.map(async (loc) => {
          const rows = await stockService.getStocksByLocation(loc.id, catalogItemType)
          return { code: loc.code, rows }
        })
      )

      const shelves = new Map<string, Record<string, string>>()
      for (const { code, rows } of perLocation) {
        for (const r of rows as ItemStockWithLocation[]) {
          const bucket = result.get(r.item_id) ?? {}
          bucket[code] = r.quantity
          result.set(r.item_id, bucket)
          if (r.shelf_location) {
            const sb = shelves.get(r.item_id) ?? {}
            sb[code] = r.shelf_location
            shelves.set(r.item_id, sb)
          }
        }
      }
      setShelfByItem(shelves)
      return result
    } catch (e) {
      console.error('loadAllPharmacyStocks failed (continuando sem saldos por local):', e)
      return new Map()
    }
  }

  // Busca os lotes ativos (saldo > 0) DESTE LOCAL e agrupa por item_id,
  // ordenados por validade (FEFO).
  //
  // FA4: o filtro por location_id é essencial. Sem ele a tela do Satélite
  // mostrava o lote/validade de um lote que está no CAF, mesmo com o item
  // zerado no satélite — dando a impressão de que havia lote ali.
  // Sem locationId (visão geral de farmácia, fora de um estoque específico)
  // continua listando os lotes de todos os locais.
  async function loadAllLots(): Promise<Map<string, LotRow[]>> {
    try {
      const result = new Map<string, LotRow[]>()
      // Material (SAT_T/warehouse) não tem lote/validade — sai sem lotes.
      if (isWarehouseStock) return result
      // Paginação simples — 5000 lotes deve ser suficiente para o estoque atual.
      let query = supabase
        .from('expiry_tracking')
        .select('item_id, batch_number, expiry_date, current_quantity')
        .gt('current_quantity', 0)
        .order('expiry_date', { ascending: true, nullsFirst: false })
        .limit(5000)
      if (effectiveLocationId) query = query.eq('location_id', effectiveLocationId)
      const { data, error } = await query
      if (error) throw error
      for (const row of (data || []) as Array<LotRow & { item_id: string }>) {
        const list = result.get(row.item_id) ?? []
        list.push({
          batch_number: row.batch_number,
          expiry_date: row.expiry_date,
          current_quantity: row.current_quantity,
        })
        result.set(row.item_id, list)
      }
      return result
    } catch (e) {
      console.error('loadAllLots failed (continuando sem lotes):', e)
      return new Map()
    }
  }

  const handleExport = async () => {
    try {
      await itemsService.exportToExcel(
        filteredItems,
        `itens_farmacia_${new Date().toISOString().split('T')[0]}`
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

  const handleSort = (column: string) => {
    if (sortColumn === column) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortColumn(column)
      setSortDirection('asc')
    }
  }

  const sortedItems = [...items].sort((a, b) => {
    if (!sortColumn) return 0

    const aValue = a[sortColumn as keyof Item]
    const bValue = b[sortColumn as keyof Item]

    if (typeof aValue === 'string' && typeof bValue === 'string') {
      return sortDirection === 'asc' 
        ? aValue.localeCompare(bValue)
        : bValue.localeCompare(aValue)
    }

    if (typeof aValue === 'number' && typeof bValue === 'number') {
      return sortDirection === 'asc' 
        ? aValue - bValue
        : bValue - aValue
    }

    return 0
  })

  // Consumo médio mensal: o valor INFORMADO no cadastro tem prioridade; sem
  // ele, cai na média do histórico (comportamento anterior).
  const consumoMensal = (item: Item): number => {
    const informado = item.avg_monthly_consumption
    if (informado !== undefined && informado !== null && !Number.isNaN(informado)) {
      return Number(informado)
    }
    const history = Array.isArray(item.consumption_history) ? item.consumption_history : []
    return history.length
      ? history.reduce((acc, curr) => acc + (curr?.quantity || 0), 0) / history.length
      : 0
  }

  // Ponto de pedido — mesma conta usada na coluna "Pto. Sup." da tabela.
  // Fica aqui (e não solto no map) pra o filtro e a tabela nunca divergirem.
  const pontoDePedido = (item: Item): number =>
    Math.ceil((consumoMensal(item) / 30) * (item.lead_time_days || 7) * 1.5)

  // Status do item no LOCAL atual — mesma regra do badge da coluna Status,
  // pra o filtro casar exatamente com o que aparece na tela.
  const statusLocal = (item: Item): 'out' | 'low' | 'critical' | 'normal' => {
    const qty = getLocalQty(item)
    if (qty === 0) return 'out'
    if (qty <= (item.min_stock ?? 0)) return 'low'
    if (qty <= pontoDePedido(item)) return 'critical' // Ponto de Pedido
    return 'normal'
  }

  // Os filtros são aplicados AQUI (no cliente) e não na consulta ao banco.
  // Motivo: a consulta filtrava por pharmacy_items.current_stock /
  // reorder_status, que são os valores GLOBAIS do cadastro — mas a tela mostra
  // o saldo POR LOCAL (item_stocks). Filtrar no servidor escondia/mostrava
  // itens com base num número diferente do exibido. Além disso, o loadItems só
  // rodava ao trocar de local, então mexer no filtro não refazia a busca — por
  // isso "os filtros não filtravam".
  const filteredItems = sortedItems
    .filter(item =>
      searchTerm === '' ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.code?.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .filter(item => !filters.categories?.length || filters.categories.includes(item.category))
    .filter(item => !filters.status?.length || filters.status.includes(statusLocal(item)))
    .filter(item => filters.minStock === undefined || getLocalQty(item) >= filters.minStock)
    .filter(item => filters.maxStock === undefined || getLocalQty(item) <= filters.maxStock)

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
      {/* Header — SEMPRE empilhado: titulo em cima full-width, botoes abaixo
          com flex-wrap. Nao usa flex-row porque comprimiam titulo em telas
          medias e o CAF ficava quebrado em varias linhas ("desconfigurado"). */}
      <div className="bg-white p-4 sm:p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 rounded-lg flex-shrink-0">
              <Pill className="w-6 h-6 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h1 className="text-lg sm:text-xl md:text-2xl font-bold text-gray-900 leading-tight break-words">
                {locationName ? `Estoque — ${locationName}` : 'Itens da Farmácia'}
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                {isWarehouseStock ? 'Gestão do estoque de materiais' : 'Gestão avançada do estoque farmacêutico'}
              </p>
            </div>
          </div>
          {/* Barra de botoes — ocupa linha inteira abaixo do titulo,
              wrapa naturalmente em telas menores */}
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
            {/* Entrada e Saida agora aparecem em TODOS os estoques (CAF +
                satelites) e passam ?loc=<code> pra o form gravar no estoque
                CORRETO — antes iam sempre pra CAF, gerando erro reportado.
                O cadastro (catalogo) continua so no CAF, pq e um catalogo
                unico compartilhado por todos os estoques. */}
            {activeStock && (
              <>
                {/* "Nova Entrada" só no CAF: as entradas (compra/inventário)
                    entram pelo CAF, que é a central de abastecimento. Os
                    satélites recebem por solicitação/transferência, não por
                    entrada direta. */}
                {activeStock.code === 'CAF' && (
                  <Button
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                    onClick={() => navigate(`/inventory/pharmacy/nf-entry?loc=${activeStock.code}`)}
                  >
                    <FileText className="w-4 h-4 mr-2" />
                    Nova Entrada
                  </Button>
                )}
                <Button
                  className="bg-red-600 hover:bg-red-700 text-white"
                  onClick={() => navigate(`/inventory/pharmacy/saida-lote?loc=${activeStock.code}`)}
                >
                  <PackageMinus className="w-4 h-4 mr-2" />
                  Registrar Saída
                </Button>
              </>
            )}
            {activeStock?.code === 'CAF' && (
              <Button
                variant="outline"
                onClick={() => navigate('/farmacia/catalogo')}
              >
                <Plus className="w-4 h-4 mr-2" />
                Cadastro
              </Button>
            )}
            <AdvancedFilters
              categories={['Medicamentos', 'Material Hospitalar']}
              onFilterChange={setFilters}
              defaultFilters={filters}
            />
          </div>
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
      </div>

      {/* Inventory Table — barra de rolagem sempre visivel embaixo, pra o
          usuario perceber que da pra rolar horizontal (a tabela tem ~15
          colunas e nao cabe em telas medias). */}
      {/* Barra de rolagem horizontal visivel (a tabela tem ~15 colunas e nao
          cabe na tela). Escopado na classe pra nao afetar outras telas. */}
      <style>{`
        .tabela-scroll-x { scrollbar-width: auto; scrollbar-color: rgba(71,85,105,0.7) rgba(100,116,139,0.15); }
        .tabela-scroll-x::-webkit-scrollbar { height: 14px; }
        .tabela-scroll-x::-webkit-scrollbar-track { background: rgba(100,116,139,0.15); border-radius: 7px; }
        .tabela-scroll-x::-webkit-scrollbar-thumb { background: rgba(71,85,105,0.7); border-radius: 7px; border: 3px solid transparent; background-clip: padding-box; }
        .tabela-scroll-x::-webkit-scrollbar-thumb:hover { background: rgba(51,65,85,0.9); background-clip: padding-box; }
      `}</style>
      {/* overflow-hidden no pai cortava a barra de rolagem do filho — por isso
          ela nao aparecia. Sem ele, a barra fica visivel embaixo da tabela. */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <div className="overflow-x-scroll pb-1 min-w-0 tabela-scroll-x">
          <table className="w-full border-collapse min-w-[1400px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th
                  className="px-2 py-2 text-left text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  onClick={() => handleSort('code')}
                >
                  <div className="flex items-center gap-1">
                    Código
                    {sortColumn === 'code' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-left text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  onClick={() => handleSort('name')}
                >
                  <div className="flex items-center gap-1">
                    Nome
                    {sortColumn === 'name' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th
                  className="px-2 py-2 text-left text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  onClick={() => handleSort('category')}
                >
                  <div className="flex items-center gap-1">
                    Categoria
                    {sortColumn === 'category' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600 whitespace-nowrap">
                  Unidade
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600 whitespace-nowrap" title="Localização física (prateleira/seção) neste estoque">
                  Local
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600 whitespace-nowrap">
                  Lote
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600 whitespace-nowrap">
                  Validade
                </th>
                <th className="px-2 py-2 text-right text-xs font-medium text-gray-600 whitespace-nowrap">
                  Última Compra
                </th>
                <th className="px-2 py-2 text-right text-xs font-medium text-gray-600 whitespace-nowrap">
                  Valor Ref.
                </th>
                <th className="px-2 py-2 text-right text-xs font-medium text-gray-600 whitespace-nowrap">
                  Consumo
                </th>
                <th
                  className="px-2 py-2 text-right text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  onClick={() => handleSort('current_stock')}
                  title={activeStock ? `Saldo no ${activeStock.name}` : 'Saldo global'}
                >
                  <div className="flex items-center justify-end gap-1">
                    Estoque {activeStock?.label ?? ''}
                    {sortColumn === 'current_stock' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th className="px-2 py-2 text-left text-xs font-medium text-gray-600 whitespace-nowrap" title="Saldo nos outros estoques da farmacia">
                  Outros estoques
                </th>
                <th
                  className="px-2 py-2 text-right text-xs font-medium text-gray-600 cursor-pointer hover:bg-gray-100 whitespace-nowrap"
                  onClick={() => handleSort('min_stock')}
                >
                  <div className="flex items-center justify-end gap-1">
                    Mín.
                    {sortColumn === 'min_stock' && (
                      <ArrowUpDown className="w-3 h-3" />
                    )}
                  </div>
                </th>
                <th className="px-2 py-2 text-right text-xs font-medium text-gray-600 whitespace-nowrap">
                  Pto. Sup.
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600 whitespace-nowrap">
                  Status
                </th>
                <th className="px-2 py-2 text-center text-xs font-medium text-gray-600 whitespace-nowrap">
                  Ações
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredItems.map((item) => {
                // Usa o consumo informado no cadastro quando existir; senão, a
                // média do histórico. Mesma função do filtro, pra não divergir.
                const avgConsumption = consumoMensal(item)
                const supplyPoint = pontoDePedido(item)
                
                return (
                  <tr key={item.id} className="hover:bg-gray-50">
                    <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">{item.code}</td>
                    <td className="px-2 py-2 text-sm font-medium text-gray-900">{item.name}</td>
                    <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">{item.category}</td>
                    <td className="px-2 py-2 text-xs text-center text-gray-700 font-medium">{item.unit}</td>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">
                      {!activeStock ? (
                        <span className="text-gray-300">—</span>
                      ) : canEditLocal ? (
                        <input
                          key={`${item.id}-${activeStock.code}-${getShelf(item)}`}
                          type="text"
                          defaultValue={getShelf(item)}
                          placeholder="—"
                          title="Local/prateleira neste estoque"
                          className="w-24 px-1.5 py-0.5 text-xs border border-transparent rounded hover:border-gray-200 focus:border-blue-400 focus:bg-white focus:outline-none bg-transparent"
                          onBlur={(e) => salvarShelf(item, e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                        />
                      ) : (
                        <span className="text-gray-600">{getShelf(item) || '—'}</span>
                      )}
                    </td>
                    {(() => {
                      // Lote selecionado (default FEFO = índice 0). Se houver
                      // múltiplos lotes, exibe um dropdown que permite trocar; a
                      // coluna Validade acompanha o lote escolhido.
                      const lots = lotsByItem.get(item.id) ?? []
                      const selectedIdx = selectedLotByItem.get(item.id) ?? 0
                      const currentLot = lots[selectedIdx] ?? lots[0]
                      // SEM fallback para item.batch_number/item.expiry_date:
                      // esses campos legados do item guardam o último lote já
                      // usado e continuavam sendo exibidos mesmo com o item
                      // zerado (sem nenhum lote com saldo neste local), dando a
                      // impressão de que havia lote. Item zerado agora mostra "—".
                      const batchDisplay = currentLot?.batch_number || '—'
                      const expiryDisplay = currentLot?.expiry_date || null
                      return (
                        <>
                          <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">
                            {lots.length > 1 ? (
                              <select
                                value={selectedIdx}
                                onChange={(e) => {
                                  const idx = Number(e.target.value)
                                  setSelectedLotByItem((prev) => {
                                    const next = new Map(prev)
                                    next.set(item.id, idx)
                                    return next
                                  })
                                }}
                                onClick={(e) => e.stopPropagation()}
                                className="h-7 px-1.5 py-0 text-xs font-medium bg-white border border-emerald-200 rounded hover:border-emerald-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 cursor-pointer"
                                title={`${lots.length} lotes disponíveis — troque pra ver a validade correspondente`}
                              >
                                {lots.map((l, idx) => (
                                  <option key={`${l.batch_number}-${idx}`} value={idx}>
                                    {idx === 0 ? '★ ' : ''}{l.batch_number}
                                    {l.current_quantity ? ` (${l.current_quantity})` : ''}
                                  </option>
                                ))}
                              </select>
                            ) : (
                              <span className="font-medium">{batchDisplay}</span>
                            )}
                          </td>
                          <td className="px-2 py-2 text-xs text-gray-600 whitespace-nowrap">
                            {expiryDisplay ? new Date(expiryDisplay + 'T00:00:00').toLocaleDateString('pt-BR') : '-'}
                          </td>
                        </>
                      )
                    })()}
                    <td className="px-2 py-2 text-xs text-right text-gray-600 whitespace-nowrap">
                      {(item as any).last_purchase_price != null
                        ? Number((item as any).last_purchase_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                        : '-'}
                    </td>
                    <td className="px-2 py-2 text-xs text-right text-gray-600 whitespace-nowrap">
                      {(item as any).reference_price != null
                        ? Number((item as any).reference_price).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
                        : '-'}
                    </td>
                    <td className="px-2 py-2 text-xs text-right text-gray-600 whitespace-nowrap">
                      {Math.round(avgConsumption)} {item.unit}/mês
                    </td>
                    <td className="px-2 py-2 text-sm text-right font-medium whitespace-nowrap">
                      <button
                        onClick={() => setLotModalItem(item)}
                        className="inline-flex items-center gap-1 hover:text-blue-600 hover:underline cursor-pointer"
                        title="Ver lotes disponíveis"
                      >
                        {getLocalQty(item)} {item.unit}
                        {(lotsByItem.get(item.id) ?? []).length > 0 && (
                          <Layers className="w-3 h-3 text-blue-400" />
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-2">
                      {(() => {
                        const bucket = stocksByItem.get(item.id) ?? {}
                        // Mostra os outros estoques da farmacia (exclui o local ativo — esse ja
                        // aparece na coluna principal). Sao 4 locais possiveis (CAF/SAT_1/SAT_2/SAT_T).
                        const OTHERS: Array<{ code: string; label: string }> = [
                          { code: 'CAF',   label: 'CAF' },
                          { code: 'SAT_1', label: 'S1'  },
                          { code: 'SAT_2', label: 'S2'  },
                          { code: 'SAT_T', label: 'ST'  },
                        ]
                        const list = OTHERS.filter((o) => o.code !== activeStock?.code)
                        const chip = (label: string, value: number) => (
                          <span
                            key={label}
                            className={`inline-flex items-center gap-0.5 px-1.5 py-0 text-[10px] rounded border whitespace-nowrap ${
                              value > 0
                                ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                                : 'bg-gray-50 border-gray-200 text-gray-400'
                            }`}
                            title={`${label}: ${value} ${item.unit}`}
                          >
                            <span className="font-medium">{label}</span>
                            <span>{value}</span>
                          </span>
                        )
                        return (
                          <div className="flex flex-wrap gap-0.5 justify-start">
                            {list.map((o) => chip(o.label, bucket[o.code] ?? 0))}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="px-2 py-2 text-xs text-right text-gray-600 whitespace-nowrap">
                      {item.min_stock} {item.unit}
                    </td>
                    <td className="px-2 py-2 text-xs text-right text-gray-600 whitespace-nowrap">
                      {supplyPoint} {item.unit}
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-center">
                        {(() => {
                          const localQty = getLocalQty(item)
                          if (localQty === 0)                     return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-red-50 text-red-600 border border-red-200 whitespace-nowrap">Sem Estoque</span>
                          if (localQty <= item.min_stock)         return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-yellow-50 text-yellow-600 border border-yellow-200 whitespace-nowrap">Estoque Baixo</span>
                          if (localQty <= supplyPoint)            return <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-blue-50 text-blue-600 border border-blue-200 whitespace-nowrap">Ponto Pedido</span>
                          return                                          <span className="px-2 py-0.5 text-[10px] font-medium rounded-full bg-green-50 text-green-600 border border-green-200">Normal</span>
                        })()}
                      </div>
                    </td>
                    <td className="px-2 py-2">
                      <div className="flex justify-center">
                        <div className="flex items-center gap-1">
                          {canEdit && (
                            <Button variant="outline" size="sm" onClick={() => handleEditItem(item)} title="Editar item" className="text-amber-600 border-amber-200 hover:bg-amber-50 h-8 px-2">
                              <Edit className="w-4 h-4" />
                            </Button>
                          )}
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/inventory/pharmacy/${item.id}`)} title="Ver detalhes" className="h-8 px-2">
                            <Eye className="w-4 h-4" />
                          </Button>
                          {canEdit && (
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

      {/* Import Dialog */}
      <ImportDialog
        type="pharmacy"
        open={showImportDialog}
        onOpenChange={setShowImportDialog}
        onSuccess={loadItems}
      />

      {/* Add Item Dialog */}
      <AddItemDialog
        type="pharmacy"
        open={showAddItemDialog}
        onOpenChange={setShowAddItemDialog}
        onSuccess={loadItems}
      />

      {/* Edit Stock Dialog */}
      {selectedItem && (
        <EditStockDialog
          item={selectedItem}
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
          type="pharmacy"
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
          type="pharmacy"
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

      {/* Lot detail modal */}
      {lotModalItem && (() => {
        const lots = lotsByItem.get(lotModalItem.id) ?? []
        const today = Date.now()
        function expiryBand(d: string | null): { bg: string; text: string; label: string } {
          if (!d) return { bg: '#f9fafb', text: '#6b7280', label: '—' }
          const days = Math.floor((new Date(d + 'T00:00:00').getTime() - today) / 86400000)
          if (days < 0) return { bg: '#fef2f2', text: '#dc2626', label: 'Vencido' }
          if (days <= 30) return { bg: '#fef2f2', text: '#dc2626', label: `${days}d` }
          if (days <= 90) return { bg: '#fffbeb', text: '#d97706', label: `${days}d` }
          return { bg: '#f0fdf4', text: '#16a34a', label: `${days}d` }
        }
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.55)' }}
            onClick={() => setLotModalItem(null)}
          >
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100">
                <div>
                  <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                    <Layers className="w-4 h-4 text-blue-500" />
                    Lotes — {lotModalItem.name}
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {/* Saldo DO LOCAL (item_stocks), não o current_stock global
                        do cadastro — este último mostrava, por exemplo, "-1 Un"
                        no Satélite enquanto a linha da tabela exibia "1 Un". */}
                    Estoque{activeStock ? ` no ${activeStock.label}` : ' total'}:{' '}
                    <strong>{getLocalQty(lotModalItem)} {lotModalItem.unit}</strong> · {lots.length} lote(s) rastreado(s)
                  </p>
                </div>
                <button
                  onClick={() => setLotModalItem(null)}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-500"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="overflow-y-auto max-h-80 px-5 py-3 space-y-2">
                {lots.length === 0 ? (
                  <p className="text-sm text-gray-500 py-4 text-center">Nenhum lote rastreado para este item.</p>
                ) : (
                  lots.map((lot, idx) => {
                    const band = expiryBand(lot.expiry_date)
                    return (
                      <div
                        key={`${lot.batch_number}-${idx}`}
                        className="flex items-center justify-between gap-3 p-3 rounded-xl border text-sm"
                        style={{ background: band.bg, borderColor: band.bg === '#f9fafb' ? '#e5e7eb' : band.bg }}
                      >
                        <div className="flex items-center gap-2">
                          {idx === 0 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold">FEFO</span>
                          )}
                          <span className="font-semibold text-gray-900">Lote {lot.batch_number}</span>
                        </div>
                        <div className="flex items-center gap-4 text-xs">
                          <span className="text-gray-600">
                            Val.: {lot.expiry_date ? new Date(lot.expiry_date + 'T00:00:00').toLocaleDateString('pt-BR') : '—'}
                          </span>
                          <span className="font-medium px-2 py-0.5 rounded-full" style={{ color: band.text, background: band.bg === '#f9fafb' ? '#f3f4f6' : undefined }}>
                            {band.label}
                          </span>
                          <span className="font-bold text-gray-800">{lot.current_quantity} {lotModalItem.unit}</span>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>
              <div className="px-5 py-3 border-t border-gray-100 flex justify-end">
                <Button size="sm" variant="outline" onClick={() => setLotModalItem(null)}>Fechar</Button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}