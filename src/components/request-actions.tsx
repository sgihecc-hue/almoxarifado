import { useState, useEffect } from 'react'
import { useAuth } from '@/contexts/auth'
import {
  CheckCircle2, XCircle, PlayCircle,
  CheckSquare, Ban, Loader2, Truck, PackageCheck
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'

import { requestService } from '@/lib/services/requests'
import type { Request } from '@/lib/services/requests'

interface RequestActionsProps {
  request: Request
  onUpdate: (request: Request) => void
}

export function RequestActions({ request, onUpdate }: RequestActionsProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [action, setAction] = useState<'approve' | 'reject' | 'cancel' | 'deliver' | 'confirm_receipt' | null>(null)
  const [reason, setReason] = useState('')
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>(() => {
    // Initialize with current quantities or approved quantities if they exist
    if (!request?.request_items?.length) {
      return {}
    }
    
    try {
      return request.request_items.reduce((acc, item) => {
        if (!item || !item.id || typeof item.quantity !== 'number' || item.quantity < 0) return acc
        
        const quantity = Math.max(0, Math.floor(item.quantity))
        const approvedQuantity = (typeof item.approved_quantity === 'number' && item.approved_quantity !== null && item.approved_quantity >= 0) ? Math.max(0, Math.floor(item.approved_quantity)) : null
        
        acc[item.id] = approvedQuantity !== null 
          ? approvedQuantity 
          : quantity
        return acc
      }, {} as Record<string, number>)
    } catch (error) {
      console.error('Error initializing item quantities:', error)
      return {}
    }
  })

  // Validate request data on mount
  useEffect(() => {
    if (!request || !request.request_items) return
    
    // Validate request structure
    if (!request?.request_items?.length) {
      return
    }
    
    try {
      const validatedQuantities = request.request_items.reduce((acc, item) => {
        if (!item?.id || !item.quantity) return acc
        
        const quantity = typeof item.quantity === 'number' ? item.quantity : 0
        const approvedQuantity = (typeof item.approved_quantity === 'number' && 
          item.approved_quantity !== null && 
          item.approved_quantity >= 0) ? item.approved_quantity : null
        
        acc[item.id] = approvedQuantity !== null ? approvedQuantity : quantity
        return acc
      }, {} as Record<string, number>)
      
      setItemQuantities(validatedQuantities)
    } catch (error) {
      console.error('Error validating request data:', error)
    }
  }, [request])

  const isManager = user?.role === 'gestor' || user?.role === 'administrador'
  const isRequester = user?.id === request?.requester_id
  const canManage = isManager && request?.status === 'pending'
  const canProcess = isManager && request?.status === 'approved'
  const canDeliver = isManager && request?.status === 'processing'
  const canConfirmReceipt = isRequester && request?.status === 'delivered'
  const canComplete = isManager && request?.status === 'processing'
  const canCancel = (user?.id === request?.requester_id || isManager) &&
    ['pending', 'approved'].includes(request.status)

  const handleAction = async () => {
    if (!action) return

    try {
      setLoading(true)
      let updatedRequest: Request

      switch (action) {
        case 'approve':
          updatedRequest = await requestService.approve(request.id, itemQuantities, reason)
          break
        case 'reject':
          updatedRequest = await requestService.reject(request.id, reason)
          break
        case 'cancel':
          updatedRequest = await requestService.cancel(request.id, reason)
          break
        case 'deliver':
          updatedRequest = await requestService.markAsDelivered(request.id, reason)
          break
        case 'confirm_receipt':
          updatedRequest = await requestService.confirmReceipt(request.id, reason)
          break
        default:
          return
      }

      onUpdate(updatedRequest)
      setShowDialog(false)
      setReason('')
    } catch (error) {
      console.error('Error performing action:', error)
    } finally {
      setLoading(false)
      setAction(null)
    }
  }

  const handleProcessing = async () => {
    try {
      setLoading(true)
      const updatedRequest = await requestService.startProcessing(request.id)
      onUpdate(updatedRequest)
    } catch (error) {
      console.error('Error starting processing:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleDeliver = async () => {
    try {
      setLoading(true)
      setAction('deliver')
      setShowDialog(true)
    } catch (error) {
      console.error('Error initiating delivery:', error)
      setLoading(false)
    }
  }

  const handleConfirmReceipt = async () => {
    try {
      setLoading(true)
      setAction('confirm_receipt')
      setShowDialog(true)
    } catch (error) {
      console.error('Error initiating receipt confirmation:', error)
      setLoading(false)
    }
  }

  const handleComplete = async () => {
    try {
      setLoading(true)
      const updatedRequest = await requestService.complete(request.id)
      onUpdate(updatedRequest)
    } catch (error) {
      console.error('Error completing request:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      <div className="flex items-center gap-2">
        {/* Approve/Reject Actions */}
        {canManage && (
          <>
            <Button
              size="sm"
              className="bg-green-500 hover:bg-green-600 text-white"
              onClick={async () => {
                try {
                  setLoading(true)
                  const updatedRequest = await requestService.approve(request.id, itemQuantities, '')
                  onUpdate(updatedRequest)
                } catch (error) {
                  console.error('Error approving:', error)
                } finally {
                  setLoading(false)
                }
              }}
              disabled={loading}
            >
              <CheckCircle2 className="w-4 h-4 mr-2" />
              Aprovar
            </Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => {
                setAction('reject')
                setShowDialog(true)
              }}
              disabled={loading}
            >
              <XCircle className="w-4 h-4 mr-2" />
              Rejeitar
            </Button>
          </>
        )}

        {/* Process Action */}
        {canProcess && (
          <Button
            size="sm"
            className="bg-blue-500 hover:bg-blue-600 text-white"
            onClick={handleProcessing}
            disabled={loading}
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            Iniciar Processamento
          </Button>
        )}

        {/* Deliver Action */}
        {canDeliver && (
          <Button
            size="sm"
            className="bg-orange-500 hover:bg-orange-600 text-white"
            onClick={handleDeliver}
            disabled={loading}
          >
            <Truck className="w-4 h-4 mr-2" />
            Marcar como Entregue
          </Button>
        )}

        {/* Confirm Receipt Action */}
        {canConfirmReceipt && (
          <Button
            size="sm"
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
            onClick={handleConfirmReceipt}
            disabled={loading}
          >
            <PackageCheck className="w-4 h-4 mr-2" />
            Confirmar Recebimento
          </Button>
        )}

        {/* Complete Action */}
        {canComplete && (
          <Button
            size="sm"
            className="bg-emerald-500 hover:bg-emerald-600 text-white"
            onClick={handleComplete}
            disabled={loading}
          >
            <CheckSquare className="w-4 h-4 mr-2" />
            Concluir
          </Button>
        )}

        {/* Cancel Action */}
        {canCancel && (
          <Button
            size="sm"
            variant="outline"
            className="text-gray-600 hover:text-gray-700"
            onClick={() => {
              setAction('cancel')
              setShowDialog(true)
            }}
            disabled={loading}
          >
            <Ban className="w-4 h-4 mr-2" />
            Cancelar
          </Button>
        )}

        {/* Loading Indicator */}
        {loading && (
          <Loader2 className="w-5 h-5 text-primary-500 animate-spin" />
        )}
      </div>

      {/* Action Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-2xl bg-white">
          <DialogHeader className="border-b pb-4">
            <DialogTitle className={`text-xl font-semibold ${
              action === 'approve' ? 'text-green-600' :
              action === 'reject' ? 'text-red-600' :
              action === 'deliver' ? 'text-orange-600' :
              action === 'confirm_receipt' ? 'text-emerald-600' :
              'text-gray-600'
            }`}>
              {action === 'approve' && 'Aprovar Solicitação'}
              {action === 'reject' && 'Rejeitar Solicitação'}
              {action === 'cancel' && 'Cancelar Solicitação'}
              {action === 'deliver' && 'Marcar como Entregue'}
              {action === 'confirm_receipt' && 'Confirmar Recebimento'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-6 py-4">
            {/* Comments/Reason */}
            <div className="space-y-2">
              <Label className="text-base font-medium text-gray-900">
                {action === 'approve' && 'Comentários (opcional)'}
                {action === 'reject' && 'Motivo da Rejeição'}
                {action === 'cancel' && 'Motivo do Cancelamento'}
                {action === 'deliver' && 'Observações sobre a Entrega (opcional)'}
                {action === 'confirm_receipt' && 'Observações sobre o Recebimento (opcional)'}
              </Label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full min-h-[100px] p-3 rounded-lg border border-gray-200 text-sm bg-white text-gray-900 focus:ring-2 focus:ring-primary-500 focus:border-transparent"
                placeholder={
                  action === 'approve'
                    ? 'Adicione um comentário...'
                    : action === 'deliver'
                    ? 'Adicione observações sobre a entrega...'
                    : action === 'confirm_receipt'
                    ? 'Adicione observações sobre o recebimento...'
                    : 'Descreva o motivo...'
                }
              />
            </div>
          </div>

          <DialogFooter className="border-t pt-4">
            <Button
              variant="outline"
              onClick={() => {
                setShowDialog(false)
                setReason('')
                setAction(null)
              }}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleAction}
              disabled={loading || (['reject', 'cancel'].includes(action || '') && !reason.trim())}
              className={`px-6 ${
                action === 'approve'
                  ? 'bg-green-500 hover:bg-green-600 text-white'
                  : action === 'reject'
                  ? 'bg-red-500 hover:bg-red-600 text-white'
                  : action === 'deliver'
                  ? 'bg-orange-500 hover:bg-orange-600 text-white'
                  : action === 'confirm_receipt'
                  ? 'bg-emerald-500 hover:bg-emerald-600 text-white'
                  : 'bg-gray-500 hover:bg-gray-600 text-white'
              }`}
            >
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {action === 'approve' && 'Aprovar'}
              {action === 'reject' && 'Rejeitar'}
              {action === 'cancel' && 'Cancelar'}
              {action === 'deliver' && 'Marcar como Entregue'}
              {action === 'confirm_receipt' && 'Confirmar Recebimento'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}