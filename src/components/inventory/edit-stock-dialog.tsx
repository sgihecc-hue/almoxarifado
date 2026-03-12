import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Lock, Edit, AlertTriangle, CheckCircle2 } from 'lucide-react'
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
import { Switch } from '@/components/ui/switch'
import { itemsService } from '@/lib/services/items'
import type { Item } from '@/lib/services/items'

const passwordSchema = z.object({
  password: z.string().min(1, 'Senha é obrigatória'),
})

const stockEditSchema = z.object({
  new_stock: z.number().min(0, 'Estoque deve ser maior ou igual a 0'),
  reason: z.string().min(5, 'Motivo deve ter pelo menos 5 caracteres'),
  is_active: z.boolean(),
})

type PasswordFormData = z.infer<typeof passwordSchema>
type StockEditFormData = z.infer<typeof stockEditSchema>

interface EditStockDialogProps {
  item: Item
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function EditStockDialog({ 
  item, 
  open, 
  onOpenChange, 
  onSuccess 
}: EditStockDialogProps) {
  const [step, setStep] = useState<'password' | 'edit'>('password')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const passwordForm = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema)
  })
  
  const stockForm = useForm<StockEditFormData>({
    resolver: zodResolver(stockEditSchema),
    defaultValues: {
      new_stock: item.current_stock,
      reason: '',
      is_active: item.is_active ?? true
    }
  })

  const handlePasswordSubmit = async (data: PasswordFormData) => {
    try {
      setError(null)
      
      // Verificar se a senha é "coruja"
      if (data.password !== 'coruja') {
        setError('Senha incorreta. Acesso negado.')
        return
      }
      
      // Avançar para o próximo passo
      setStep('edit')
      passwordForm.reset()
    } catch (error) {
      console.error('Error validating password:', error)
      setError('Erro ao validar senha')
    }
  }

  const handleStockEdit = async (data: StockEditFormData) => {
    try {
      setLoading(true)
      setError(null)

      // Determine the type based on item category
      const itemType = item.category === 'Medicamentos' || item.category === 'Material Hospitalar'
        ? 'pharmacy'
        : 'warehouse'

      // Atualizar o estoque e status ativo
      await itemsService.update(item.id, {
        current_stock: data.new_stock,
        is_active: data.is_active
      }, itemType)

      // Criar entrada no histórico de auditoria
      // Isso será feito automaticamente pelos triggers do banco de dados

      onSuccess()
      onOpenChange(false)
      resetDialog()
    } catch (error) {
      console.error('Error updating stock:', error)
      setError('Erro ao atualizar estoque. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const resetDialog = () => {
    setStep('password')
    setError(null)
    passwordForm.reset()
    stockForm.reset({
      new_stock: item.current_stock,
      reason: '',
      is_active: item.is_active ?? true
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

        {step === 'password' && (
          <form onSubmit={passwordForm.handleSubmit(handlePasswordSubmit)} className="space-y-6">
            <div className="p-4 bg-amber-50 rounded-lg border border-amber-200">
              <div className="flex items-center gap-2 mb-2">
                <Lock className="w-5 h-5 text-amber-600" />
                <h3 className="font-medium text-amber-900">Acesso Restrito</h3>
              </div>
              <p className="text-sm text-amber-700">
                Esta funcionalidade requer uma senha especial. Apenas administradores autorizados podem editar o estoque diretamente.
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <Label htmlFor="password">Senha de Acesso</Label>
                <Input
                  id="password"
                  type="password"
                  {...passwordForm.register('password')}
                  className="mt-1"
                  placeholder="Digite a senha especial"
                  autoFocus
                />
                {passwordForm.formState.errors.password && (
                  <p className="text-sm text-red-500 mt-1">
                    {passwordForm.formState.errors.password.message}
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
              <Button type="submit">
                <Lock className="w-4 h-4 mr-2" />
                Verificar Senha
              </Button>
            </DialogFooter>
          </form>
        )}

        {step === 'edit' && (
          <form onSubmit={stockForm.handleSubmit(handleStockEdit)} className="space-y-6">
            <div className="p-4 bg-green-50 rounded-lg border border-green-200">
              <div className="flex items-center gap-2 mb-2">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
                <h3 className="font-medium text-green-900">Acesso Autorizado</h3>
              </div>
              <p className="text-sm text-green-700">
                Você pode agora editar o estoque do item. Todas as alterações serão registradas no histórico.
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
                    (stockForm.watch('new_stock') || 0) - item.current_stock > 0 
                      ? 'text-green-600' 
                      : (stockForm.watch('new_stock') || 0) - item.current_stock < 0
                        ? 'text-red-600'
                        : 'text-gray-600'
                  }`}>
                    {(stockForm.watch('new_stock') || 0) - item.current_stock > 0 && '+'}
                    {(stockForm.watch('new_stock') || 0) - item.current_stock} {item.unit}
                  </span>
                </div>
              </div>

              {/* Status Ativo/Inativo */}
              <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="is_active" className="text-base font-medium">
                      Status do Item
                    </Label>
                    <p className="text-sm text-gray-600 mt-1">
                      {stockForm.watch('is_active')
                        ? 'Item ativo e visível nas listagens'
                        : 'Item inativo e oculto das listagens'}
                    </p>
                  </div>
                  <Switch
                    id="is_active"
                    checked={stockForm.watch('is_active')}
                    onCheckedChange={(checked) => stockForm.setValue('is_active', checked)}
                  />
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <div className={`w-3 h-3 rounded-full ${
                    stockForm.watch('is_active') ? 'bg-green-500' : 'bg-red-500'
                  }`} />
                  <span className={`text-sm font-medium ${
                    stockForm.watch('is_active') ? 'text-green-700' : 'text-red-700'
                  }`}>
                    {stockForm.watch('is_active') ? 'ATIVO' : 'INATIVO'}
                  </span>
                </div>
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