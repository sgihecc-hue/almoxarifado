import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search, Download, AlertCircle,
  Loader2, ArrowUpDown, Package2, FileSpreadsheet, FileText,
  Eye, Plus, Edit, Trash2, PackageMinus
} from 'lucide-react'
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

  const handleEditItem = (item: Item) => {
    setSelectedItem(item)
    setShowEditItemDialog(true)
  }

  const isAdmin = user?.role === 'administrador'
  const canEdit = user?.role === 'administrador' || user?.role === 'gestor'

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
        const { data: lotes, error: lotesErr } = await supabase
          .from('expiry_tracking')
          .select('item_id, batch_number, expiry_date, current_quantity')
          .eq('location_id', locationId)
          .order('expiry_date', { ascending: true, nullsFirst: false })
        if (lotesErr) throw lotesErr
        const mapa = new Map<string, LoteLocal[]>()
        for (const l of (lotes ?? []) as any[]) {
          const lista = mapa.get(l.item_id) ?? []
          lista.push({ batch_number: l.batch_number, expiry_date: l.expiry_date, current_quantity: l.current_quantity })
          mapa.set(l.item_id, lista)
        }
        setLotesById(mapa)
      } else {
        setLocalQtyById(new Map())
        setLotesById(new Map())
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
      await itemsService.exportToExcel(
        filteredItems,
        `itens_almoxarifado_${new Date().toISOString().split('T')[0]}`
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

  const filteredItems = sortedItems
    .filter(item => !hideZeroStock || getLocalQty(item) > 0)
    .filter(item =>
      searchTerm === '' ||
      item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.code?.toLowerCase().includes(searchTerm.toLowerCase())
    )

  const zeroStockCount = sortedItems.filter(item => getLocalQty(item) === 0).length

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
              categories={[
                'Material de Escritório',
                'Material de Limpeza',
                'Equipamentos',
                'Outros'
              ]}
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

      {/* Inventory Table — barra de rolagem sempre visivel embaixo. */}
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
                        if (!locationId) return (item as any).batch_number || '-'
                        const ls = lotesById.get(item.id) ?? []
                        if (ls.length === 0) return '-'
                        return (
                          <span title={ls.map((l) => `${l.batch_number || 'sem lote'} — ${l.current_quantity}`).join(', ')}>
                            {ls[0].batch_number || 'sem lote'}
                            {ls.length > 1 && (
                              <span className="ml-1 text-xs text-gray-400">+{ls.length - 1}</span>
                            )}
                          </span>
                        )
                      })()}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {(() => {
                        const fmt = (d: string | null) =>
                          d ? new Date(d + 'T00:00:00').toLocaleDateString('pt-BR') : '-'
                        if (!locationId) return fmt(item.expiry_date ?? null)
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