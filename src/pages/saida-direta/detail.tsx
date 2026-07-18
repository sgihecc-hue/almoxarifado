import { useState, useEffect } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Package2, AlertCircle } from 'lucide-react'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import {
  warehouseDispatchService,
  DISPATCH_TYPE_LABELS,
  type WarehouseDispatchDetail,
} from '@/lib/services/warehouse-dispatch'
import { getErrorMessage } from '@/lib/utils/error-messages'

export function WarehouseDispatchDetailPage() {
  const navigate = useNavigate()
  const { id } = useParams<{ id: string }>()

  const [dispatch, setDispatch] = useState<WarehouseDispatchDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      if (!id) return
      try {
        setLoading(true)
        setError(null)
        const data = await warehouseDispatchService.getById(id)
        if (!cancelled) {
          if (!data) setError('Saída não encontrada.')
          else setDispatch(data)
        }
      } catch (e: any) {
        if (!cancelled) setError(getErrorMessage(e))
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [id])

  const formatDate = (s?: string | null) => {
    if (!s) return '—'
    try {
      return format(new Date(s), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })
    } catch {
      return '—'
    }
  }

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/saida-direta')}
          className="flex items-center justify-center w-10 h-10 rounded-lg border border-gray-200 bg-white hover:bg-gray-50"
          aria-label="Voltar"
        >
          <ArrowLeft className="w-5 h-5 text-gray-600" />
        </button>
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary-100 rounded-lg">
            <Package2 className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Saída Direta {dispatch ? `#${dispatch.dispatch_number}` : ''}
            </h1>
            <p className="text-sm text-gray-500">Detalhes da saída e itens</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-12 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Carregando...
        </div>
      ) : error ? (
        <div className="p-4 rounded-xl bg-red-50 border border-red-200 flex items-center gap-2 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4" /> {error}
        </div>
      ) : dispatch ? (
        <>
          {/* Cabeçalho */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Data</p>
                <p className="text-gray-900">{formatDate(dispatch.created_at)}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Destino</p>
                <p className="text-gray-900">
                  {dispatch.destination_department_name || dispatch.destination_department_text || '—'}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Tipo</p>
                <p className="text-gray-900">
                  {DISPATCH_TYPE_LABELS[dispatch.dispatch_type] || dispatch.dispatch_type}
                </p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Responsável</p>
                <p className="text-gray-900">{dispatch.created_by_name || '—'}</p>
              </div>
              <div>
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Status</p>
                {dispatch.status === 'completed' ? (
                  <span className="px-2 py-1 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Concluída
                  </span>
                ) : (
                  <span className="px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-600 border border-gray-200">
                    Estornada
                  </span>
                )}
              </div>
              {dispatch.status === 'cancelled' && dispatch.cancellation_reason && (
                <div>
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Motivo do estorno</p>
                  <p className="text-gray-900">{dispatch.cancellation_reason}</p>
                </div>
              )}
            </div>
            {dispatch.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Observações</p>
                <p className="text-sm text-gray-700">{dispatch.notes}</p>
              </div>
            )}
          </div>

          {/* Itens */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100">
              <h2 className="text-lg font-semibold text-gray-900">
                Itens da Saída ({dispatch.items.length})
              </h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Código</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Item</th>
                    <th className="px-4 py-3 text-left text-sm font-medium text-gray-600">Unidade</th>
                    <th className="px-4 py-3 text-right text-sm font-medium text-gray-600">Quantidade</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dispatch.items.map((it) => (
                    <tr key={it.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-mono text-gray-500">{it.item_code || '—'}</td>
                      <td className="px-4 py-3 text-sm text-gray-900">{it.item_name}</td>
                      <td className="px-4 py-3 text-sm text-gray-600">{it.item_unit || '—'}</td>
                      <td className="px-4 py-3 text-sm text-right font-medium text-gray-900">{it.quantity}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-gray-50 border-t border-gray-100">
                    <td colSpan={3} className="px-4 py-3 text-sm font-medium text-gray-600 text-right">
                      Total
                    </td>
                    <td className="px-4 py-3 text-sm text-right font-bold text-gray-900">
                      {dispatch.total_quantity ?? 0}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
