import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Search, Filter, AlertCircle,
  Loader2, Building2, ArrowRightLeft,
  Calendar, Activity, CheckCircle2,
  Clock, XCircle, Ban, Plus,
  FileText
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { requestService } from '@/lib/services/requests'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { getDepartmentName } from '@/lib/constants/departments'
import { useAuth } from '@/contexts/auth'
import { useModule } from '@/contexts/module'
import { departmentBelongsToStock } from '@/lib/constants/stock-locations'
import { PeriodFilterDialog } from '@/components/period-filter-dialog'
import { isWithinPeriod, getDefaultDateRange } from '@/lib/utils/date'
import type { Request } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'

export function MyRequests() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const { activeStock } = useModule()
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'delivered' | 'cancelled'>('pending')
  const [showPeriodDialog, setShowPeriodDialog] = useState(false)
  const [dateRange, setDateRange] = useState(getDefaultDateRange())

  useEffect(() => {
    if (user) {
      loadRequests()
    }
  }, [user])

  useEffect(() => {
    // Check for success message from location state (after creating a new request)
    if (location.state?.message && location.state?.type) {
      // You could add a toast notification here
      
      // Clear the location state
      navigate(location.pathname, { replace: true, state: {} })
    }
  }, [location, navigate])

  async function loadRequests() {
    try {
      setLoading(true)
      const allRequests = await requestService.getAll()
      
      setRequests(allRequests)
    } catch (error) {
      console.error('Error loading requests:', error)
    } finally {
      setLoading(false)
    }
  }

  // Isolamento de módulo: quando a tela é aberta por /almox/* (Minhas
  // Solicitações do almoxarifado), mostra SÓ solicitações do tipo 'warehouse'.
  // Impede que pedidos de farmácia apareçam no almox. Fora do /almox
  // (farmácia e /requests genérico), nada muda — farmácia intacta.
  const isWarehouse = location.pathname.startsWith('/almox')
  const typeScopedRequests = isWarehouse
    ? requests.filter(r => r.type === 'warehouse')
    : requests

  // Se ha estoque ativo, mostra solicitacoes onde ele participa como
  // SOLICITANTE (fez o pedido) OU DESTINO (vai atender o pedido). Ex: Sat 1
  // pede pro CAF -> aparece tanto na "Minhas Solicitacoes" da Sat 1 quanto na
  // do CAF. O filtro anterior era so por solicitante e escondia da farmacia
  // que precisava atender.
  const scopedRequests = activeStock
    ? typeScopedRequests.filter(r =>
        departmentBelongsToStock(r.department, activeStock) ||
        departmentBelongsToStock(r.destination_department, activeStock)
      )
    : typeScopedRequests

  const getRequestStats = () => {
    const total = scopedRequests.length
    const pending = scopedRequests.filter(r => r.status === 'pending').length
    const approved = scopedRequests.filter(r => r.status === 'approved' || r.status === 'processing').length
    const rejected = scopedRequests.filter(r => r.status === 'rejected').length
    const delivered = scopedRequests.filter(r => r.status === 'delivered' || r.status === 'completed').length
    const cancelled = scopedRequests.filter(r => r.status === 'cancelled').length

    return { total, pending, approved, rejected, delivered, cancelled }
  }

  const handlePeriodFilter = (startDate: Date, endDate: Date) => {
    setDateRange({ startDate, endDate })
  }

  const filteredRequests = scopedRequests.filter(request => {
    const matchesSearch = searchTerm === '' || 
      request.department.toLowerCase().includes(searchTerm.toLowerCase()) ||
      request.request_items.some(item => 
        item.item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.item.code.toLowerCase().includes(searchTerm.toLowerCase())
      )
    
    const matchesTab = activeTab === 'all' ||
      (activeTab === 'pending' && request.status === 'pending') ||
      (activeTab === 'approved' && (request.status === 'approved' || request.status === 'processing')) ||
      (activeTab === 'rejected' && request.status === 'rejected') ||
      (activeTab === 'delivered' && (request.status === 'delivered' || request.status === 'completed')) ||
      (activeTab === 'cancelled' && request.status === 'cancelled')
    
    const matchesDate = isWithinPeriod(request.created_at, dateRange.startDate, dateRange.endDate)

    return matchesSearch && matchesTab && matchesDate
  })

  const renderRequestCard = (request: Request, index: number) => (
    <div 
      key={request.id} 
      className={`group p-6 transition-all cursor-pointer ${
        index % 2 === 0
          ? 'bg-gradient-to-r from-primary-50/30 to-transparent hover:from-primary-50/50'
          : 'bg-gradient-to-r from-secondary-50/30 to-transparent hover:from-secondary-50/50'
      }`}
      onClick={() => navigate(`/requests/${request.id}`)}
    >
      {/* Request Header — flex-wrap pra nao estourar em telas medias */}
      <div className="flex flex-wrap justify-between items-start gap-4 mb-6">
        <div className="space-y-3 min-w-0 flex-1">
          {/* Request ID and Priority */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm">
              <span className="text-sm text-gray-500">Solicitação Nº</span>
              <span className="text-lg font-semibold text-gray-900">
                {request.request_number || formatRequestNumber(request.id)}
              </span>
            </div>
            <RequestStatusBadge status={request.status} />
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              request.priority === 'high' ? 'text-red-600 bg-red-50' :
              request.priority === 'medium' ? 'text-yellow-600 bg-yellow-50' :
              'text-green-600 bg-green-50'
            }`}>
              {request.priority === 'high' ? 'Alta' :
               request.priority === 'medium' ? 'Média' : 'Baixa'}
            </span>
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              request.type === 'pharmacy' 
                ? 'text-blue-600 bg-blue-50 border border-blue-200'
                : 'text-purple-600 bg-purple-50 border border-purple-200'
            }`}>
              {request.type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
            </span>
          </div>

          {/* Info do departamento e data — flex-wrap pra nao estourar em
              telas medias; whitespace-nowrap nos chips pra "01 de julho,
              as 14:44" nao quebrar em pedacos */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm whitespace-nowrap">
              <Building2 className="w-4 h-4 text-gray-500 flex-shrink-0" />
              <span className="text-xs text-gray-400">Solicitante:</span>
              <span className="text-sm font-medium text-gray-700">
                {getDepartmentName(request.department)}
              </span>
            </div>
            {request.destination_department && (
              <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 shadow-sm whitespace-nowrap">
                <ArrowRightLeft className="w-4 h-4 text-blue-500 flex-shrink-0" />
                <span className="text-xs text-blue-400">Solicitado:</span>
                <span className="text-sm font-medium text-blue-700">
                  {getDepartmentName(request.destination_department)}
                </span>
              </div>
            )}
            <div className="inline-flex items-center gap-2 text-gray-500 whitespace-nowrap">
              <Calendar className="w-4 h-4 flex-shrink-0" />
              <span className="text-sm">
                {format(new Date(request.created_at), "dd 'de' MMMM', às' HH:mm", {
                  locale: ptBR,
                })}
              </span>
            </div>
            {request.comments.length > 0 && (
              <div className="inline-flex items-center gap-1 text-gray-500 whitespace-nowrap">
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                <span className="text-sm">{request.comments.length} comentário(s)</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Botão de confirmar recebimento quando o pedido foi entregue mas
              ainda não confirmado — leva pra tela dedicada de confirmação. */}
          {request.status === 'delivered' && (
            <Button
              size="sm"
              className="bg-green-600 hover:bg-green-700 text-white"
              onClick={(e) => {
                e.stopPropagation()
                navigate('/requests/receipt-confirmation')
              }}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Confirmar Recebimento
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/requests/${request.id}`)
            }}
          >
            <FileText className="w-4 h-4 mr-2" />
            Ver detalhes
          </Button>
        </div>
      </div>

      {/* Request Items */}
      <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 shadow-sm">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {request.request_items.map((item) => (
            <div
              key={item.id}
              className="flex items-start justify-between gap-3 p-4 bg-white rounded-lg border border-gray-200 hover:border-primary-200 transition-colors"
            >
              <div className="min-w-0 flex-1">
                <p className="font-medium text-gray-900 break-words">{item.item.name}</p>
                <div className="flex flex-wrap items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                    {item.item.code}
                  </span>
                  <span className="text-xs text-gray-500">{item.item.category}</span>
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="flex flex-col items-end gap-0.5">
                  <span className="text-sm font-medium text-gray-900 whitespace-nowrap">
                    Qtd: {item.quantity}
                  </span>
                  {item.approved_quantity !== undefined && (
                    <span className="text-xs text-gray-500 whitespace-nowrap">
                      (Aprovado: {item.approved_quantity})
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando suas solicitações...</p>
        </div>
      </div>
    )
  }

  const stats = getRequestStats()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Solicitações</h1>
            <p className="text-sm text-gray-500 mt-1">
              Acompanhe o status de todas as suas solicitações
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="w-4 h-4 mr-2" />
              Filtros
            </Button>
            <Button 
              className="bg-primary-500 hover:bg-primary-600 text-white"
              onClick={() => navigate('/requests/new')}
            >
              <Plus className="w-4 h-4 mr-2" />
              Nova Solicitação
            </Button>
          </div>
        </div>

        {/* Stats — layout compacto (icone + label empilhados) que aguenta 6
            colunas sem truncar. Em xl vira 6, em md/lg 3, em telas curtas 2. */}
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 mb-6">
          {[
            { label: 'Total',     value: stats.total,     Icon: Activity,     bg: 'bg-primary-100',  fg: 'text-primary-600'  },
            { label: 'Pendentes', value: stats.pending,   Icon: Clock,        bg: 'bg-yellow-100',   fg: 'text-yellow-600'   },
            { label: 'Aprovadas', value: stats.approved,  Icon: CheckCircle2, bg: 'bg-green-100',    fg: 'text-green-600'    },
            { label: 'Rejeitadas',value: stats.rejected,  Icon: XCircle,      bg: 'bg-red-100',      fg: 'text-red-600'      },
            { label: 'Entregues', value: stats.delivered, Icon: CheckCircle2, bg: 'bg-emerald-100',  fg: 'text-emerald-600'  },
            { label: 'Canceladas',value: stats.cancelled, Icon: Ban,          bg: 'bg-gray-100',     fg: 'text-gray-600'     },
          ].map(({ label, value, Icon, bg, fg }) => (
            <div key={label} className="bg-gray-50 p-3 rounded-lg">
              <div className="flex items-center gap-2">
                <div className={`p-1.5 ${bg} rounded-lg flex-shrink-0`}>
                  <Icon className={`w-4 h-4 ${fg}`} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500 truncate">{label}</p>
                  <p className="text-lg font-semibold text-gray-900 leading-tight">{value}</p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
          <Input
            placeholder="Buscar por departamento, item..."
            className="pl-9"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* Requests List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-6 gap-4">
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Todas ({stats.total})
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Pendentes ({stats.pending})
              </TabsTrigger>
              <TabsTrigger value="approved" className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Aprovadas ({stats.approved})
              </TabsTrigger>
              <TabsTrigger value="rejected" className="flex items-center gap-2">
                <XCircle className="w-4 h-4" />
                Rejeitadas ({stats.rejected})
              </TabsTrigger>
              <TabsTrigger value="delivered" className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Entregues ({stats.delivered})
              </TabsTrigger>
              <TabsTrigger value="cancelled" className="flex items-center gap-2">
                <Ban className="w-4 h-4" />
                Canceladas ({stats.cancelled})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <div className="mx-auto w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                    <FileText className="w-8 h-8 text-gray-400" />
                  </div>
                  <h3 className="text-lg font-medium text-gray-900 mb-2">Nenhuma solicitação encontrada</h3>
                  <p className="text-gray-500 mb-6">
                    Você ainda não possui solicitações registradas no sistema.
                  </p>
                  <Button 
                    onClick={() => navigate('/requests/new')}
                    className="bg-primary-500 hover:bg-primary-600 text-white"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Criar Nova Solicitação
                  </Button>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="pending" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação pendente</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="approved" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação aprovada</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="rejected" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação rejeitada</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="delivered" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação entregue</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="cancelled" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação cancelada</p>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      <PeriodFilterDialog
        open={showPeriodDialog}
        onOpenChange={setShowPeriodDialog}
        onFilter={handlePeriodFilter}
        defaultStartDate={dateRange.startDate}
        defaultEndDate={dateRange.endDate}
      />
    </div>
  )
}