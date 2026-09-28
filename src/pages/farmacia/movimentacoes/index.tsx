import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Plus, Loader2, ArrowRightLeft, Eye, Printer, Undo2, AlertTriangle } from 'lucide-react'
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
  pharmacyLoanService,
  LOAN_TYPE_LABELS,
  LOAN_SCOPE_LABELS,
  type LoanSummary,
  type LoanScope,
} from '@/lib/services/pharmacy-loan'
import { getErrorMessage } from '@/lib/utils/error-messages'
import { dataBR } from '@/lib/utils/seguro'

export function PharmacyLoansList({ scope }: { scope: LoanScope }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const canCancel = user?.role === 'administrador' || user?.role === 'gestor'

  const baseRoute = scope === 'pharmacy' ? '/farmacia/movimentacoes' : '/almoxarifado/movimentacoes'

  const [loans, setLoans] = useState<LoanSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const cancelandoRef = useRef(false)

  const [cancelTarget, setCancelTarget] = useState<LoanSummary | null>(null)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState<string | null>(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope])

  async function load() {
    try {
      setLoading(true)
      setLoadError(null)
      const data = await pharmacyLoanService.list(scope)
      setLoans(data)
    } catch (e: any) {
      setLoadError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  // form_date e 'YYYY-MM-DD': new Date() mostrava um dia antes (UTC).
  const formatDate = (s: string | null) => dataBR(s)

  const openCancel = (l: LoanSummary) => {
    setCancelTarget(l)
    setCancelReason('')
    setCancelError(null)
  }

  const confirmCancel = async () => {
    if (!cancelTarget || cancelandoRef.current) return
    cancelandoRef.current = true
    try {
      setCancelling(true)
      setCancelError(null)
      await pharmacyLoanService.cancel(cancelTarget.id, cancelReason)
      setCancelTarget(null)
      await load()
    } catch (e: any) {
      setCancelError(getErrorMessage(e))
    } finally {
      cancelandoRef.current = false
      setCancelling(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 bg-primary-100 rounded-lg">
            <ArrowRightLeft className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">
              Movimentações entre Unidades — {LOAN_SCOPE_LABELS[scope]}</h1>
            <p className="text-sm text-gray-500">
              Empréstimo, devolução, permuta, troca de validade, consignação e doação de itens do estoque de {LOAN_SCOPE_LABELS[scope]}.
            </p>
          </div>
        </div>
        <Button
          onClick={() => navigate(`${baseRoute}/new`)}
          className="bg-primary-500 hover:bg-primary-600 text-white"
        >
          <Plus className="w-4 h-4 mr-2" />
          Nova Movimentação
        </Button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        {loading ? (
          <div className="text-center py-12 text-gray-500">
            <Loader2 className="w-6 h-6 animate-spin inline-block mr-2" /> Carregando...
          </div>
        ) : loadError ? (
          <div className="text-center py-12 text-sm text-red-600">
            {loadError}{' '}
            <button className="underline" onClick={() => load()}>Tentar de novo</button>
          </div>
        ) : loans.length === 0 ? (
          <div className="text-center py-12">
            <ArrowRightLeft className="w-12 h-12 mx-auto text-gray-300 mb-4" />
            <p className="text-gray-500 mb-4">Nenhuma movimentação registrada ainda.</p>
            <Button onClick={() => navigate(`${baseRoute}/new`)}>
              <Plus className="w-4 h-4 mr-2" />
              Registrar primeira movimentação
            </Button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Nº</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Data</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Origem → Destino</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Enviando</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Recebendo</th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Responsável</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-600">Status</th>
                  <th className="px-3 py-2 text-center text-xs font-medium text-gray-600">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {loans.map((l) => (
                  <tr
                    key={l.id}
                    className={`hover:bg-gray-50 ${l.status === 'cancelled' ? 'opacity-60' : ''}`}
                  >
                    <td className="px-3 py-2 text-xs font-mono text-gray-600">#{l.form_number}</td>
                    <td className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap">
                      {formatDate(l.form_date)}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-900">
                      <div className="truncate max-w-[300px]">
                        <span className="text-gray-500">{l.origem}</span>
                        <span className="mx-1 text-gray-400">→</span>
                        <span>{l.destino}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.enviando_type ? (
                        <div>
                          <div className="text-amber-700">{LOAN_TYPE_LABELS[l.enviando_type]}</div>
                          <div className="text-[10px] text-gray-500">
                            {l.enviando_count} itens
                            {l.enviando_total ? ` • R$ ${l.enviando_total.toFixed(2)}` : ''}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs">
                      {l.recebendo_type ? (
                        <div>
                          <div className="text-emerald-700">{LOAN_TYPE_LABELS[l.recebendo_type]}</div>
                          <div className="text-[10px] text-gray-500">
                            {l.recebendo_count} itens
                            {l.recebendo_total ? ` • R$ ${l.recebendo_total.toFixed(2)}` : ''}
                          </div>
                        </div>
                      ) : (
                        <span className="text-gray-300">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-xs text-gray-600">{l.created_by_name || '—'}</td>
                    <td className="px-3 py-2 text-center">
                      {l.status === 'completed' ? (
                        <span className="px-2 py-0.5 text-xs rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                          Concluída
                        </span>
                      ) : (
                        <span
                          className="px-2 py-0.5 text-xs rounded-full bg-gray-100 text-gray-600 border border-gray-200"
                          title={l.cancellation_reason || ''}
                        >
                          Estornada
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <div className="inline-flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`${baseRoute}/${l.id}`)}
                          className="h-8 px-2"
                          title="Ver detalhes"
                        >
                          <Eye className="w-4 h-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => navigate(`${baseRoute}/${l.id}/imprimir`)}
                          className="h-8 px-2"
                          title="Imprimir formulário"
                        >
                          <Printer className="w-4 h-4" />
                        </Button>
                        {l.status === 'completed' && canCancel && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => openCancel(l)}
                            className="text-amber-600 border-amber-200 hover:bg-amber-50 h-8 px-2"
                            title="Estornar"
                          >
                            <Undo2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Estorno */}
      <Dialog open={!!cancelTarget} onOpenChange={(open) => !open && setCancelTarget(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <AlertTriangle className="w-5 h-5" />
              Estornar Movimentação
            </DialogTitle>
          </DialogHeader>

          {cancelTarget && (
            <div className="space-y-4 py-2">
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900">
                <p className="font-medium">Formulário #{cancelTarget.form_number}</p>
                <p className="text-xs mt-1">
                  {cancelTarget.origem} → {cancelTarget.destino}
                </p>
              </div>
              <p className="text-sm text-gray-700">
                O estoque dos itens vinculados será revertido automaticamente.
              </p>
              <div>
                <Label htmlFor="cancel-reason">Motivo do estorno *</Label>
                <textarea
                  id="cancel-reason"
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Ex: Formulário lançado por engano, devolução não efetuada..."
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
