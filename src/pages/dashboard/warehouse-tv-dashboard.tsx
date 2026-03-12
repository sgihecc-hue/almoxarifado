import { useState, useEffect } from 'react'
import { 
  Package2, 
  Clock, 
  CheckCircle2, 
  ArrowUpDown, 
  AlertCircle, 
  Calendar,
  RefreshCw,
  Filter,
  FileText,
  Home
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { requestService } from '@/lib/services/requests'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { departmentsService } from '@/lib/services/departments'
import { supabase } from '@/lib/supabase'
import type { Request } from '@/lib/services/requests'
import type { Department } from '@/lib/types/departments'
import { formatRequestNumber } from '@/lib/utils/request'
import { useNavigate } from 'react-router-dom'

export default function WarehouseTVDashboard() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<Request[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'approved' | 'processing' | 'pendingManagement'>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval] = useState(60) // seconds
  const [connectionError, setConnectionError] = useState(false)
  const [allRequests, setAllRequests] = useState<Request[]>([])

  // Check Supabase connection on mount
  useEffect(() => {
    async function checkConnection() {
      try {
        const { error } = await supabase.from('requests').select('id').limit(1)
        if (error) {
          console.error('Supabase connection error:', error)
          setConnectionError(true)
          setError('Erro de conexão com o banco de dados. Por favor, verifique sua conexão.')
        } else {
          setConnectionError(false)
        }
      } catch (err) {
        console.error('Connection check error:', err)
        setConnectionError(true)
        setError('Erro de conexão com o banco de dados. Por favor, verifique sua conexão.')
      }
    }
    
    checkConnection()
  }, [])

  // Load departments on component mount
  useEffect(() => {
    loadDepartments()
  }, [])

  // Load requests on component mount and set up auto-refresh
  useEffect(() => {
    if (!connectionError) {
      loadRequests()
      loadAllRequests()
      
      // Set up auto-refresh
      let intervalId: number | undefined
      
      if (autoRefresh) {
        intervalId = window.setInterval(() => {
          loadRequests()
          loadAllRequests()
        }, refreshInterval * 1000)
      }
      
      return () => {
        if (intervalId) clearInterval(intervalId)
      }
    }
  }, [autoRefresh, refreshInterval, connectionError])

  async function loadDepartments() {
    try {
      const data = await departmentsService.getAll()
      setDepartments(data)
    } catch (error) {
      console.error('Error loading departments:', error)
      setError('Erro ao carregar departamentos. Por favor, tente novamente.')
    }
  }

  async function loadRequests() {
    try {
      setLoading(true)
      setError(null)
      
      const data = await requestService.getAll()
      
      // Filter only warehouse requests that are pending, approved, or in processing
      const warehouseRequests = data.filter(r => 
        r.type === 'warehouse' && 
        ['pending', 'approved', 'processing'].includes(r.status)
      )
      
      setRequests(warehouseRequests)
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Error loading requests:', error)
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          setError('Erro de conexão com o servidor. Por favor, verifique sua conexão com a internet.')
        } else {
          setError(`Erro ao carregar solicitações: ${error.message}`)
        }
      } else {
        setError('Erro ao carregar solicitações. Por favor, tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function loadAllRequests() {
    try {
      const data = await requestService.getAll()
      setAllRequests(data)
    } catch (error) {
      console.error('Error loading all requests:', error)
    }
  }

  // Get department name directly from departments array
  const getDepartmentNameFromList = (id: string): string => {
    const department = departments.find(dept => dept.id === id)
    return department ? department.name : id
  }

  // Filter requests based on active filter
  const filteredRequests = requests.filter(request => {
    if (activeFilter === 'all') return true;
    if (activeFilter === 'pendingManagement') {
      return request.status === 'pending' || request.status === 'approved';
    }
    return request.status === activeFilter;
  });

  // Group requests by status for the summary
  const pendingCount = requests.filter(r => r.status === 'pending').length
  const approvedCount = requests.filter(r => r.status === 'approved').length
  const processingCount = requests.filter(r => r.status === 'processing').length
  const totalCount = requests.length

  // Get high priority requests
  const highPriorityRequests = requests.filter(r => r.priority === 'high')

  // Get count for pending management
  const pendingManagementCount = allRequests.filter(r => 
    r.type === 'warehouse' && (r.status === 'pending' || r.status === 'approved')
  ).length

  // Get requests created today
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const todayRequests = requests.filter(r => {
    const requestDate = new Date(r.created_at)
    requestDate.setHours(0, 0, 0, 0)
    return requestDate.getTime() === today.getTime()
  })

  return (
    <div className="h-screen bg-gray-900 text-white p-6 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-purple-900 rounded-lg">
            <Package2 className="w-8 h-8 text-purple-300" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Painel de Solicitações - Almoxarifado</h1>
            <p className="text-gray-400">
              Atualizado em {format(lastUpdated, "dd 'de' MMMM 'de' yyyy 'às' HH:mm:ss", { locale: ptBR })}
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            title="Voltar ao Menu"
          >
            <Home className="w-5 h-5" />
            <span>Menu</span>
          </button>
          
          <div className="flex items-center gap-2">
            <span className="text-gray-400">Atualização Automática:</span>
            <button 
              onClick={() => setAutoRefresh(!autoRefresh)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                autoRefresh ? 'bg-green-600' : 'bg-gray-600'
              }`}
            >
              <span 
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  autoRefresh ? 'translate-x-6' : 'translate-x-1'
                }`} 
              />
            </button>
          </div>
          
          <button 
            onClick={loadRequests}
            className="p-2 bg-gray-800 rounded-full hover:bg-gray-700 transition-colors"
            title="Atualizar Agora"
          >
            <RefreshCw className="w-5 h-5 text-gray-300" />
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-5 gap-6 mb-6">
        <div className="bg-gray-800 p-6 rounded-xl border border-gray-700">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-gray-700 rounded-lg">
              <Package2 className="w-6 h-6 text-gray-300" />
            </div>
            <div>
              <p className="text-gray-400">Total de Solicitações</p>
              <p className="text-3xl font-bold text-white">{totalCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-yellow-900 p-6 rounded-xl border border-yellow-800">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-yellow-800 rounded-lg">
              <Clock className="w-6 h-6 text-yellow-300" />
            </div>
            <div>
              <p className="text-yellow-300">Aguardando Aprovação</p>
              <p className="text-3xl font-bold text-white">{pendingCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-green-900 p-6 rounded-xl border border-green-800">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-green-800 rounded-lg">
              <CheckCircle2 className="w-6 h-6 text-green-300" />
            </div>
            <div>
              <p className="text-green-300">Aprovadas</p>
              <p className="text-3xl font-bold text-white">{approvedCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-blue-900 p-6 rounded-xl border border-blue-800">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-blue-800 rounded-lg">
              <ArrowUpDown className="w-6 h-6 text-blue-300" />
            </div>
            <div>
              <p className="text-blue-300">Em Processamento</p>
              <p className="text-3xl font-bold text-white">{processingCount}</p>
            </div>
          </div>
        </div>
        
        <div className="bg-amber-900 p-6 rounded-xl border border-amber-800">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-amber-800 rounded-lg">
              <FileText className="w-6 h-6 text-amber-300" />
            </div>
            <div>
              <p className="text-amber-300">Pendências p/ iniciar processamento</p>
              <p className="text-3xl font-bold text-white">{pendingManagementCount}</p>
            </div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="text-gray-400 flex items-center gap-2">
          <Filter className="w-5 h-5" />
          <span>Filtrar:</span>
        </div>
        
        <button 
          onClick={() => setActiveFilter('all')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeFilter === 'all' 
              ? 'bg-purple-700 text-white' 
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Todas
        </button>
        
        <button 
          onClick={() => setActiveFilter('pending')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeFilter === 'pending' 
              ? 'bg-yellow-700 text-white' 
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Aguardando Aprovação
        </button>
        
        <button 
          onClick={() => setActiveFilter('approved')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeFilter === 'approved' 
              ? 'bg-green-700 text-white' 
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Aprovadas
        </button>
        
        <button 
          onClick={() => setActiveFilter('processing')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeFilter === 'processing' 
              ? 'bg-blue-700 text-white' 
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Em Processamento
        </button>
        
        <button 
          onClick={() => setActiveFilter('pendingManagement')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            activeFilter === 'pendingManagement' 
              ? 'bg-amber-700 text-white' 
              : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
          }`}
        >
          Pendências
        </button>
      </div>

      {/* Main Content - Requests Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="bg-gray-800 rounded-t-xl border-t border-l border-r border-gray-700 p-4">
          <div className="grid grid-cols-12 gap-4 text-gray-400 text-sm font-medium">
            <div className="col-span-1">Nº</div>
            <div className="col-span-2">Status</div>
            <div className="col-span-1">Prioridade</div>
            <div className="col-span-3">Setor</div>
            <div className="col-span-2">Solicitante</div>
            <div className="col-span-2">Data</div>
            <div className="col-span-1">Itens</div>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto bg-gray-800 rounded-b-xl border-b border-l border-r border-gray-700">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-purple-500"></div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-full text-red-400 p-4">
              <AlertCircle className="w-12 h-12 mb-2" />
              <p className="text-center">{error}</p>
              <button
                onClick={loadRequests}
                className="mt-4 px-4 py-2 bg-red-900 text-red-100 rounded-lg hover:bg-red-800 transition-colors"
              >
                Tentar Novamente
              </button>
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex items-center justify-center h-full text-gray-400">
              Nenhuma solicitação encontrada
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {filteredRequests.map((request, index) => (
                <div 
                  key={request.id} 
                  className={`p-4 ${
                    request.priority === 'high' 
                      ? 'bg-red-900/20' 
                      : index % 2 === 0 
                        ? 'bg-gray-800' 
                        : 'bg-gray-800/50'
                  }`}
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-1 font-bold text-white">
                      #{formatRequestNumber(request.id)}
                    </div>
                    <div className="col-span-2">
                      <RequestStatusBadge status={request.status} />
                    </div>
                    <div className="col-span-1">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${
                        request.priority === 'high' 
                          ? 'bg-red-900 text-red-200 border border-red-700' 
                          : request.priority === 'medium'
                            ? 'bg-yellow-900 text-yellow-200 border border-yellow-700'
                            : 'bg-green-900 text-green-200 border border-green-700'
                      }`}>
                        {request.priority === 'high' ? 'Alta' : 
                         request.priority === 'medium' ? 'Média' : 'Baixa'}
                      </span>
                    </div>
                    <div className="col-span-3 text-gray-200 truncate">
                      {getDepartmentNameFromList(request.department)}
                    </div>
                    <div className="col-span-2 text-gray-200 truncate">
                      {request.requester?.full_name || 'Desconhecido'}
                    </div>
                    <div className="col-span-2 flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-gray-400" />
                      <span className="text-gray-300">
                        {format(new Date(request.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                      </span>
                    </div>
                    <div className="col-span-1 text-center">
                      <span className="bg-purple-900 text-purple-200 px-2 py-1 rounded-full text-xs font-medium">
                        {request.request_items.length}
                      </span>
                    </div>
                  </div>
                  
                  {/* Item Preview (for high priority or if there are few requests) */}
                  {(request.priority === 'high' || filteredRequests.length < 10) && (
                    <div className="mt-3 pl-4 border-l-2 border-gray-700">
                      <div className="grid grid-cols-3 gap-4">
                        {request.request_items.slice(0, 3).map(item => (
                          <div key={item.id} className="bg-gray-700/50 p-2 rounded-lg">
                            <p className="text-sm font-medium text-white">{item.item.name}</p>
                            <div className="flex justify-between items-center mt-1">
                              <span className="text-xs text-gray-400">Qtd: {item.quantity}</span>
                              <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                item.status === 'available' 
                                  ? 'bg-green-900/50 text-green-300' 
                                  : 'bg-yellow-900/50 text-yellow-300'
                              }`}>
                                {item.status === 'available' ? 'Disponível' : 'Estoque baixo'}
                              </span>
                            </div>
                          </div>
                        ))}
                        {request.request_items.length > 3 && (
                          <div className="bg-gray-700/30 p-2 rounded-lg flex items-center justify-center">
                            <span className="text-sm text-gray-400">
                              +{request.request_items.length - 3} itens
                            </span>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer with Highlights */}
      <div className="mt-6 grid grid-cols-2 gap-6">
        <div className="bg-red-900/30 p-4 rounded-xl border border-red-800">
          <h3 className="text-lg font-semibold text-red-300 mb-2 flex items-center gap-2">
            <AlertCircle className="w-5 h-5" />
            Solicitações Urgentes
          </h3>
          {highPriorityRequests.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {highPriorityRequests.slice(0, 4).map(request => (
                <div key={request.id} className="bg-red-900/20 p-2 rounded-lg border border-red-800/50">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-white">#{formatRequestNumber(request.id)}</span>
                    <RequestStatusBadge status={request.status} />
                  </div>
                  <p className="text-sm text-gray-300 mt-1 truncate">{getDepartmentNameFromList(request.department)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(new Date(request.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400">Nenhuma solicitação urgente no momento</p>
          )}
        </div>
        
        <div className="bg-blue-900/30 p-4 rounded-xl border border-blue-800">
          <h3 className="text-lg font-semibold text-blue-300 mb-2 flex items-center gap-2">
            <Calendar className="w-5 h-5" />
            Solicitações de Hoje
          </h3>
          {todayRequests.length > 0 ? (
            <div className="grid grid-cols-2 gap-3">
              {todayRequests.slice(0, 4).map(request => (
                <div key={request.id} className="bg-blue-900/20 p-2 rounded-lg border border-blue-800/50">
                  <div className="flex justify-between items-center">
                    <span className="font-medium text-white">#{formatRequestNumber(request.id)}</span>
                    <RequestStatusBadge status={request.status} />
                  </div>
                  <p className="text-sm text-gray-300 mt-1 truncate">{getDepartmentNameFromList(request.department)}</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {format(new Date(request.created_at), "HH:mm", { locale: ptBR })}
                  </p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-gray-400">Nenhuma solicitação registrada hoje</p>
          )}
        </div>
      </div>
    </div>
  )
}

export { WarehouseTVDashboard }