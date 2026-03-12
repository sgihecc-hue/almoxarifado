import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  Clock, CheckCircle2, XCircle, ArrowUpDown,
  CheckSquare, Ban, MessageSquare, Truck
} from 'lucide-react'
import { getDepartmentName } from '@/lib/constants/departments'
import type { Request } from '@/lib/services/requests'
import { formatRequestNumber } from '@/lib/utils/request'

// Define request status type
type RequestStatus = 'pending' | 'approved' | 'rejected' | 'processing' | 'delivered' | 'completed' | 'cancelled';

interface RequestTimelineProps {
  request: Request
}

interface TimelineEvent {
  type: 'status' | 'comment'
  date: string
  user: string
  requestNumber: string
  department?: string
  justification?: string
  status?: RequestStatus | null
  reason?: string
  text?: string
}

// Justification options mapping
const justificationOptions: Record<string, string> = {
  'routine': 'Reposição de Rotina',
  'increased_demand': 'Aumento de Demanda',
  'new_procedure': 'Novo Procedimento',
  'critical_level': 'Nível Crítico',
  'replacement': 'Substituição',
  'special_event': 'Evento Especial',
  'emergency': 'Emergência'
}

export function RequestTimeline({ request }: RequestTimelineProps) {
  if (!request?.id) {
    return (
      <div className="p-4 text-center text-gray-500">
        <p>Não foi possível carregar o histórico da solicitação</p>
      </div>
    )
  }

  const getStatusIcon = (status: RequestStatus | null | undefined): JSX.Element => {
    switch (status) {
      case 'pending':
        return <Clock className="w-5 h-5" />
      case 'approved':
        return <CheckCircle2 className="w-5 h-5" />
      case 'rejected':
        return <XCircle className="w-5 h-5" />
      case 'processing':
        return <ArrowUpDown className="w-5 h-5" />
      case 'delivered':
        return <Truck className="w-5 h-5" />
      case 'completed':
        return <CheckSquare className="w-5 h-5" />
      case 'cancelled':
        return <Ban className="w-5 h-5" />
      default:
        return <Clock className="w-5 h-5" />
    }
  }

  const getStatusColor = (status: RequestStatus | null): string => {
    switch (status) {
      case 'pending':
        return 'text-yellow-500 bg-yellow-100'
      case 'approved':
        return 'text-green-500 bg-green-100'
      case 'rejected':
        return 'text-red-500 bg-red-100'
      case 'processing':
        return 'text-blue-500 bg-blue-100'
      case 'delivered':
        return 'text-orange-500 bg-orange-100'
      case 'completed':
        return 'text-emerald-500 bg-emerald-100'
      case 'cancelled':
        return 'text-gray-500 bg-gray-100'
      default:
        return 'text-gray-500 bg-gray-100'
    }
  }

  const getStatusText = (status: RequestStatus | null): string => {
    switch (status) {
      case 'pending':
        return 'Solicitação criada'
      case 'approved':
        return 'Solicitação aprovada'
      case 'rejected':
        return 'Solicitação rejeitada'
      case 'processing':
        return 'Processamento iniciado'
      case 'delivered':
        return 'Itens entregues'
      case 'completed':
        return 'Recebimento confirmado'
      case 'cancelled':
        return 'Solicitação cancelada'
      default:
        return 'Aguardando status'
    }
  }

  // Format justification text
  const formatJustification = (justification: string) => {
    return justificationOptions[justification] || justification
  }

  // Combine status history and comments into a single timeline
  const timeline: TimelineEvent[] = [
    // Initial creation
    ...(request?.created_at ? [{
      type: 'status' as const,
      status: 'pending' as RequestStatus,
      date: request.created_at,
      user: request.requester?.full_name || 'Usuário Desconhecido',
      department: request.department,
      requestNumber: formatRequestNumber(request.id),
      justification: request.justification
    }] : []),
    // Status changes
    ...(request.status_history?.filter(history => history && history.id && history.new_status).map(history => ({
      type: 'status' as const,
      status: history.new_status as RequestStatus,
      date: history.changed_at,
      user: history.changed_by || 'Sistema',
      reason: history.reason,
      requestNumber: formatRequestNumber(request.id)
    })) || []),
    // Comments
    ...(request.comments?.map(comment => ({
      type: 'comment' as const,
      date: comment.created_at,
      user: comment.user || 'Usuário Anônimo',
      text: comment.text,
      requestNumber: formatRequestNumber(request.id)
    })).filter(Boolean) || []), // Filter out any null/undefined entries
  ].filter(Boolean).sort((a, b) => {
    try {
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    } catch (error) {
      console.error('Error sorting timeline:', error)
      return 0
    }
  }) // Chronological order with error handling

  return (
    <div className="flow-root">
      <ul role="list" className="-mb-8">
        {timeline.map((event, eventIdx) => (
          <li key={eventIdx}>
            <div className="relative pb-8">
              {eventIdx !== timeline.length - 1 ? (
                <span
                  className="absolute left-4 top-4 -ml-px h-full w-0.5 bg-gray-200"
                  aria-hidden="true"
                />
              ) : null}
              <div className="relative flex space-x-3">
                <div>
                  {event.type === 'status' ? (
                    <span className={`h-8 w-8 rounded-full flex items-center justify-center ring-8 ring-white ${getStatusColor(event.status!)}`}>
                      {getStatusIcon(event.status)}
                    </span>
                  ) : (
                    <span className="h-8 w-8 rounded-full bg-gray-100 flex items-center justify-center ring-8 ring-white">
                      <MessageSquare className="w-5 h-5 text-gray-500" />
                    </span>
                  )}
                </div>
                <div className="flex min-w-0 flex-1 justify-between space-x-4">
                  <div>
                    <p className="text-sm text-gray-500">
                      {event.type === 'status' ? (
                        <>
                          <span className="font-medium text-gray-900">
                            {event.user}
                          </span>{' '}
                          {getStatusText(event.status || null)}
                          {event.reason && (
                            <>
                              :{' '}
                              <span className="text-gray-700">{event.reason}</span>
                            </>
                          )}
                          {event.department && (
                            <>
                              {' - Setor: '}
                              <span className="text-gray-700">{getDepartmentName(event.department)}</span>
                            </>
                          )}
                          {' - Pedido: '}
                          <span className="text-gray-700">#{event.requestNumber}</span>
                          
                          {/* Display justification for the initial creation event */}
                          {event.status === 'pending' && event.justification && (
                            <>
                              {' - Justificativa: '}
                              <span className="text-gray-700 font-medium">{formatJustification(event.justification)}</span>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <span className="font-medium text-gray-900">
                            {event.user}
                          </span>{' '}
                          comentou:{' '}
                          <span className="text-gray-700">{event.text}</span>
                        </>
                      )}
                    </p>
                  </div>
                  <div className="whitespace-nowrap text-right text-sm text-gray-500">
                    {format(new Date(event.date), "dd 'de' MMMM', às' HH:mm", {
                      locale: ptBR,
                    })}
                  </div>
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}