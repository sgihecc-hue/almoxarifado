import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Pill,
  Package2,
  Search,
  Filter,
  Calendar,
  RefreshCw,
  X
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { tvRequestService } from '@/lib/services/tv-requests'
import { departmentsService } from '@/lib/services/departments'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { formatRequestNumber } from '@/lib/utils/request'
import type { TVRequest } from '@/lib/services/tv-requests'
import type { Department } from '@/lib/types/departments'
import type { RequestStatus } from '@/lib/services/requests'

const themes = {
  pharmacy: {
    icon: Pill,
    title: 'Farmácia',
    bgAccent: 'bg-blue-900',
    textAccent: 'text-blue-300',
    btnActive: 'bg-blue-700'
  },
  warehouse: {
    icon: Package2,
    title: 'Almoxarifado',
    bgAccent: 'bg-purple-900',
    textAccent: 'text-purple-300',
    btnActive: 'bg-purple-700'
  }
}

const ALL_STATUSES: { value: RequestStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'pending', label: 'Pendente' },
  { value: 'approved', label: 'Aprovado' },
  { value: 'processing', label: 'Processando' },
  { value: 'delivered', label: 'Entregue' },
  { value: 'completed', label: 'Concluído' },
  { value: 'cancelled', label: 'Cancelado' },
  { value: 'rejected', label: 'Rejeitado' }
]

const PRIORITIES = [
  { value: 'all', label: 'Todas' },
  { value: 'high', label: 'Alta' },
  { value: 'medium', label: 'Média' },
  { value: 'low', label: 'Baixa' }
]

interface TVHistoryProps {
  type: 'pharmacy' | 'warehouse'
}

export function TVHistory({ type }: TVHistoryProps) {
  const navigate = useNavigate()
  const theme = themes[type]
  const Icon = theme.icon

  const [requests, setRequests] = useState<TVRequest[]>([])
  const [departments, setDepartments] = useState<Department[]>([])
  const [loading, setLoading] = useState(true)

  // Filters
  const [statusFilter, setStatusFilter] = useState<RequestStatus | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<string>('all')
  const [departmentFilter, setDepartmentFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  useEffect(() => {
    loadData()
  }, [])

  async function loadData() {
    setLoading(true)
    try {
      const [reqs, depts] = await Promise.all([
        tvRequestService.getAll(type),
        departmentsService.getAll()
      ])
      setRequests(reqs)
      setDepartments(depts)
    } catch (error) {
      console.error('Error loading data:', error)
    } finally {
      setLoading(false)
    }
  }

  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      // Status filter
      if (statusFilter !== 'all' && req.status !== statusFilter) return false

      // Priority filter
      if (priorityFilter !== 'all' && req.priority !== priorityFilter) return false

      // Department filter
      if (departmentFilter !== 'all' && req.department !== departmentFilter) return false

      // Date range
      if (dateFrom) {
        const reqDate = new Date(req.created_at).toISOString().split('T')[0]
        if (reqDate < dateFrom) return false
      }
      if (dateTo) {
        const reqDate = new Date(req.created_at).toISOString().split('T')[0]
        if (reqDate > dateTo) return false
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase()
        const matchesNumber = (req.request_number || formatRequestNumber(req.id)).toLowerCase().includes(q)
        const matchesRequester = req.requester_name.toLowerCase().includes(q)
        const matchesDepartment = req.department.toLowerCase().includes(q)
        const matchesItem = req.items.some(item => item.item_name.toLowerCase().includes(q))
        if (!matchesNumber && !matchesRequester && !matchesDepartment && !matchesItem) return false
      }

      return true
    })
  }, [requests, statusFilter, priorityFilter, departmentFilter, dateFrom, dateTo, searchQuery])

  const clearFilters = () => {
    setStatusFilter('all')
    setPriorityFilter('all')
    setDepartmentFilter('all')
    setSearchQuery('')
    setDateFrom('')
    setDateTo('')
  }

  const hasActiveFilters = statusFilter !== 'all' || priorityFilter !== 'all' ||
    departmentFilter !== 'all' || searchQuery.trim() !== '' || dateFrom !== '' || dateTo !== ''

  // Get unique departments from requests
  const availableDepartments = useMemo(() => {
    const depts = new Set(requests.map(r => r.department))
    return Array.from(depts).sort()
  }, [requests])

  return (
    <div className="h-screen bg-gray-900 text-white flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-gray-700 p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate(`/tv/${type}`)}
              className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div className={`p-2 ${theme.bgAccent} rounded-lg`}>
              <Icon className={`w-6 h-6 ${theme.textAccent}`} />
            </div>
            <h1 className="text-2xl font-bold">Histórico de Solicitações - {theme.title}</h1>
          </div>

          <div className="flex items-center gap-3">
            {hasActiveFilters && (
              <button
                onClick={clearFilters}
                className="flex items-center gap-1 px-3 py-2 bg-red-900/30 hover:bg-red-900/50 text-red-300 rounded-lg text-sm transition-colors"
              >
                <X className="w-4 h-4" />
                Limpar Filtros
              </button>
            )}
            <button
              onClick={loadData}
              className="p-2 bg-gray-800 hover:bg-gray-700 rounded-lg transition-colors"
            >
              <RefreshCw className="w-5 h-5 text-gray-300" />
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="mt-4 flex flex-wrap items-center gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por nº, solicitante, setor, item..."
              className="bg-gray-800 border border-gray-700 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-500 focus:border-blue-500 focus:outline-none w-80"
            />
          </div>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as any)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            {ALL_STATUSES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Priority filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            {PRIORITIES.map(p => (
              <option key={p.value} value={p.value}>{p.label}</option>
            ))}
          </select>

          {/* Department filter */}
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
          >
            <option value="all">Todos os Setores</option>
            {availableDepartments.map(dept => (
              <option key={dept} value={dept}>{dept}</option>
            ))}
          </select>

          {/* Date range */}
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
            <span className="text-gray-500">até</span>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
            />
          </div>

          {/* Results count */}
          <span className="text-gray-500 text-sm ml-auto">
            {filteredRequests.length} de {requests.length} solicitações
          </span>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="bg-gray-800 border-b border-gray-700 p-3">
          <div className="grid grid-cols-12 gap-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
            <div className="col-span-2">Código</div>
            <div className="col-span-2">Origem</div>
            <div className="col-span-2">Solicitante</div>
            <div className="col-span-1 text-center">Prioridade</div>
            <div className="col-span-2 text-center">Status</div>
            <div className="col-span-1 text-center">Itens</div>
            <div className="col-span-2">Data</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-40">
              <div className={`animate-spin rounded-full h-10 w-10 border-t-2 border-b-2 ${
                type === 'pharmacy' ? 'border-blue-500' : 'border-purple-500'
              }`} />
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-gray-500">
              Nenhuma solicitação encontrada
            </div>
          ) : (
            <div className="divide-y divide-gray-700">
              {filteredRequests.map((request, index) => (
                <div
                  key={request.id}
                  onClick={() => navigate(`/tv/${type}/${request.id}`)}
                  className={`p-3 cursor-pointer hover:bg-gray-700/50 transition-colors ${
                    index % 2 === 0 ? 'bg-gray-800' : 'bg-gray-800/50'
                  }`}
                >
                  <div className="grid grid-cols-12 gap-3 items-center">
                    <div className="col-span-2 font-bold text-white">
                      #{request.request_number || formatRequestNumber(request.id)}
                    </div>
                    <div className="col-span-2 text-gray-200 truncate">
                      {request.department}
                    </div>
                    <div className="col-span-2 text-gray-300 truncate">
                      {request.requester_name}
                    </div>
                    <div className="col-span-1 text-center">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
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
                    <div className="col-span-2 text-center">
                      <RequestStatusBadge status={request.status} />
                    </div>
                    <div className="col-span-1 text-center">
                      <span className={`${type === 'pharmacy' ? 'bg-blue-900 text-blue-200' : 'bg-purple-900 text-purple-200'} px-2 py-0.5 rounded-full text-xs`}>
                        {request.items.length}
                      </span>
                    </div>
                    <div className="col-span-2 text-gray-400 text-sm">
                      {format(new Date(request.created_at), "dd/MM/yyyy HH:mm", { locale: ptBR })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TVHistory
