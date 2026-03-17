import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Pill,
  AlertCircle,
  RefreshCw,
  Filter,
  Home,
  History
} from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { tvRequestService } from '@/lib/services/tv-requests'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { supabase } from '@/lib/supabase'
import type { TVRequest } from '@/lib/services/tv-requests'

export default function PharmacyTVDashboard() {
  const navigate = useNavigate()
  const [requests, setRequests] = useState<TVRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date>(new Date())
  const [activeFilter, setActiveFilter] = useState<'all' | 'pending' | 'approved' | 'processing'>('all')
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [refreshInterval] = useState(60)
  const [connectionError, setConnectionError] = useState(false)

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

  // Load requests on component mount and set up auto-refresh
  useEffect(() => {
    if (!connectionError) {
      loadRequests()

      let intervalId: number | undefined
      if (autoRefresh) {
        intervalId = window.setInterval(() => {
          loadRequests()
        }, refreshInterval * 1000)
      }

      return () => {
        if (intervalId) clearInterval(intervalId)
      }
    }
  }, [autoRefresh, refreshInterval, connectionError])

  async function loadRequests() {
    try {
      setLoading(true)
      setError(null)

      const data = await tvRequestService.getAll('pharmacy')

      // Filter only active requests (pending, approved, processing)
      const activeRequests = data.filter(r =>
        ['pending', 'approved', 'processing'].includes(r.status)
      )

      setRequests(activeRequests)
      setLastUpdated(new Date())
    } catch (error) {
      console.error('Error loading requests:', error)
      if (error instanceof Error) {
        if (error.message.includes('Failed to fetch')) {
          setError('Erro de conexão com o servidor.')
        } else {
          setError(`Erro ao carregar solicitações: ${error.message}`)
        }
      } else {
        setError('Erro ao carregar solicitações. Tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Filter requests
  const filteredRequests = requests.filter(request => {
    if (activeFilter === 'all') return true
    return request.status === activeFilter
  })

  return (
    <div className="h-screen bg-gray-900 text-white p-6 overflow-hidden flex flex-col">
      {/* Header */}
      <div className="flex justify-between items-center mb-6 border-b border-gray-700 pb-4">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-blue-900 rounded-lg">
            <Pill className="w-8 h-8 text-blue-300" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Painel de Solicitações - Farmácia</h1>
            <p className="text-gray-400">
              Atualizado em {format(lastUpdated, "dd 'de' MMMM 'de' yyyy 'às' HH:mm:ss", { locale: ptBR })}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button
            onClick={() => navigate(`/tv/pharmacy/history`)}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            title="Histórico"
          >
            <History className="w-5 h-5" />
            <span>Histórico</span>
          </button>

          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 px-3 py-2 bg-gray-800 hover:bg-gray-700 rounded-lg text-white transition-colors"
            title="Voltar ao Menu"
          >
            <Home className="w-5 h-5" />
            <span>Menu</span>
          </button>

          <div className="flex items-center gap-2">
            <span className="text-gray-400">Auto:</span>
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

      {/* Filters */}
      <div className="flex items-center gap-4 mb-6">
        <div className="text-gray-400 flex items-center gap-2">
          <Filter className="w-5 h-5" />
          <span>Filtrar:</span>
        </div>

        {[
          { key: 'all' as const, label: 'Todas', color: 'bg-blue-700' },
          { key: 'pending' as const, label: 'Aguardando', color: 'bg-yellow-700' },
          { key: 'approved' as const, label: 'Aprovadas', color: 'bg-green-700' },
          { key: 'processing' as const, label: 'Em Processamento', color: 'bg-blue-700' }
        ].map(filter => (
          <button
            key={filter.key}
            onClick={() => setActiveFilter(filter.key)}
            className={`px-4 py-2 rounded-lg transition-colors ${
              activeFilter === filter.key
                ? `${filter.color} text-white`
                : 'bg-gray-800 text-gray-300 hover:bg-gray-700'
            }`}
          >
            {filter.label}
          </button>
        ))}

        <span className="ml-auto text-gray-500 text-sm">
          {filteredRequests.length} solicitações
        </span>
      </div>

      {/* Requests Table */}
      <div className="flex-1 overflow-hidden flex flex-col">
        <div className="bg-gray-800 rounded-t-xl border-t border-l border-r border-gray-700 p-4">
          <div className="grid grid-cols-12 gap-4 text-gray-400 text-sm font-medium">
            <div className="col-span-2">Código</div>
            <div className="col-span-2">Data/Hora</div>
            <div className="col-span-2">Origem (Setor)</div>
            <div className="col-span-2">Destino (Setor)</div>
            <div className="col-span-2 text-center">Prioridade</div>
            <div className="col-span-2 text-center">Status</div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto bg-gray-800 rounded-b-xl border-b border-l border-r border-gray-700">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500"></div>
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
                  onClick={() => navigate(`/requests/${request.id}`)}
                  className={`p-4 cursor-pointer hover:bg-gray-700/50 transition-colors ${
                    request.priority === 'high'
                      ? 'bg-red-900/20 hover:bg-red-900/30'
                      : index % 2 === 0
                        ? 'bg-gray-800'
                        : 'bg-gray-800/50'
                  }`}
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    <div className="col-span-2 font-bold text-white text-lg">
                      #{request.request_number || '—'}
                    </div>
                    <div className="col-span-2 text-gray-300 text-sm">
                      {format(new Date(request.created_at), "dd/MM/yyyy HH:mm")}
                    </div>
                    <div className="col-span-2 text-gray-200">
                      {request.department}
                    </div>
                    <div className="col-span-2 text-gray-200">
                      {request.destination_department || '—'}
                    </div>
                    <div className="col-span-2 text-center">
                      <span className={`px-3 py-1 rounded-full text-sm font-medium ${
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

export { PharmacyTVDashboard }
