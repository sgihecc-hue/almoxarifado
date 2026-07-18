import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Loader2, Package2, Undo2, AlertTriangle } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useAuth } from '@/contexts/auth'
import {
  warehouseDispatchService,
  DISPATCH_TYPE_LABELS,
  type WarehouseDispatchSummary,
} from '@/lib/services/warehouse-dispatch'
import { getErrorMessage } from '@/lib/utils/error-messages'

export function WarehouseDispatchList() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canCancel = user?.role === 'administrador' || user?.role === 'gestor'

  const [dispatches, setDispatches] = useState<WarehouseDispatchSummary[]>([])
  const [loading, setLoading] = useState(true)

  // Estorno
  const [cancelTarget, setCancelTarget] = useState<WarehouseDispatchSummary | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  async function load() {
    try {
      setLoading(true)
      const data = await warehouseDispatchService.list()
      setDispatches(data)
    } finally {
      setLoading(false)
    }
  }

  const formatDate = (s: string) => {
    try {
      return format(new Date(s), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    } catch {
      return '-'
    }
  }

  const openCancel = (d: WarehouseDispatchSummary) => {
    setCancelTarget(d)
    setCancelReason('')
    setCancelError(null)
  }

  const confirmCancel = async () => {
    if (!cancelTarget) return
    try {
      setCancelling(true)
      setCancelError(null)
      await warehouseDispatchService.cancel(cancelTarget.id, cancelReason)
      setCancelTarget(null)
      await load()
    } catch (e: any) {
      setCancelError(getErrorMessage(e))
    } finally {
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary-100 rounded-lg">
            <Package2 className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Saídas Diretas — Almoxarifado</h1>
            <p className="text-sm text-gray-500">
              Saídas registradas sem solicitação prévia. O estoque é abatido automaticamente no momento do registro.
            </p>
          </div>
        </div>
        <Button
          onClick={() => navigate('/saida-direta/new')}
          className="bg-primary-500 hover:bg-primary-600 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nova Saída
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Carregando...
          </div>
        ) : dispatches.length === 0 ? (
          <div className="text-center py-12">
            <Package2 className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 mb-4">Nenhuma saída direta registrada ainda.</p>
            <Button onClick={() => navigate('/saida-direta/new')}>
              <Plus className="w-4 h-4 mr-2" />
              Registrar primeira saída
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Nº</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Data</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Destino</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Tipo</th>
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Responsável</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Itens</th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Qtd total</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-center text-sm font-medium text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dispatches.map((d) => (
                  <tr
                    key={d.id}
                    onClick={() => navigate(`/saida-direta/${d.id}`)}
                    className={`hover:bg-gray-50 cursor-pointer ${d.status === 'cancelled' ? 'opacity-60' : ''}`}
                  >
                    <td className="px-4 py-3 text-sm font-mono text-gray-600">
                      #{d.dispatch_number}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{formatDate(d.created_at)}</td>
                    <td className="px-4 py-3 text-sm text-gray-900">
                      {d.destination_department_name || d.destination_department_text || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700">
                      {DISPATCH_TYPE_LABELS[d.dispatch_type] || d.dispatch_type}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {d.created_by_name || '—'}
                    </td>
                    <td className="px-4 py-3 text-sm text-right text-gray-600">
                      {d.items_count ?? 0}
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">
                      {d.total_quantity ?? 0}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {d.status === 'completed' ? (
                        <span className="px-2 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Concluída
                        </span>
                      ) : (
                        <span
                          className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600 border border-gray-200"
                          title={d.cancellation_reason || ''}
                        >
                          Estornada
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {d.status === 'completed' && canCancel ? (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={(e) => { e.stopPropagation(); openCancel(d) }}
                          className="text-amber-600 border-amber-200 hover:bg-amber-50 h-8 px-2"
                          title="Estornar saída (devolve o estoque)"
                        >
                          <Undo2 className="w-4 h-4 mr-1" />
                          Estornar
                        </Button>
                      ) : (
                        <span className="text-xs text-gray-400">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Dialog de estorno */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              Estornar Saída
            </DialogTitle>
          </DialogHeader>

          {cancelTarget && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
                <p className="font-medium">Saída #{cancelTarget.dispatch_number}</p>
                <p className="text-xs mt-1">
                  Destino: {cancelTarget.destination_department_name || cancelTarget.destination_department_text || '—'}
                </p>
                <p className="text-xs">
                  Itens: {cancelTarget.items_count} • Qtd total: {cancelTarget.total_quantity}
                </p>
              </div>

              <p className="text-sm text-gray-700">
                Ao estornar, <strong>todo o estoque desta saída será devolvido</strong> automaticamente ao almoxarifado. Esta ação não pode ser desfeita.
              </p>

              <div>
                <Label htmlFor="cancel-reason">Motivo do estorno *</Label>
                <textarea
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Ex: Saída registrada por engano, item devolvido pela área..."
                  rows={3}
                  className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                />
              </div>

              {cancelError && (
                <div className="p-2 rounded bg-red-50 border border-red-200 text-sm text-red-700">
                  {cancelError}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
              Cancelar
            </Button>
            <Button
              onClick={confirmCancel}
              disabled={cancelling || cancelReason.trim().length < 3}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {cancelling && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Confirmar Estorno
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
