import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Search, Filter, Download, AlertCircle, 
  Loader2, Package2, Pill, Building2,
  Calendar, Users, Activity, 
  Clock
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { requestService } from '@/lib/services/requests'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { getDepartmentName } from '@/lib/constants/departments'
import { ExportDialog } from '@/components/export-dialog'
import { PeriodFilterDialog } from '@/components/period-filter-dialog'
import { isWithinPeriod, getDefaultDateRange } from '@/lib/utils/date'
import type { Request, RequestType } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'

export function RequestInbox() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'urgent' | 'today'>('all')
  const [requestType, setRequestType] = useState<RequestType>('pharmacy')
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showPeriodDialog, setShowPeriodDialog] = useState(false)
  const [dateRange, setDateRange] = useState(getDefaultDateRange())

  useEffect(() => {
    loadRequests()
  }, [])

  async function loadRequests() {
    try {
      setLoading(true)
      const data = await requestService.getAll()
      setRequests(data.filter(r => r.status === 'pending'))
    } catch (error) {
      console.error('Error loading requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRequestStats = () => {
    const filteredByType = requests.filter(r => r.type === requestType)
    const total = filteredByType.length
    const pending = filteredByType.filter(r => r.status === 'pending').length
    const urgent = filteredByType.filter(r => r.status === 'pending' && r.priority === 'high').length
    const today = filteredByType.filter(r => {
      const requestDate = new Date(r.created_at)
      const today = new Date()
      return requestDate.toDateString() === today.toDateString()
    }).length

    return { total, pending, urgent, today }
  }

  const handlePeriodFilter = (startDate: Date, endDate: Date) => {
    setDateRange({ startDate, endDate })
  }

  const filteredRequests = requests.filter(request => {
    const matchesSearch = searchTerm === '' || 
      request.requester?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      request.request_items.some(item => 
        item.item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.item.code.toLowerCase().includes(searchTerm.toLowerCase())
      )
    
    const matchesTab = activeTab === 'all' || 
      (activeTab === 'pending' && request.status === 'pending') ||
      (activeTab === 'urgent' && request.status === 'pending' && request.priority === 'high') ||
      (activeTab === 'today' && new Date(request.created_at).toDateString() === new Date().toDateString())

    const matchesDate = isWithinPeriod(request.created_at, dateRange.startDate, dateRange.endDate)
    const matchesType = request.type === requestType

    return matchesSearch && matchesTab && matchesDate && matchesType
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
      {/* Request Header */}
      <div className="flex justify-between items-start mb-6">
        <div className="space-y-3">
          {/* Request ID and Priority */}
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-white rounded-lg border border-gray-200 shadow-sm">
              <span className="text-sm text-gray-500">Solicitação Nº</span>
              <span className="text-lg font-semibold text-gray-900">
                {formatRequestNumber(request.id)}
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
          </div>

          {/* Department and Requester Info */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm">
              <Building2 className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                {getDepartmentName(request.department)}
              </span>
            </div>
            <div className="flex items-center gap-2 text-gray-500">
              <Users className="w-4 h-4" />
              <span className="text-sm">{request.requester?.full_name}</span>
            </div>
            <div className="flex items-center gap-2 text-gray-500">
              <Calendar className="w-4 h-4" />
              <span className="text-sm">
                {format(new Date(request.created_at), "dd 'de' MMMM', às' HH:mm", {
                  locale: ptBR,
                })}
              </span>
            </div>
            {request.comments.length > 0 && (
              <div className="flex items-center gap-1 text-gray-500">
                <AlertCircle className="w-4 h-4" />
                <span className="text-sm">{request.comments.length} comentário(s)</span>
              </div>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <Button 
            variant="outline" 
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              navigate(`/requests/${request.id}`)
            }}
          >
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
              className="flex items-center justify-between p-4 bg-white rounded-lg border border-gray-200 hover:border-primary-200 transition-colors"
            >
              <div>
                <p className="font-medium text-gray-900">{item.item.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                    {item.item.code}
                  </span>
                  <span className="text-xs text-gray-500">{item.item.category}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    Qtd: {item.quantity}
                  </span>
                  <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                    item.status === 'available' 
                      ? 'bg-green-50 text-green-600' 
                      : 'bg-yellow-50 text-yellow-600'
                  }`}>
                    {item.status === 'available' ? 'Disponível' : 'Estoque baixo'}
                  </span>
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
          <p className="text-gray-500">Carregando solicitações...</p>
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
            <h1 className="text-2xl font-bold text-gray-900">Caixa de Entrada</h1>
            <p className="text-sm text-gray-500 mt-1">
              Gerencie as solicitações pendentes
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm">
              <Filter className="w-4 h-4 mr-2" />
              Filtros
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowPeriodDialog(true)}
            >
              <Calendar className="w-4 h-4 mr-2" />
              Período
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => setShowExportDialog(true)}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
          </div>
        </div>

        {/* Request Type Selection */}
        <div className="grid grid-cols-2 gap-4 mb-6">
          <button
            className={`p-4 rounded-lg border-2 transition-all ${
              requestType === 'pharmacy'
                ? 'border-blue-500 bg-blue-50 shadow-lg'
                : 'border-gray-200 hover:border-blue-200 hover:bg-gray-50'
            }`}
            onClick={() => setRequestType('pharmacy')}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                requestType === 'pharmacy' ? 'bg-blue-100' : 'bg-gray-100'
              }`}>
                <Pill className={`w-5 h-5 ${
                  requestType === 'pharmacy' ? 'text-blue-600' : 'text-gray-500'
                }`} />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900">Farmácia</p>
                <p className="text-sm text-gray-500">
                  {requests.filter(r => r.type === 'pharmacy').length} solicitações
                </p>
              </div>
            </div>
          </button>

          <button
            className={`p-4 rounded-lg border-2 transition-all ${
              requestType === 'warehouse'
                ? 'border-purple-500 bg-purple-50 shadow-lg'
                : 'border-gray-200 hover:border-purple-200 hover:bg-gray-50'
            }`}
            onClick={() => setRequestType('warehouse')}
          >
            <div className="flex items-center gap-3">
              <div className={`p-2 rounded-lg ${
                requestType === 'warehouse' ? 'bg-purple-100' : 'bg-gray-100'
              }`}>
                <Package2 className={`w-5 h-5 ${
                  requestType === 'warehouse' ? 'text-purple-600' : 'text-gray-500'
                }`} />
              </div>
              <div className="text-left">
                <p className="font-medium text-gray-900">Almoxarifado</p>
                <p className="text-sm text-gray-500">
                  {requests.filter(r => r.type === 'warehouse').length} solicitações
                </p>
              </div>
            </div>
          </button>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <Activity className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total</p>
                <p className="text-lg font-semibold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-yellow-100 rounded-lg">
                <Clock className="w-5 h-5 text-yellow-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Pendentes</p>
                <p className="text-lg font-semibold text-gray-900">{stats.pending}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <AlertCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Urgentes</p>
                <p className="text-lg font-semibold text-gray-900">{stats.urgent}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Calendar className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Hoje</p>
                <p className="text-lg font-semibold text-gray-900">{stats.today}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Search */}
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

      {/* Requests List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-4 gap-4">
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Todas ({stats.total})
              </TabsTrigger>
              <TabsTrigger value="pending" className="flex items-center gap-2">
                <Clock className="w-4 h-4" />
                Pendentes ({stats.pending})
              </TabsTrigger>
              <TabsTrigger value="urgent" className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4" />
                Urgentes ({stats.urgent})
              </TabsTrigger>
              <TabsTrigger value="today" className="flex items-center gap-2">
                <Calendar className="w-4 h-4" />
                Hoje ({stats.today})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação encontrada</p>
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

          <TabsContent value="urgent" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação urgente</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="today" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação hoje</p>
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

      <ExportDialog
        open={showExportDialog}
        onOpenChange={setShowExportDialog}
        requests={filteredRequests}
        defaultFilename={`solicitacoes_pendentes_${format(new Date(), 'dd-MM-yyyy')}`}
      />
    </div>
  )
}