import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Search, Filter, Download, AlertCircle,
  Loader2, Package2, Pill, Building2, ArrowRightLeft,
  Calendar, Users, Activity, CheckCircle2, Barcode, X,
} from 'lucide-react'
import { toast } from 'sonner'
import { itemsService } from '@/lib/services/items'
import { useBarcodeScanner } from '@/hooks/use-barcode-scanner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { requestService } from '@/lib/services/requests'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { getDepartmentName } from '@/lib/constants/departments'
import { useModule } from '@/contexts/module'
import { ExportDialog } from '@/components/export-dialog'
import { PeriodFilterDialog } from '@/components/period-filter-dialog'
import { isWithinPeriod, getDefaultDateRange } from '@/lib/utils/date'
import type { Request } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'

export function RequestProcessing() {
  const navigate = useNavigate()
  const location = useLocation()
  const { activeModule, activeStock } = useModule()
  const [requests, setRequests] = useState<Request[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'pharmacy' | 'warehouse'>('all')

  // Derive the request type from the active module. Atendente não tem
  // activeModule, então usamos o path (/almox/*) para não vazar farmácia
  // para o perfil de almoxarifado. Fora do /almox mantém 'pharmacy'.
  const moduleRequestType =
    activeModule === 'almoxarifado' || location.pathname.startsWith('/almox')
      ? 'warehouse'
      : 'pharmacy'
  const [showExportDialog, setShowExportDialog] = useState(false)
  const [showPeriodDialog, setShowPeriodDialog] = useState(false)
  const [dateRange, setDateRange] = useState(getDefaultDateRange())

  // Scanner: mapa requestId → Set de item_ids já verificados
  const [scannerMode, setScannerMode] = useState(false)
  const [verifiedItems, setVerifiedItems] = useState<Record<string, Set<string>>>({})
  const [scannerLookup, setScannerLookup] = useState(false)
  const scanInputRef = useRef<HTMLInputElement>(null)
  // Ref para filteredRequests (evita closure stale no handleScan)
  const filteredRequestsRef = useRef<Request[]>([])

  useEffect(() => {
    loadRequests()
  }, [])

  // Foca input de scan quando ativa o modo
  useEffect(() => {
    if (scannerMode && scanInputRef.current) scanInputRef.current.focus()
  }, [scannerMode])

  // Verifica um item via barcode: procura nos itens de todos os pedidos visíveis
  const handleScan = useCallback(
    async (barcode: string) => {
      if (!scannerMode) return
      setScannerLookup(true)
      try {
        // Busca o item pelo barcode no banco
        const result = await itemsService.findByBarcode(barcode)
        const foundItemId = result?.item?.id

        // Também tenta match pelo campo code direto (caso sem barcode cadastrado)
        let matched = false
        for (const req of filteredRequestsRef.current) {
          for (const ri of req.request_items) {
            const itemId = ri.item?.id
            const itemCode = ri.item?.code
            const itemBarcode = (ri.item as any)?.barcode

            if (
              itemId &&
              (itemId === foundItemId ||
                itemBarcode === barcode ||
                itemCode?.toLowerCase() === barcode.toLowerCase())
            ) {
              setVerifiedItems((prev) => {
                const reqSet = new Set(prev[req.id] || [])
                reqSet.add(itemId)
                return { ...prev, [req.id]: reqSet }
              })
              toast.success(`✔ ${ri.item.name}`, {
                description: `Pedido #${(req as any).request_number || req.id.slice(0, 8)} — item verificado`,
                duration: 2000,
              })
              matched = true
              break
            }
          }
          if (matched) break
        }

        if (!matched) {
          toast.error('Item não encontrado neste pedido', {
            description: `Código "${barcode}" não está nos pedidos em processamento.`,
            duration: 3000,
          })
        }
        scanInputRef.current?.focus()
      } finally {
        setScannerLookup(false)
      }
    },
    [scannerMode],
  )

  useBarcodeScanner({ onScan: handleScan, enabled: scannerMode })

  async function loadRequests() {
    try {
      setLoading(true)
      const data = await requestService.getAll()
      // Fluxo simplificado: mostra as aprovadas (prontas pra entrega) + as
      // antigas ainda em 'processing' que precisam ser finalizadas.
      setRequests(data.filter(r => r.status === 'processing' || r.status === 'approved'))
    } catch (error) {
      console.error('Error loading requests:', error)
    } finally {
      setLoading(false)
    }
  }

  const getRequestStats = () => {
    const moduleFiltered = requests.filter(r => r.type === moduleRequestType)
    const total = moduleFiltered.length
    const pharmacy = moduleFiltered.filter(r => r.type === 'pharmacy').length
    const warehouse = moduleFiltered.filter(r => r.type === 'warehouse').length
    const urgent = moduleFiltered.filter(r => r.priority === 'high').length
    const today = moduleFiltered.filter(r => {
      const requestDate = new Date(r.created_at)
      const today = new Date()
      return requestDate.toDateString() === today.toDateString()
    }).length

    return { total, pharmacy, warehouse, urgent, today }
  }

  const handlePeriodFilter = (startDate: Date, endDate: Date) => {
    setDateRange({ startDate, endDate })
  }

  const handleComplete = async (requestId: string) => {
    try {
      await requestService.complete(requestId)
      loadRequests()
    } catch (error) {
      console.error('Error completing request:', error)
    }
  }

  const filteredRequests = requests.filter(request => {
    const matchesSearch = searchTerm === '' ||
      request.requester?.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      request.request_items.some(item =>
        item.item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        item.item.code.toLowerCase().includes(searchTerm.toLowerCase())
      )

    const matchesTab = activeTab === 'all' || request.type === activeTab
    const matchesDate = isWithinPeriod(request.created_at, dateRange.startDate, dateRange.endDate)
    const matchesModule = request.type === moduleRequestType
    // Filtro por estoque de origem: cada satélite (CAF/SAT_1/SAT_2/SAT_T)
    // vê só as solicitações que serão atendidas por ele. Fallback pra
    // solicitações antigas sem source_location_id.
    const matchesSourceStock =
      !activeStock || !request.source_location_id || request.source_location_id === activeStock.id

    return matchesSearch && matchesTab && matchesDate && matchesModule && matchesSourceStock
  })

  // Mantém a ref sempre atualizada
  filteredRequestsRef.current = filteredRequests

  const renderRequestCard = (request: Request, index: number) => (
    <div 
      key={request.id} 
      className={`group p-6 transition-all ${
        index % 2 === 0
          ? 'bg-gradient-to-r from-primary-50/30 to-transparent hover:from-primary-50/50'
          : 'bg-gradient-to-r from-secondary-50/30 to-transparent hover:from-secondary-50/50'
      }`}
    >
      {/* Request Header */}
      <div className="flex justify-between items-start mb-6">
        <div className="space-y-3">
          {/* Request ID and Priority */}
          <div className="flex items-center gap-3">
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
          </div>

          {/* Department and Requester Info */}
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-gray-200 shadow-sm">
              <Building2 className="w-4 h-4 text-gray-500" />
              <span className="text-xs text-gray-400 mr-1">Solicitante:</span>
              <span className="text-sm font-medium text-gray-700">
                {getDepartmentName(request.department)}
              </span>
            </div>
            {request.destination_department && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-blue-50 border border-blue-200 shadow-sm">
                <ArrowRightLeft className="w-4 h-4 text-blue-500" />
                <span className="text-xs text-blue-400 mr-1">Solicitado:</span>
                <span className="text-sm font-medium text-blue-700">
                  {getDepartmentName(request.destination_department)}
                </span>
              </div>
            )}
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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => navigate(`/requests/${request.id}`)}
          >
            Ver detalhes
          </Button>
          <Button
            size="sm"
            className="bg-green-500 hover:bg-green-600 text-white"
            onClick={() => handleComplete(request.id)}
          >
            <CheckCircle2 className="w-4 h-4 mr-2" />
            Concluir
          </Button>
        </div>
      </div>

      {/* Request Items */}
      <div className="bg-white/80 backdrop-blur-sm rounded-lg p-4 shadow-sm">
        {scannerMode && (
          <div className="mb-3 flex items-center gap-2 text-xs text-gray-500">
            <Barcode className="w-3.5 h-3.5" />
            {(verifiedItems[request.id]?.size || 0)} / {request.request_items.length} itens verificados
            {verifiedItems[request.id]?.size === request.request_items.length && (
              <span className="ml-2 text-emerald-600 font-medium">✔ Todos verificados</span>
            )}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {request.request_items.map((item) => {
            const isVerified = scannerMode && verifiedItems[request.id]?.has(item.item?.id)
            return (
            <div
              key={item.id}
              className={`flex items-center justify-between p-4 rounded-lg border transition-colors ${
                isVerified
                  ? 'bg-emerald-50 border-emerald-300'
                  : 'bg-white border-gray-200 hover:border-primary-200'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {isVerified && <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />}
                  <p className="font-medium text-gray-900 truncate">{item.item.name}</p>
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-gray-100 text-gray-600">
                    {item.item.code}
                  </span>
                  <span className="text-xs text-gray-500">{item.item.category}</span>
                </div>
              </div>
              <div className="text-right ml-2">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-gray-900">
                    Qtd: {item.quantity}
                  </span>
                  {item.approved_quantity && (
                    <span className="text-xs text-gray-500">
                      (Aprovado: {item.approved_quantity})
                    </span>
                  )}
                </div>
                <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${
                  item.status === 'available'
                    ? 'bg-green-50 text-green-600'
                    : 'bg-yellow-50 text-yellow-600'
                }`}>
                  {item.status === 'available' ? 'Disponível' : 'Estoque baixo'}
                </span>
              </div>
            </div>
            )
          })}
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
            <h1 className="text-2xl font-bold text-gray-900">Em Processamento</h1>
            <p className="text-sm text-gray-500 mt-1">
              Solicitações que estão sendo atendidas
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setScannerMode((v) => !v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors border ${
                scannerMode
                  ? 'bg-blue-600 text-white border-blue-700 shadow-md'
                  : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
              }`}
            >
              <Barcode className="w-4 h-4" />
              {scannerMode ? 'Scanner ativo' : 'Verificar com Scanner'}
            </button>
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

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
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
              <div className="p-2 bg-blue-100 rounded-lg">
                <Pill className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Farmácia</p>
                <p className="text-lg font-semibold text-gray-900">{stats.pharmacy}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Package2 className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Almoxarifado</p>
                <p className="text-lg font-semibold text-gray-900">{stats.warehouse}</p>
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
              <div className="p-2 bg-green-100 rounded-lg">
                <Calendar className="w-5 h-5 text-green-600" />
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

      {/* Barra do Scanner */}
      {scannerMode && (
        <div className="bg-blue-600 text-white rounded-xl px-5 py-4 flex items-center gap-4 shadow-md">
          <Barcode className="w-6 h-6 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-semibold text-sm">Modo Verificação por Scanner ativo</p>
            <p className="text-xs text-blue-200 mt-0.5">
              Aponte o leitor para cada produto ao separar o pedido. Itens verificados ficam marcados com ✔.
            </p>
          </div>
          <input
            ref={scanInputRef}
            data-barcode-input="true"
            readOnly
            placeholder={scannerLookup ? 'Buscando...' : 'Aguardando scan...'}
            className={`w-36 h-8 px-2 text-xs rounded border text-center text-gray-900 ${
              scannerLookup ? 'bg-yellow-100 border-yellow-400' : 'bg-white border-blue-300'
            } focus:outline-none focus:ring-2 focus:ring-white`}
            onBlur={() => setTimeout(() => scanInputRef.current?.focus(), 100)}
          />
          {scannerLookup && <Loader2 className="w-4 h-4 animate-spin" />}
          <button
            type="button"
            onClick={() => setScannerMode(false)}
            className="ml-2 p-1 rounded hover:bg-blue-700"
            title="Fechar modo scanner"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Requests List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-3 gap-4">
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Todas ({stats.total})
              </TabsTrigger>
              <TabsTrigger value="pharmacy" className="flex items-center gap-2">
                <Pill className="w-4 h-4" />
                Farmácia ({stats.pharmacy})
              </TabsTrigger>
              <TabsTrigger value="warehouse" className="flex items-center gap-2">
                <Package2 className="w-4 h-4" />
                Almoxarifado ({stats.warehouse})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação em processamento</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="pharmacy" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação de farmácia em processamento</p>
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="warehouse" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredRequests.length > 0 ? (
                filteredRequests.map((request, index) => renderRequestCard(request, index))
              ) : (
                <div className="p-8 text-center">
                  <p className="text-gray-500">Nenhuma solicitação de almoxarifado em processamento</p>
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
        defaultFilename={`solicitacoes_processamento_${format(new Date(), 'dd-MM-yyyy')}`}
      />
    </div>
  )
}