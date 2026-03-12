import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { 
  ArrowLeft, MessageSquare, AlertCircle, Loader2, 
  Download, Printer
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { requestService } from '@/lib/services/requests'
import { RequestActions } from '@/components/request-actions'
import { RequestStatusBadge } from '@/components/request-status-badge'
import { RequestTimeline } from '@/components/request-timeline'
import { templatesService } from '@/lib/services/templates'
import type { Request } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'
import { getDepartmentName } from '@/lib/constants/departments'

export function RequestDetails() {
  const navigate = useNavigate()
  const { id } = useParams()
  const { user } = useAuth()
  const [request, setRequest] = useState<Request | null>(null)
  const [loading, setLoading] = useState(true)
  const [commenting, setCommenting] = useState(false)
  const [comment, setComment] = useState('')

  useEffect(() => {
    if (id) loadRequest(id)
  }, [id])

  // Add event listeners for print
  useEffect(() => {
    const beforePrint = () => {
      // This function intentionally left empty
    }
    
    const afterPrint = () => {
      // This function intentionally left empty
    }
    
    window.addEventListener('beforeprint', beforePrint)
    window.addEventListener('afterprint', afterPrint)
    
    return () => {
      window.removeEventListener('beforeprint', beforePrint)
      window.removeEventListener('afterprint', afterPrint)
    }
  }, [])

  async function loadRequest(requestId: string) {
    try {
      setLoading(true)
      const data = await requestService.getById(requestId)
      setRequest(data)
    } catch (error) {
      console.error('Error loading request:', error)
    } finally {
      setLoading(false)
    }
  }

  const handlePrint = () => {
    window.print()
  }

  const handleExportTemplate = async () => {
    if (!request || !request.id) {
      console.error('No request data available for export')
      return
    }
    
    try {
      await templatesService.generateRequestTemplate(request)
    } catch (error) {
      console.error('Error generating template:', error)
    }
  }

  // Add error state
  const [error, setError] = useState<string | null>(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando solicitação...</p>
        </div>
      </div>
    )
  }

  if (!request) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-900 mb-2">
          Solicitação não encontrada
        </h2>
        <p className="text-gray-500 mb-6">
          A solicitação que você está procurando não existe ou foi removida.
        </p>
        <Button
          variant="outline"
          onClick={() => navigate('/requests')}
        >
          <ArrowLeft className="w-4 h-4 mr-2" />
          Voltar para Solicitações
        </Button>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 print:space-y-1 print:max-w-full">
      {/* Header - Only visible on screen */}
      <div className="flex items-center justify-between print:hidden">
        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            className="text-primary-600 hover:text-primary-700"
            onClick={() => navigate('/requests')}
          >
            <ArrowLeft className="w-4 h-4 mr-2" />
            Voltar
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Solicitação #{request && formatRequestNumber(request.id)}
            </h1>
            
            {/* Error Message */}
            {error && (
              <div className="mt-2 p-2 bg-red-50 rounded border border-red-200">
                <p className="text-sm text-red-600">{error}</p>
                <button onClick={() => setError(null)} className="text-xs text-red-500 underline">
                  Fechar
                </button>
              </div>
            )}
            <p className="text-sm text-gray-500">
              Criada em {format(new Date(request.created_at), "dd 'de' MMMM', às' HH:mm", {
                locale: ptBR,
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={handleExportTemplate}>
            <Download className="w-4 h-4 mr-2" />
            Exportar
          </Button>
          <Button variant="outline" size="sm" onClick={handlePrint}>
            <Printer className="w-4 h-4 mr-2" />
            Imprimir
          </Button>
        </div>
      </div>

      {/* Status and Info */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 print:grid-cols-1 print:gap-2">
        <div className="col-span-2 space-y-6 print:space-y-2 print:col-span-1">
          {/* Request Info */}
          <div className="bg-white rounded-xl p-6 border border-gray-100 print:p-2 print:border-0 print:shadow-none">
            <div className="flex items-center justify-between mb-6 print:mb-2">
              <div>
                <h2 className="text-lg font-semibold text-gray-900 print:text-base">
                  Informações da Solicitação
                </h2>
                <p className="text-sm text-gray-500 print:hidden">
                  Detalhes e status atual
                </p>
              </div>
              <RequestStatusBadge status={request.status} />
            </div>

            <div className="grid grid-cols-3 gap-6 print:grid-cols-5 print:gap-2 print:text-sm">
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Solicitante</p>
                <p className="font-medium print:text-sm">{request.requester?.full_name}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Departamento</p>
                <p className="font-medium print:text-sm">{request.requester?.department}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Tipo</p>
                <p className="font-medium print:text-sm">
                  {request.type === 'pharmacy' ? 'Farmácia' : 'Almoxarifado'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Prioridade</p>
                <p className="font-medium print:text-sm">
                  {request.priority === 'high' ? 'Alta' :
                   request.priority === 'medium' ? 'Média' : 'Baixa'}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Nº Solicitação</p>
                <p className="font-medium print:text-sm">#{formatRequestNumber(request.id)}</p>
              </div>
              <div>
                <p className="text-sm text-gray-500 print:text-xs">Setor Solicitante</p>
                <p className="font-medium print:text-sm">{getDepartmentName(request.department)}</p>
              </div>
              <div className="col-span-2">
                <p className="text-sm text-gray-500 print:text-xs">Data de Criação</p>
                <p className="font-medium print:text-sm">
                  {format(new Date(request.created_at), "dd/MM/yyyy 'às' HH:mm", {
                    locale: ptBR,
                  })}
                </p>
              </div>
            </div>

            {/* Request Actions - Hide when printing */}
            <div className="mt-6 pt-6 border-t print:hidden">
              <RequestActions 
                request={request} 
                onUpdate={(updatedRequest) => setRequest(updatedRequest)} 
              />
            </div>
          </div>

          {/* Items */}
          <div className="bg-white rounded-xl p-6 border border-gray-100 print:p-2 print:border print:border-gray-300 print:shadow-none">
            <h2 className="text-lg font-semibold text-gray-900 mb-6 print:mb-2 print:text-base">
              Itens Solicitados
            </h2>
            <div className="space-y-4 print:space-y-0 max-h-[60vh] overflow-y-auto pr-2">
              {/* Table header - Only visible when printing */}
              <div className="hidden print:grid print:grid-cols-12 print:gap-1 print:border-b print:border-gray-300 print:pb-1 print:mb-1 print:text-xs print:font-medium">
                <div className="print:col-span-1">Item</div>
                <div className="print:col-span-2">Código</div>
                <div className="print:col-span-5">Descrição</div>
                <div className="print:col-span-1">Unid.</div>
                <div className="print:col-span-1 print:text-center">Qtd.</div>
                <div className="print:col-span-1 print:text-center">Aprov.</div>
                <div className="print:col-span-1 print:text-center">Obs.</div>
              </div>
              
              {/* Items list */}
              <div className="print:grid print:grid-cols-1 print:gap-0">
                {request.request_items.map((item, index) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between p-4 bg-gray-50 rounded-lg print:bg-white print:p-1 print:border-b print:border-gray-200 print:rounded-none"
                  >
                    {/* Screen view */}
                    <div className="print:hidden">
                      <p className="font-medium text-gray-900">{item.item.name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-gray-500">{item.item.code}</span>
                        <span className="text-xs text-gray-500">{item.item.category}</span>
                      </div>
                    </div>
                    <div className="text-right print:hidden">
                      <p className="font-medium text-gray-900">Qtd: {item.quantity}</p>
                      {item.approved_quantity && (
                        <span className="text-xs text-gray-500">
                          Aprovado: {item.approved_quantity}
                        </span>
                      )}
                    </div>
                    
                    {/* Print view */}
                    <div className="hidden print:grid print:grid-cols-12 print:gap-1 print:w-full print:text-xs">
                      <div className="print:col-span-1">{index + 1}</div>
                      <div className="print:col-span-2 print:truncate">{item.item.code}</div>
                      <div className="print:col-span-5 print:truncate">{item.item.name}</div>
                      <div className="print:col-span-1">-</div>
                      <div className="print:col-span-1 print:text-center">{item.quantity}</div>
                      <div className="print:col-span-1 print:text-center">{item.approved_quantity || '-'}</div>
                      <div className="print:col-span-1 print:text-center">-</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Timeline - Hide when printing */}
        <div className="bg-white rounded-xl p-6 border border-gray-100 print:hidden">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-lg font-semibold text-gray-900">
                Linha do Tempo
              </h2>
              <p className="text-sm text-gray-500">
                Histórico da solicitação
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCommenting(!commenting)}
            >
              <MessageSquare className="w-4 h-4 mr-2" />
              Comentar
            </Button>
          </div>

          {commenting && (
            <div className="mb-6">
              <textarea
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                className="w-full min-h-[100px] p-3 rounded-lg border border-gray-200 text-sm"
                placeholder="Digite seu comentário..."
              />
              <div className="flex justify-end gap-2 mt-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCommenting(false)
                    setComment('')
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  disabled={!comment.trim() || !user}
                  onClick={async () => {
                    if (!comment.trim() || !user) return
                    try {
                      const updatedRequest = await requestService.addComment(
                        request.id,
                        comment
                      )
                      setRequest(updatedRequest)
                      setCommenting(false)
                      setComment('')
                    } catch (error) {
                      console.error('Error adding comment:', error)
                    }
                  }}
                >
                  Enviar
                </Button>
              </div>
            </div>
          )}

          <RequestTimeline request={request} />
        </div>

        {/* Print Signature Section - Only visible when printing */}
        <div className="hidden print:block print:mt-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="text-center">
              <div className="border-t border-gray-300 pt-1 mt-8">
                <p className="text-xs">Solicitante</p>
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-gray-300 pt-1 mt-8">
                <p className="text-xs">Aprovador</p>
              </div>
            </div>
            <div className="text-center">
              <div className="border-t border-gray-300 pt-1 mt-8">
                <p className="text-xs">Recebedor</p>
              </div>
            </div>
          </div>
          
          <div className="mt-4 text-center text-xs text-gray-500">
            <p>Data de impressão: {format(new Date(), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}</p>
          </div>
        </div>
      </div>

      {/* Print-specific styles */}
      <style>
        {`
        @media print {
          @page {
            size: A4;
            margin: 0.5cm;
            scale: 90%;
          }
          body {
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-size: 9pt;
          }
          .print\\:hidden {
            display: none !important;
          }
          header {
            display: none !important;
          }
          table {
            page-break-inside: auto;
          }
          tr {
            page-break-inside: avoid;
            page-break-after: auto;
          }
        }
        `}
      </style>
    </div>
  )
}