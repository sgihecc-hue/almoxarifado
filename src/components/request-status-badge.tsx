import {
  Clock, CheckCircle2, XCircle, ArrowUpDown,
  CheckSquare, Ban, Truck
} from 'lucide-react'
import type { RequestStatus } from '@/lib/services/requests'

interface RequestStatusBadgeProps {
  status: RequestStatus
}

export function RequestStatusBadge({ status }: RequestStatusBadgeProps) {
  const getStatusColor = (status: RequestStatus) => {
    switch (status) {
      case 'pending':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200'
      case 'approved':
        return 'text-green-600 bg-green-50 border-green-200'
      case 'rejected':
        return 'text-red-600 bg-red-50 border-red-200'
      case 'processing':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'delivered':
        return 'text-orange-600 bg-orange-50 border-orange-200'
      case 'completed':
        return 'text-emerald-600 bg-emerald-50 border-emerald-200'
      case 'cancelled':
        return 'text-gray-600 bg-gray-50 border-gray-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getStatusIcon = (status: RequestStatus) => {
    switch (status) {
      case 'pending':
        return <Clock className="w-4 h-4" />
      case 'approved':
        return <CheckCircle2 className="w-4 h-4" />
      case 'rejected':
        return <XCircle className="w-4 h-4" />
      case 'processing':
        return <ArrowUpDown className="w-4 h-4" />
      case 'delivered':
        return <Truck className="w-4 h-4" />
      case 'completed':
        return <CheckSquare className="w-4 h-4" />
      case 'cancelled':
        return <Ban className="w-4 h-4" />
      default:
        return null
    }
  }

  const getStatusText = (status: RequestStatus) => {
    switch (status) {
      case 'pending':
        return 'Pendente'
      case 'approved':
        return 'Aprovado'
      case 'rejected':
        return 'Rejeitado'
      case 'processing':
        return 'Em Processamento'
      case 'delivered':
        return 'Entregue'
      case 'completed':
        return 'Concluído'
      case 'cancelled':
        return 'Cancelado'
      default:
        return status
    }
  }

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getStatusColor(status)}`}>
      {getStatusIcon(status)}
      <span className="ml-1">{getStatusText(status)}</span>
    </span>
  )
}