import { useState } from 'react'
import { Undo2, Loader2, AlertCircle, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'

interface EstornoItem {
  request_item_id: string
  warehouse_item_id: string
  name: string
  unit?: string
  delivered: number
}

/**
 * Estorno de itens de uma solicitação de ALMOXARIFADO entregue.
 * Isolado da farmácia: só é renderizado para requests type='warehouse' e
 * devolve ao estoque via RPC estornar_item_almox (mexe só em warehouse_items).
 */
export function WarehouseEstorno({
  requestId,
  items,
  onDone,
}: {
  requestId: string
  items: EstornoItem[]
  onDone?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [qty, setQty] = useState<Record<string, number | ''>>({})
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const returnable = items.filter((it) => (it.delivered || 0) > 0 && it.warehouse_item_id)

  const reset = () => {
    setReason('')
    setQty({})
    setError(null)
    setDone(false)
  }

  const totalToReturn = returnable.reduce((acc, it) => {
    const v = Number(qty[it.request_item_id] || 0)
    return acc + (v > 0 ? v : 0)
  }, 0)

  const handleSubmit = async () => {
    setError(null)
    if (reason.trim().length < 3) {
      setError('Informe o motivo do estorno (mínimo 3 caracteres).')
      return
    }
    const toReturn = returnable
      .map((it) => ({ it, q: Number(qty[it.request_item_id] || 0) }))
      .filter(({ q }) => q > 0)

    if (toReturn.length === 0) {
      setError('Informe a quantidade devolvida de pelo menos um item.')
      return
    }
    for (const { it, q } of toReturn) {
      if (q > it.delivered) {
        setError(`Quantidade devolvida de "${it.name}" não pode exceder o entregue (${it.delivered}).`)
        return
      }
    }

    try {
      setSubmitting(true)
      for (const { it, q } of toReturn) {
        const { data, error: rpcError } = await supabase.rpc('estornar_item_almox', {
          p_request_id: requestId,
          p_warehouse_item_id: it.warehouse_item_id,
          p_quantity: q,
          p_reason: reason.trim(),
        })
        if (rpcError) throw rpcError
        const res = data as { success?: boolean; error?: string } | null
        if (!res?.success) throw new Error(res?.error || 'Falha no estorno')
      }
      setDone(true)
      onDone?.()
    } catch (e: any) {
      setError(getErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  if (returnable.length === 0) return null

  return (
    <>
      <div className="bg-white rounded-xl shadow-sm border border-amber-200 p-4 print:hidden">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Undo2 className="w-5 h-5 text-amber-600" />
            <div>
              <p className="font-medium text-gray-900">Estorno de item devolvido</p>
              <p className="text-sm text-gray-500">
                Algum item entregue retornou? Registre a devolução e ele volta ao estoque do almoxarifado.
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            onClick={() => { reset(); setOpen(true) }}
            className="text-amber-700 border-amber-300 hover:bg-amber-50 flex-shrink-0"
          >
            <Undo2 className="w-4 h-4 mr-2" />
            Estornar item
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset() }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-amber-700">
              <Undo2 className="w-5 h-5" />
              Estornar itens devolvidos
            </DialogTitle>
          </DialogHeader>

          {done ? (
            <div className="py-6 text-center space-y-2">
              <CheckCircle2 className="w-10 h-10 text-emerald-500 mx-auto" />
              <p className="font-medium text-gray-900">Estorno registrado!</p>
              <p className="text-sm text-gray-500">O estoque do almoxarifado foi atualizado.</p>
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <p className="text-sm text-gray-600">
                Informe a quantidade devolvida de cada item. O valor não pode passar do que foi entregue.
              </p>

              <div className="space-y-2 max-h-64 overflow-y-auto">
                {returnable.map((it) => (
                  <div key={it.request_item_id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-200">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{it.name}</p>
                      <p className="text-xs text-gray-500">Entregue: {it.delivered} {it.unit || ''}</p>
                    </div>
                    <input
                      type="number"
                      min={0}
                      max={it.delivered}
                      value={qty[it.request_item_id] ?? ''}
                      onChange={(e) => {
                        const raw = e.target.value
                        setQty((prev) => ({
                          ...prev,
                          [it.request_item_id]: raw === '' ? '' : Math.max(0, Math.min(it.delivered, Number(raw))),
                        }))
                      }}
                      placeholder="0"
                      className="w-24 rounded-md border border-input bg-white px-3 py-2 text-sm text-right"
                    />
                  </div>
                ))}
              </div>

              <div>
                <Label htmlFor="estorno-reason">Motivo do estorno *</Label>
                <textarea
                  id="estorno-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Ex: Setor devolveu itens não utilizados..."
                  rows={2}
                  className="mt-1 w-full rounded-md border border-input bg-white px-3 py-2 text-sm"
                />
              </div>

              {error && (
                <div className="p-2 rounded bg-red-50 border border-red-200 flex items-center gap-2 text-sm text-red-700">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            {done ? (
              <Button onClick={() => { setOpen(false); reset() }}>Fechar</Button>
            ) : (
              <>
                <Button variant="outline" onClick={() => setOpen(false)} disabled={submitting}>
                  Cancelar
                </Button>
                <Button
                  onClick={handleSubmit}
                  disabled={submitting || totalToReturn <= 0 || reason.trim().length < 3}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  {submitting && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                  Confirmar estorno ({totalToReturn})
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
