import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import {
  ArrowLeft, MessageSquare, AlertCircle, Loader2,
  Download, Printer, CheckCircle2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { supabase } from '@/lib/supabase'

const observationOptions = [
  { value: '', label: 'Selecionar...' },
  { value: 'opção 1', label: 'Opção 1' },
  { value: 'opção 2', label: 'Opção 2' },
  { value: 'opção 3', label: 'Opção 3' },
  { value: 'opção 4', label: 'Opção 4' },
  { value: 'opção 5', label: 'Opção 5' },
]

function ItemRow({ item, canEdit }: { item: Request['request_items'][0], canEdit: boolean }) {
  const [suppliedQty, setSuppliedQty] = useState(item.supplied_quantity ?? item.quantity)
  const [observation, setObservation] = useState(item.observation || '')
  const [checked, setChecked] = useState(item.is_checked || false)
  const saveField = async (field: string, value: any) => {
    try {
      await supabase
        .from('request_items')
        .update({ [field]: value })
        .eq('id', item.id)
    } catch (e) {
      console.error('Error saving field:', e)
    }
  }

  return (
    <tr className={`border-b border-gray-100 ${checked ? 'bg-green-50' : 'hover:bg-gray-50'} transition-colors`}>
      <td className="py-3 px-2">
        <p className="font-medium text-gray-900 text-sm">{item.item.name}</p>
        <p className="text-xs text-gray-400">{item.item.code}</p>
      </td>
      <td className="text-center py-3 px-2 text-gray-600">{item.item.unit || 'UN'}</td>
      <td className="text-center py-3 px-2 font-medium">{item.quantity}</td>
      <td className="text-center py-3 px-2">
        <span className={`font-medium ${(item.item.current_stock || 0) < item.quantity ? 'text-red-600' : 'text-green-600'}`}>
          {item.item.current_stock ?? 0}
        </span>
      </td>
      <td className="text-center py-3 px-2">
        {canEdit ? (
          <Input
            type="number"
            min="0"
            value={suppliedQty}
            onChange={(e) => {
              const val = Math.max(0, parseInt(e.target.value) || 0)
              setSuppliedQty(val)
            }}
            onBlur={() => saveField('supplied_quantity', suppliedQty)}
            className="w-20 text-center mx-auto h-8 text-sm"
          />
        ) : (
          <span>{item.supplied_quantity ?? '—'}</span>
        )}
      </td>
      <td className="text-center py-3 px-2">
        {canEdit ? (
          <select
            value={observation}
            onChange={(e) => {
              setObservation(e.target.value)
              saveField('observation', e.target.value)
            }}
            className="w-full h-8 px-2 text-xs border border-gray-300 rounded bg-white"
          >
            {observationOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        ) : (
          <span className="text-xs">{item.observation || '—'}</span>
        )}
      </td>
      <td className="text-center py-3 px-2">
        {canEdit ? (
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => {
              setChecked(e.target.checked)
              saveField('is_checked', e.target.checked)
            }}
            className="w-5 h-5 rounded border-gray-300 text-green-600 focus:ring-green-500 cursor-pointer"
          />
        ) : (
          checked ? <CheckCircle2 className="w-5 h-5 text-green-500 mx-auto" /> : <span className="text-gray-300">—</span>
        )}
      </td>
    </tr>
  )
}

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
              Solicitação #{request?.request_number || formatRequestNumber(request.id)}
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
                <p className="font-medium print:text-sm">#{request.request_number || formatRequestNumber(request.id)}</p>
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

          </div>

          {/* Items - Spreadsheet Table */}
          <div className="bg-white rounded-xl p-6 border border-gray-100 print:p-2 print:border print:border-gray-300 print:shadow-none">
            <h2 className="text-lg font-semibold text-gray-900 mb-6 print:mb-2 print:text-base">
              Itens Solicitados
            </h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b-2 border-gray-200">
                    <th className="text-left py-3 px-2 font-medium text-gray-600">Nome</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600 w-16">UF</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600 w-20">Qtd Solic.</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600 w-20">Saldo</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600 w-24">Qtd Fornec.</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600 w-36">Observação</th>
                    <th className="text-center py-3 px-2 font-medium text-gray-600 w-12">✓</th>
                  </tr>
                </thead>
                <tbody>
                  {request.request_items.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      canEdit={request.status === 'pending' || request.status === 'approved' || request.status === 'processing'}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Request Actions - Below items, hide when printing */}
          <div className="print:hidden">
            <RequestActions
              request={request}
              onUpdate={(updatedRequest) => setRequest(updatedRequest)}
            />
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