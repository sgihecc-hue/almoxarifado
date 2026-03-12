import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { 
  Search, Filter, AlertCircle, 
  Loader2, Building2,
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
import { PeriodFilterDialog } from '@/components/period-filter-dialog'
import { isWithinPeriod, getDefaultDateRange } from '@/lib/utils/date'
import type { Request } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'

export function MyRequests() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user } = useAuth()
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'approved' | 'rejected' | 'completed'>('all')
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
      
      // Filter requests created by the current user
      if (user) {
        const userRequests = allRequests.filter(r => r.requester_id === user.id)
        setRequests(userRequests)
      }
    } catch (error) {
      console.error('Error loading requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRequestStats = () => {
    const total = requests.length
    const pending = requests.filter(r => r.status === 'pending').length
    const approved = requests.filter(r => r.status === 'approved' || r.status === 'processing').length
    const rejected = requests.filter(r => r.status === 'rejected').length
    const completed = requests.filter(r => r.status === 'completed').length
    const cancelled = requests.filter(r => r.status === 'cancelled').length

    return { total, pending, approved, rejected, completed, cancelled }
  }

  const handlePeriodFilter = (startDate: Date, endDate: Date) => {
    setDateRange({ startDate, endDate })
  }

  const filteredRequests = requests.filter(request => {
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
      (activeTab === 'completed' && request.status === 'completed')
    
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
            <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
              request.type === 'pharmacy' 
                ? 'text-blue-600 bg-blue-50 border border-blue-200'
                : 'text-purple-600 bg-purple-50 border border-purple-200'
            }`}>
              {request.type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
            </span>
          </div>

          {/* Department and Date Info */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm">
              <Building2 className="w-4 h-4 text-gray-500" />
              <span className="text-sm font-medium text-gray-700">
                {getDepartmentName(request.department)}
              </span>
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
                  {item.approved_quantity !== undefined && (
                    <span className="text-xs text-gray-500">
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
            <h1 className="text-2xl font-bold text-gray-900">Minhas Solicitações</h1>
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

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
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
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Aprovadas</p>
                <p className="text-lg font-semibold text-gray-900">{stats.approved}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <XCircle className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Rejeitadas</p>
                <p className="text-lg font-semibold text-gray-900">{stats.rejected}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Concluídas</p>
                <p className="text-lg font-semibold text-gray-900">{stats.completed}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Ban className="w-5 h-5 text-gray-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Canceladas</p>
                <p className="text-lg font-semibold text-gray-900">{stats.cancelled}</p>
              </div>
            </div>
          </div>
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
            <TabsList className="grid grid-cols-5 gap-4">
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
              <TabsTrigger value="completed" className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Concluídas ({stats.completed})
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

          <TabsContent value="completed" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação concluída</p>
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