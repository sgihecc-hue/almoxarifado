import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Edit, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { supabase } from '@/lib/supabase'
import { getErrorMessage } from '@/lib/utils/error-messages'
import type { Item } from '@/lib/services/items'

const CONFIRM_WORD = 'EDITAR'

const stockEditSchema = z.object({
  new_stock: z.number({ invalid_type_error: 'Informe o novo estoque' })
    .int('Informe uma quantidade inteira (sem casas decimais).')
    .min(0, 'Estoque deve ser maior ou igual a 0'),
  // a RPC almox_editar_item exige motivo com pelo menos 10 caracteres
  reason: z.string().trim().min(10, 'Motivo deve ter pelo menos 10 caracteres'),
})

type StockEditFormData = z.infer<typeof stockEditSchema>

interface EditStockDialogProps {
  item: Item
  // Tipo do CATALOGO vindo da pagina. Antes o tipo era adivinhado pela
  // categoria e 252 de 293 itens da farmacia caiam em 'warehouse': o update
  // ia para a tabela errada, afetava 0 linhas e a tela dizia "sucesso".
  type: 'pharmacy' | 'warehouse'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function EditStockDialog({
  item,
  type,
  open,
  onOpenChange,
  onSuccess
}: EditStockDialogProps) {
  const [step, setStep] = useState<'confirm' | 'edit'>('confirm')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmText, setConfirmText] = useState('')
  const salvandoRef = useRef(false)

  const stockForm = useForm<StockEditFormData>({
    resolver: zodResolver(stockEditSchema),
    defaultValues: {
      new_stock: item.current_stock,
      reason: '',
    }
  })

  const watchedNewStock = stockForm.watch('new_stock')
  const stockDifference = (watchedNewStock || 0) - item.current_stock

  const handleConfirm = () => {
    if (confirmText.trim().toUpperCase() !== CONFIRM_WORD) {
      setError(`Digite "${CONFIRM_WORD}" para confirmar.`)
      return
    }
    setError(null)
    setStep('edit')
    setConfirmText('')
  }

  const handleStockEdit = async (data: StockEditFormData) => {
    if (salvandoRef.current) return
    // Farmacia: saldo e por local (item_stocks) e so muda por movimento
    // (entrada, saida, ajuste) — gravar um numero absoluto aqui furaria o livro.
    if (type !== 'warehouse') {
      setError('Na farmácia o saldo só muda por movimento (entrada, saída ou ajuste). Use a tela de movimentações.')
      return
    }
    if (data.new_stock === item.current_stock) {
      setError('O novo estoque é igual ao atual. Nada para salvar.')
      return
    }
    salvandoRef.current = true
    try {
      setLoading(true)
      setError(null)

      // Grava pela RPC auditada do almox (a mesma do "Editar Item"): confere
      // permissao, exige motivo e registra antes/depois + motivo em
      // almox_item_edicoes. Antes: update direto em warehouse_items, sem
      // motivo gravado e sem conferir se alguma linha foi alterada.
      const { error: rpcErr } = await supabase.rpc('almox_editar_item', {
        p_item_id: item.id,
        p_campos: { current_stock: data.new_stock },
        p_motivo: data.reason.trim(),
      })
      if (rpcErr) throw rpcErr

      onSuccess()
      onOpenChange(false)
      resetDialog()
    } catch (error: any) {
      console.error('Error updating stock:', error)
      setError(getErrorMessage(error))
    } finally {
      salvandoRef.current = false
      setLoading(false)
    }
  }

  const resetDialog = () => {
    setStep('confirm')
    setError(null)
    setConfirmText('')
    stockForm.reset({
      new_stock: item.current_stock,
      reason: '',
    })
  }

  const handleClose = () => {
    resetDialog()
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Edit className="w-5 h-5" />
            Editar Estoque - {item.name}
          </DialogTitle>
        </DialogHeader>

        {step === 'confirm' && (
          <div className="space-y-6">
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <ShieldAlert className="w-5 h-5 text-amber-600" />
                <h3 className="font-medium text-amber-900">Confirmação Necessária</h3>
              </div>
              <p className="text-sm text-amber-700">
                Você está prestes a editar o estoque diretamente. Esta ação altera a quantidade atual do item.
              </p>
            </div>

            <div className="space-y-3">
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                <p style={{ color: '#666' }}>Item: <strong>{item.name}</strong></p>
                <p style={{ color: '#666' }}>Estoque atual: <strong>{item.current_stock} {item.unit}</strong></p>
              </div>
              <div>
                <Label htmlFor="confirm-text">
                  Digite <strong className="text-red-600">{CONFIRM_WORD}</strong> para continuar
                </Label>
                <Input
                  id="confirm-text"
                  value={confirmText}
                  onChange={(e) => { setConfirmText(e.target.value); if (error) setError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleConfirm() }}
                  className="mt-1"
                  placeholder={CONFIRM_WORD}
                  autoFocus
                />
              </div>

              {error && (
                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle className="w-5 h-5" />
                    <p className="font-medium">{error}</p>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button
                type="button"
                onClick={handleConfirm}
                disabled={confirmText.trim().toUpperCase() !== CONFIRM_WORD}
              >
                Confirmar
              </Button>
            </DialogFooter>
          </div>
        )}

        {step === 'edit' && (
          <form onSubmit={stockForm.handleSubmit(handleStockEdit)} className="space-y-6">
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <h3 className="font-medium text-green-900">Edição Autorizada</h3>
              </div>
              <p className="text-sm text-green-700">
                Informe o novo estoque e o motivo. A alteração fica registrada no histórico de edições do item (antes/depois, quem e por quê).
              </p>
            </div>

            <div className="space-y-4">
              {/* Current Stock Info */}
              <div className="p-4 bg-blue-50 rounded-lg border border-blue-100">
                <h3 className="text-sm font-medium text-blue-900 mb-2">Informações Atuais</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <span className="text-blue-700">Estoque Atual:</span>
                    <span className="font-medium text-blue-900 ml-2">
                      {item.current_stock} {item.unit}
                    </span>
                  </div>
                  <div>
                    <span className="text-blue-700">Estoque Mínimo:</span>
                    <span className="font-medium text-blue-900 ml-2">
                      {item.min_stock} {item.unit}
                    </span>
                  </div>
                </div>
              </div>

              {/* New Stock */}
              <div>
                <Label htmlFor="new_stock">Novo Estoque</Label>
                <div className="flex items-center gap-2 mt-1">
                  <Input
                    id="new_stock"
                    type="number"
                    min="0"
                    {...stockForm.register('new_stock', { valueAsNumber: true })}
                    className="flex-1"
                    autoFocus
                  />
                  <span className="text-sm text-gray-500 font-medium">
                    {item.unit}
                  </span>
                </div>
                {stockForm.formState.errors.new_stock && (
                  <p className="text-sm text-red-500 mt-1">
                    {stockForm.formState.errors.new_stock.message}
                  </p>
                )}
              </div>

              {/* Difference Display */}
              <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-gray-600">Diferença:</span>
                  <span className={`text-sm font-medium ${
                    stockDifference > 0
                      ? 'text-green-600'
                      : stockDifference < 0
                        ? 'text-red-600'
                        : 'text-gray-600'
                  }`}>
                    {stockDifference > 0 && '+'}
                    {stockDifference} {item.unit}
                  </span>
                </div>
                {stockDifference > 0 && (
                  <p className="text-xs text-amber-700 mt-2 bg-amber-50 border border-amber-200 rounded p-2">
                    💡 Para entradas com NF/AFM, prefira o botão <strong>"Registrar Entrada"</strong>. Use esta tela para <strong>correções manuais</strong> de estoque.
                  </p>
                )}
              </div>

              {/* Reason */}
              <div>
                <Label htmlFor="reason">Motivo da Alteração</Label>
                <textarea
                  id="reason"
                  {...stockForm.register('reason')}
                  className="w-full mt-1 rounded-md border border-input px-3 py-2 min-h-[100px]"
                  placeholder="Descreva o motivo da alteração do estoque..."
                />
                {stockForm.formState.errors.reason && (
                  <p className="text-sm text-red-500 mt-1">
                    {stockForm.formState.errors.reason.message}
                  </p>
                )}
              </div>

              {error && (
                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                  <div className="flex items-center gap-2 text-red-700">
                    <AlertTriangle className="w-5 h-5" />
                    <p className="font-medium">{error}</p>
                  </div>
                </div>
              )}
            </div>

            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>
                Cancelar
              </Button>
              <Button type="submit" disabled={loading}>
                {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Salvar Alteração
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}
