import { useState, useEffect } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import {
  ArrowLeft, Package2, Pill, Plus, History,
  TrendingUp, TrendingDown, AlertTriangle,
  Loader2, CheckCircle2, Settings, Edit
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { itemsService } from '@/lib/services/items'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import type { Item } from '@/lib/services/items'
import { formatRequestNumber } from '@/lib/utils/request'
import { StockConfigDialog } from './components/stock-config-dialog'
import { EditStockDialog } from '@/components/inventory/edit-stock-dialog'
import { AddStockDialog } from '@/components/inventory/add-stock-dialog'

interface StockEntry {
  id: string
  quantity: number
  type: 'addition' | 'request'
  description: string
  created_by: string
  created_at: string
  reference_id?: string
  batch_number?: string
  expiry_date?: string
  supplier?: string
  unit_price?: number
  status?: string
  invoice_number?: string
  invoice_date?: string
  delivery_date?: string
  afm_number?: string
  supplier_cnpj?: string
  supplier_name?: string
  invoice_total_value?: number
}

export function ItemDetails() {
  const { id } = useParams<{ id: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const [item, setItem] = useState<Item | null>(null)
  const [loading, setLoading] = useState(true)
  const [stockHistory, setStockHistory] = useState<StockEntry[]>([])
  const [showAddStockDialog, setShowAddStockDialog] = useState(false)
  const [showConfigDialog, setShowConfigDialog] = useState(false)
  const [showEditStockDialog, setShowEditStockDialog] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const type = location.pathname.includes('/pharmacy') ? 'pharmacy' : 'warehouse'

  const isAdmin = user?.role === 'administrador'
  const isWarehouse = type === 'warehouse'

  useEffect(() => {
    if (id) {
      loadItem()
      loadStockHistory()
    }
  }, [id, type])

  async function loadItem() {
    try {
      if (!id) return
      setLoading(true)
      setError(null)
      const data = await itemsService.getById(id, type)
      setItem(data)
    } catch (error) {
      console.error('Error loading item:', error)
      setError('Erro ao carregar item')
    } finally {
      setLoading(false)
    }
  }

  async function loadStockHistory() {
    try {
      if (!id) return
      const data = await itemsService.getStockHistory(id, type)
      setStockHistory(data)
    } catch (error) {
      console.error('Error loading stock history:', error)
    }
  }

  function handleStockAdded() {
    loadItem()
    loadStockHistory()
    setSuccess('Estoque adicionado com sucesso')
    setTimeout(() => setSuccess(null), 3000)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando item...</p>
        </div>
      </div>
    )
  }

  if (!item) {
    return (
      <div className="text-center py-12">
        <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Item não encontrado
        </h2>
        <p className="text-gray-500 mb-6">
          O item que você está procurando não existe ou foi removido.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate(`/inventory/${type}`)}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para Lista
        </Button>
      </div>
    )
  }

  const getStockStatusColor = () => {
    if (item.current_stock === 0) {
      return 'text-red-600 bg-red-50 border-red-200'
    }
    if (item.current_stock <= item.min_stock) {
      return 'text-yellow-600 bg-yellow-50 border-yellow-200'
    }
    return 'text-green-600 bg-green-50 border-green-200'
  }

  const getStockStatusText = () => {
    if (item.current_stock === 0) {
      return 'Sem Estoque'
    }
    if (item.current_stock <= item.min_stock) {
      return 'Estoque Baixo'
    }
    return 'Estoque Normal'
  }

  const avgConsumption = item.consumption_history?.length 
    ? item.consumption_history.reduce((acc, curr) => acc + curr.quantity, 0) / item.consumption_history.length
    : 0

  const supplyPoint = Math.ceil(
    (avgConsumption / 30) * (item.lead_time_days || 7) * 1.5
  )

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              className="text-primary-600 hover:text-primary-700"
              onClick={() => navigate(`/inventory/${type}`)}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Voltar
            </Button>
            <div className="flex items-center gap-3">
              <div className="p-3 bg-primary-100 rounded-lg">
                {type === 'pharmacy' ? (
                  <Pill className="w-6 h-6 text-primary-600" />
                ) : (
                  <Package2 className="w-6 h-6 text-primary-600" />
                )}
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">{item.name}</h1>
                <div className="flex items-center gap-2 mt-1">
                  <span className="text-sm text-gray-500">{item.code}</span>
                  <span className="text-sm text-gray-500">•</span>
                  <span className="text-sm text-gray-500">{item.category}</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(user?.role === 'gestor' || user?.role === 'administrador') && (
              <>
                <Button 
                  variant="outline" 
                  size="sm"
                  onClick={() => setShowConfigDialog(true)}
                >
                  <Settings className="w-4 h-4 mr-2" />
                  Configurar Estoque
                </Button>
                {isAdmin && isWarehouse && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => setShowEditStockDialog(true)}
                    className="text-amber-600 border-amber-200 hover:bg-amber-50"
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Editar Estoque
                  </Button>
                )}
                <Button 
                  onClick={() => setShowAddStockDialog(true)}
                  className="bg-primary-500 hover:bg-primary-600 text-white"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Adicionar Estoque
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Success Message */}
        {success && (
          <div className="mb-6 p-4 bg-green-50 rounded-lg border border-green-200">
            <div className="flex items-center gap-2 text-green-700">
              <CheckCircle2 className="w-5 h-5" />
              <p>{success}</p>
            </div>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 rounded-lg border border-red-200">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              <p>{error}</p>
            </div>
          </div>
        )}

        {/* Quick Stats */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${getStockStatusColor()}`}>
                <Package2 className="w-5 h-5" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Estoque Atual</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-semibold text-gray-900">
                    {item.current_stock}
                  </p>
                  <p className="text-sm text-gray-500">{item.unit}</p>
                </div>
              </div>
            </div>
            <span className={`inline-flex items-center px-2 py-1 mt-2 text-xs font-medium rounded-full ${getStockStatusColor()}`}>
              {getStockStatusText()}
            </span>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <AlertTriangle className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Estoque Mínimo</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-semibold text-gray-900">
                    {item.min_stock}
                  </p>
                  <p className="text-sm text-gray-500">{item.unit}</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <TrendingUp className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Consumo Médio</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-semibold text-gray-900">
                    {Math.round(avgConsumption)}
                  </p>
                  <p className="text-sm text-gray-500">{item.unit}/mês</p>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white p-4 rounded-lg border border-gray-200">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <TrendingDown className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Ponto de Pedido</p>
                <div className="flex items-baseline gap-2">
                  <p className="text-lg font-semibold text-gray-900">
                    {supplyPoint}
                  </p>
                  <p className="text-sm text-gray-500">{item.unit}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs defaultValue="timeline">
          <div className="p-6 border-b border-gray-100">
            <TabsList>
              <TabsTrigger value="timeline" className="flex items-center gap-2">
                <History className="w-4 h-4" />
                Linha do Tempo
              </TabsTrigger>
              <TabsTrigger value="requests" className="flex items-center gap-2">
                <Package2 className="w-4 h-4" />
                Solicitações
              </TabsTrigger>
              <TabsTrigger value="analysis" className="flex items-center gap-2">
                <TrendingUp className="w-4 h-4" />
                Análise
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="timeline" className="p-6">
            <div className="flow-root">
              <ul role="list" className="-mb-8">
                {stockHistory.map((event, eventIdx) => (
                  <li key={event.id}>
                    <div className="relative pb-8">
                      {eventIdx !== stockHistory.length - 1 ? (
                        <span
                          className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                          aria-hidden="true"
                        />
                      ) : null}
                      <div className="relative flex space-x-3">
                        <div>
                          <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${
                            event.type === 'addition'
                              ? 'bg-green-100 text-green-600'
                              : 'bg-blue-100 text-blue-600'
                          }`}>
                            {event.type === 'addition' ? (
                              <Plus className="w-5 h-5" />
                            ) : (
                              <Package2 className="w-5 h-5" />
                            )}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div>
                            <div className="text-sm text-gray-500">
                              {event.type === 'addition' ? (
                                <>
                                  <span className="font-medium text-gray-900">
                                    {event.created_by}
                                  </span>{' '}
                                  adicionou{' '}
                                  <span className="font-medium text-gray-900">
                                    {event.quantity} {item.unit}
                                  </span>{' '}
                                  ao estoque
                                </>
                              ) : (
                                <>
                                  <span className="font-medium text-gray-900">
                                    {event.created_by}
                                  </span>{' '}
                                  solicitou{' '}
                                  <span className="font-medium text-gray-900">
                                    {Math.abs(event.quantity)} {item.unit}
                                  </span>
                                </>
                              )}
                            </div>
                            <div className="mt-1 text-sm text-gray-500">
                              {event.type === 'addition' ? (
                                <div className="space-y-1">
                                  {event.batch_number && (
                                    <p>
                                      <span className="font-medium">Lote:</span>{' '}
                                      {event.batch_number}
                                    </p>
                                  )}
                                  {event.expiry_date && (
                                    <p>
                                      <span className="font-medium">Validade:</span>{' '}
                                      {format(new Date(event.expiry_date), "dd/MM/yyyy")}
                                    </p>
                                  )}
                                  {event.supplier && (
                                    <p>
                                      <span className="font-medium">Fornecedor:</span>{' '}
                                      {event.supplier}
                                    </p>
                                  )}
                                  {event.unit_price && (
                                    <p>
                                      <span className="font-medium">Valor Unitário:</span>{' '}
                                      R$ {event.unit_price.toFixed(2)}
                                    </p>
                                  )}
                                  {event.invoice_number && (
                                    <p>
                                      <span className="font-medium">N° Nota Fiscal:</span>{' '}
                                      {event.invoice_number}
                                    </p>
                                  )}
                                  {event.invoice_date && (
                                    <p>
                                      <span className="font-medium">Data da Emissão da NF:</span>{' '}
                                      {format(new Date(event.invoice_date), "dd/MM/yyyy")}
                                    </p>
                                  )}
                                  {event.delivery_date && (
                                    <p>
                                      <span className="font-medium">Entrega:</span>{' '}
                                      {format(new Date(event.delivery_date), "dd/MM/yyyy")}
                                    </p>
                                  )}
                                  {event.afm_number && (
                                    <p>
                                      <span className="font-medium">AFM n°:</span>{' '}
                                      {event.afm_number}
                                    </p>
                                  )}
                                  {event.supplier_cnpj && (
                                    <p>
                                      <span className="font-medium">CNPJ do Fornecedor:</span>{' '}
                                      {event.supplier_cnpj}
                                    </p>
                                  )}
                                  {event.supplier_name && (
                                    <p>
                                      <span className="font-medium">Nome do Fornecedor:</span>{' '}
                                      {event.supplier_name}
                                    </p>
                                  )}
                                  {event.invoice_total_value && (
                                    <p>
                                      <span className="font-medium">Valor Total da Nota:</span>{' '}
                                      R$ {event.invoice_total_value.toFixed(2)}
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p>
                                  {event.reference_id && (
                                    <span>
                                      <span className="font-medium">Solicitação:</span>{' '}
                                      #{formatRequestNumber(event.reference_id)}
                                    </span>
                                  )}
                                  {event.status && (
                                    <span className={`ml-2 px-2 py-0.5 text-xs rounded-full ${
                                      event.status === 'completed' 
                                        ? 'bg-green-50 text-green-600 border border-green-200' 
                                        : event.status === 'processing'
                                          ? 'bg-blue-50 text-blue-600 border border-blue-200'
                                          : 'bg-gray-50 text-gray-600 border border-gray-200'
                                    }`}>
                                      {event.status === 'completed' ? 'Concluída' : 
                                       event.status === 'processing' ? 'Em Processamento' : 
                                       event.status === 'approved' ? 'Aprovada' : 
                                       event.status === 'pending' ? 'Pendente' : 
                                       event.status}
                                    </span>
                                  )}
                                </p>
                              )}
                              {event.description && (
                                <p className="mt-1">{event.description}</p>
                              )}
                            </div>
                          </div>
                          <div className="mt-2 text-sm text-gray-500">
                            <time dateTime={event.created_at}>
                              {format(new Date(event.created_at), "dd 'de' MMMM', às' HH:mm", {
                                locale: ptBR,
                              })}
                            </time>
                          </div>
                        </div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </TabsContent>

          <TabsContent value="requests" className="p-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  Solicitações do Item
                </h3>
                <span className="text-sm text-gray-500">
                  {stockHistory.filter(event => event.type === 'request').length} solicitações
                </span>
              </div>
              
              {stockHistory.filter(event => event.type === 'request').length > 0 ? (
                <div className="space-y-4">
                  {stockHistory
                    .filter(event => event.type === 'request')
                    .map((event) => (
                      <div 
                        key={`request-${event.id}`}
                        className="bg-blue-50 border border-blue-200 rounded-lg p-4 hover:bg-blue-100 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <div className="p-2 bg-blue-100 rounded-lg">
                                <Package2 className="w-4 h-4 text-blue-600" />
                              </div>
                              <div>
                                <h4 className="font-medium text-blue-900">
                                  Solicitação #{event.reference_id ? formatRequestNumber(event.reference_id) : 'N/A'}
                                </h4>
                                <p className="text-sm text-blue-700">
                                  Solicitado por: {event.created_by}
                                </p>
                              </div>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4 text-sm">
                              <div>
                                <span className="text-blue-600 font-medium">Quantidade:</span>
                                <span className="ml-2 text-blue-800">
                                  {Math.abs(event.quantity)} {item.unit}
                                </span>
                              </div>
                              <div>
                                <span className="text-blue-600 font-medium">Data:</span>
                                <span className="ml-2 text-blue-800">
                                  {format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm", {
                                    locale: ptBR,
                                  })}
                                </span>
                              </div>
                            </div>
                            
                            {event.status && (
                              <div className="mt-3">
                                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                                  event.status === 'completed' 
                                    ? 'bg-green-100 text-green-800 border border-green-200' 
                                    : event.status === 'processing'
                                      ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                      : event.status === 'approved'
                                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                                        : event.status === 'pending'
                                          ? 'bg-yellow-100 text-yellow-800 border border-yellow-200'
                                          : 'bg-gray-100 text-gray-800 border border-gray-200'
                                }`}>
                                  {event.status === 'completed' ? 'Concluída' : 
                                   event.status === 'processing' ? 'Em Processamento' : 
                                   event.status === 'approved' ? 'Aprovada' : 
                                   event.status === 'pending' ? 'Pendente' : 
                                   event.status === 'rejected' ? 'Rejeitada' :
                                   event.status === 'cancelled' ? 'Cancelada' :
                                   event.status}
                                </span>
                              </div>
                            )}
                            
                            {event.description && (
                              <div className="mt-2">
                                <p className="text-sm text-blue-700">
                                  <span className="font-medium">Observações:</span> {event.description}
                                </p>
                              </div>
                            )}
                          </div>
                          
                          {event.reference_id && (
                            <div className="ml-4">
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => navigate(`/requests/${event.reference_id}`)}
                                className="text-blue-600 border-blue-200 hover:bg-blue-50"
                              >
                                Ver Detalhes
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <Package2 className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">
                    Nenhuma solicitação encontrada
                  </h3>
                  <p className="text-gray-500">
                    Este item ainda não foi incluído em nenhuma solicitação.
                  </p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="analysis" className="p-6">
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold text-gray-900">
                  Análise de Consumo
                </h3>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Total Requests */}
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg">
                      <Package2 className="w-5 h-5 text-blue-600" />
                    </div>
                    <div>
                      <p className="text-sm text-blue-700">Total de Solicitações</p>
                      <p className="text-xl font-semibold text-blue-900">
                        {stockHistory.filter(event => event.type === 'request').length}
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Total Requested Quantity */}
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-purple-100 rounded-lg">
                      <TrendingDown className="w-5 h-5 text-purple-600" />
                    </div>
                    <div>
                      <p className="text-sm text-purple-700">Quantidade Total Solicitada</p>
                      <p className="text-xl font-semibold text-purple-900">
                        {stockHistory
                          .filter(event => event.type === 'request')
                          .reduce((sum, event) => sum + Math.abs(event.quantity), 0)} {item.unit}
                      </p>
                    </div>
                  </div>
                </div>
                
                {/* Total Added Quantity */}
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-green-100 rounded-lg">
                      <TrendingUp className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="text-sm text-green-700">Quantidade Total Adicionada</p>
                      <p className="text-xl font-semibold text-green-900">
                        {stockHistory
                          .filter(event => event.type === 'addition')
                          .reduce((sum, event) => sum + event.quantity, 0)} {item.unit}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Request Status Breakdown */}
              {stockHistory.filter(event => event.type === 'request').length > 0 && (
                <div className="bg-white border border-gray-200 rounded-lg p-4">
                  <h4 className="font-medium text-gray-900 mb-4">Status das Solicitações</h4>
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                    {['pending', 'approved', 'processing', 'completed', 'rejected'].map(status => {
                      const count = stockHistory.filter(event => 
                        event.type === 'request' && event.status === status
                      ).length
                      
                      if (count === 0) return null
                      
                      return (
                        <div key={status} className="text-center">
                          <div className={`w-12 h-12 mx-auto rounded-full flex items-center justify-center mb-2 ${
                            status === 'completed' ? 'bg-green-100 text-green-600' :
                            status === 'processing' ? 'bg-blue-100 text-blue-600' :
                            status === 'approved' ? 'bg-emerald-100 text-emerald-600' :
                            status === 'pending' ? 'bg-yellow-100 text-yellow-600' :
                            'bg-red-100 text-red-600'
                          }`}>
                            <span className="text-lg font-semibold">{count}</span>
                          </div>
                          <p className="text-xs text-gray-600 capitalize">
                            {status === 'completed' ? 'Concluídas' :
                             status === 'processing' ? 'Processando' :
                             status === 'approved' ? 'Aprovadas' :
                             status === 'pending' ? 'Pendentes' :
                             'Rejeitadas'}
                          </p>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
              
              {/* Recent Activity */}
              <div className="bg-white border border-gray-200 rounded-lg p-4">
                <h4 className="font-medium text-gray-900 mb-4">Atividade Recente</h4>
                <div className="space-y-3">
                  {stockHistory.slice(0, 5).map((event) => (
                    <div key={`recent-${event.id}`} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                      <div className={`p-1.5 rounded-full ${
                        event.type === 'addition' ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'
                      }`}>
                        {event.type === 'addition' ? (
                          <Plus className="w-3 h-3" />
                        ) : (
                          <Package2 className="w-3 h-3" />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 truncate">
                          {event.type === 'addition' 
                            ? `Adição de ${event.quantity} ${item.unit}` 
                            : `Solicitação de ${Math.abs(event.quantity)} ${item.unit}`
                          }
                        </p>
                        <p className="text-xs text-gray-500">
                          {format(new Date(event.created_at), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}
                        </p>
                      </div>
                      {event.status && event.type === 'request' && (
                        <span className={`px-2 py-0.5 text-xs rounded-full ${
                          event.status === 'completed' ? 'bg-green-100 text-green-700' :
                          event.status === 'processing' ? 'bg-blue-100 text-blue-700' :
                          event.status === 'approved' ? 'bg-emerald-100 text-emerald-700' :
                          event.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {event.status === 'completed' ? 'Concluída' :
                           event.status === 'processing' ? 'Processando' :
                           event.status === 'approved' ? 'Aprovada' :
                           event.status === 'pending' ? 'Pendente' :
                           'Rejeitada'}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {item && (
        <AddStockDialog
          item={item}
          type={type}
          open={showAddStockDialog}
          onOpenChange={setShowAddStockDialog}
          onSuccess={handleStockAdded}
        />
      )}

      {/* Stock Configuration Dialog */}
      {item && (
        <StockConfigDialog
          item={item}
          open={showConfigDialog}
          onOpenChange={setShowConfigDialog}
          onSuccess={() => {
            loadItem()
            setSuccess('Configuração de estoque atualizada com sucesso')
            setTimeout(() => setSuccess(null), 3000)
          }}
        />
      )}

      {/* Edit Stock Dialog - Only for admins */}
      {item && isAdmin && (
        <EditStockDialog
          item={item}
          open={showEditStockDialog}
          onOpenChange={setShowEditStockDialog}
          onSuccess={() => {
            loadItem()
            loadStockHistory()
            setSuccess('Estoque editado com sucesso')
            setTimeout(() => setSuccess(null), 3000)
          }}
        />
      )}
    </div>
  )
}