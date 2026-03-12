import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, Settings, Calculator } from 'lucide-react'
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
import { itemsService } from '@/lib/services/items'
import type { Item } from '@/lib/services/items'

const stockConfigSchema = z.object({
  min_stock: z.number().min(0, 'Estoque mínimo deve ser maior ou igual a 0'),
  avg_consumption: z.number().min(0, 'Consumo médio deve ser maior ou igual a 0'),
  reorder_point: z.number().min(0, 'Ponto de pedido deve ser maior ou igual a 0'),
  lead_time_days: z.number().min(1, 'Prazo de entrega deve ser pelo menos 1 dia'),
  safety_factor: z.number().min(1, 'Fator de segurança deve ser pelo menos 1'),
  use_calculated_values: z.boolean().default(true),
})

type StockConfigFormData = z.infer<typeof stockConfigSchema>

interface StockConfigDialogProps {
  item: Item
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function StockConfigDialog({ 
  item, 
  open, 
  onOpenChange, 
  onSuccess 
}: StockConfigDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [systemAvgConsumption, setSystemAvgConsumption] = useState<number>(0)
  const [calculatedReorderPoint, setCalculatedReorderPoint] = useState<number>(0)
  
  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<StockConfigFormData>({
    resolver: zodResolver(stockConfigSchema),
    defaultValues: {
      min_stock: item.min_stock,
      avg_consumption: 0, // Will be set after calculation
      reorder_point: 0, // Will be set after calculation
      lead_time_days: item.lead_time_days || 7,
      safety_factor: 1.5,
      use_calculated_values: true,
    }
  })

  // Calculate average consumption from history
  useEffect(() => {
    if (item.consumption_history?.length) {
      const totalConsumption = item.consumption_history.reduce((acc, curr) => acc + curr.quantity, 0)
      const avgMonthlyConsumption = totalConsumption / item.consumption_history.length
      const roundedAvg = Math.round(avgMonthlyConsumption * 100) / 100
      setSystemAvgConsumption(roundedAvg)
      setValue('avg_consumption', roundedAvg)
    } else {
      setSystemAvgConsumption(0)
      setValue('avg_consumption', 0)
    }
  }, [item, setValue])

  // Watch form values to calculate reorder point
  const avgConsumption = watch('avg_consumption')
  const leadTimeDays = watch('lead_time_days')
  const safetyFactor = watch('safety_factor')
  const useCalculatedValues = watch('use_calculated_values')

  // Calculate reorder point whenever inputs change
  useEffect(() => {
    // Formula: Reorder Point = (Average Daily Consumption × Lead Time) × Safety Factor
    const avgDailyConsumption = avgConsumption / 30 // Convert monthly to daily
    const reorderPoint = Math.ceil((avgDailyConsumption * leadTimeDays) * safetyFactor)
    setCalculatedReorderPoint(reorderPoint)
    
    if (useCalculatedValues) {
      setValue('reorder_point', reorderPoint)
    }
  }, [avgConsumption, leadTimeDays, safetyFactor, useCalculatedValues, setValue])

  const onSubmit = async (data: StockConfigFormData) => {
    try {
      setLoading(true)
      setError(null)
      
      const type = item.category === 'Medicamentos' || item.category === 'Material Hospitalar' 
        ? 'pharmacy' 
        : 'warehouse'
      
      // In a real implementation, you would also update the avg_consumption and reorder_point
      // in the database. For now, we'll just update min_stock and lead_time_days.
      await itemsService.update(item.id, {
        min_stock: data.min_stock,
        lead_time_days: data.lead_time_days,
      }, type)
      
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error updating stock configuration:', error)
      setError('Erro ao atualizar configuração de estoque. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings className="w-5 h-5" />
            Configuração de Estoque
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          {/* Current Consumption Info */}
          <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
            <h3 className="text-sm font-medium text-blue-900 mb-3">Informações Atuais</h3>
            <div className="grid grid-cols-1 gap-2 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-700">Consumo Médio Mensal (Sistema):</span>
                <span className="text-sm font-medium text-blue-900">{systemAvgConsumption} {item.unit}/mês</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-700">Consumo Médio Diário (Sistema):</span>
                <span className="text-sm font-medium text-blue-900">{(systemAvgConsumption / 30).toFixed(2)} {item.unit}/dia</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-blue-700">Estoque Atual:</span>
                <span className="text-sm font-medium text-blue-900">{item.current_stock} {item.unit}</span>
              </div>
            </div>
          </div>

          {/* Use Calculated Values Switch */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <Label htmlFor="use_calculated_values" className="text-base font-medium">Usar Valores Calculados</Label>
              <p className="text-xs text-gray-500">
                Desative para configurar manualmente o consumo médio e ponto de pedido
              </p>
            </div>
            <div className="flex-shrink-0">
              <input
                type="checkbox"
                id="use_calculated_values"
                {...register('use_calculated_values')}
                className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Minimum Stock */}
            <div>
              <Label htmlFor="min_stock">Estoque Mínimo</Label>
              <Input
                id="min_stock"
                type="number"
                min="0"
                {...register('min_stock', { valueAsNumber: true })}
                className="mt-1"
              />
              {errors.min_stock && (
                <p className="text-sm text-red-500 mt-1">{errors.min_stock.message}</p>
              )}
            </div>

            {/* Average Consumption */}
            <div>
              <Label htmlFor="avg_consumption">Consumo Médio Mensal</Label>
              <Input
                id="avg_consumption"
                type="number"
                min="0"
                step="0.01"
                {...register('avg_consumption', { valueAsNumber: true })}
                className="mt-1"
                disabled={useCalculatedValues}
              />
              {errors.avg_consumption && (
                <p className="text-sm text-red-500 mt-1">{errors.avg_consumption.message}</p>
              )}
            </div>

            {/* Lead Time */}
            <div>
              <Label htmlFor="lead_time_days">Prazo de Entrega (dias)</Label>
              <Input
                id="lead_time_days"
                type="number"
                min="1"
                {...register('lead_time_days', { valueAsNumber: true })}
                className="mt-1"
              />
              {errors.lead_time_days && (
                <p className="text-sm text-red-500 mt-1">{errors.lead_time_days.message}</p>
              )}
            </div>

            {/* Safety Factor */}
            <div>
              <Label htmlFor="safety_factor">Fator de Segurança</Label>
              <Input
                id="safety_factor"
                type="number"
                min="1"
                step="0.1"
                {...register('safety_factor', { valueAsNumber: true })}
                className="mt-1"
                disabled={!useCalculatedValues}
              />
              {errors.safety_factor && (
                <p className="text-sm text-red-500 mt-1">{errors.safety_factor.message}</p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {/* Reorder Point */}
            <div>
              <Label htmlFor="reorder_point">Ponto de Pedido</Label>
              <Input
                id="reorder_point"
                type="number"
                min="0"
                {...register('reorder_point', { valueAsNumber: true })}
                className="mt-1"
                disabled={useCalculatedValues}
              />
              {errors.reorder_point && (
                <p className="text-sm text-red-500 mt-1">{errors.reorder_point.message}</p>
              )}
            </div>
          </div>

          {/* Calculated Reorder Point */}
          {useCalculatedValues && (
            <div className="p-3 bg-green-50 rounded-lg border border-green-100">
              <div className="flex items-start gap-2">
                <Calculator className="w-5 h-5 text-green-600 mt-0.5" />
                <div>
                  <h3 className="text-sm font-medium text-green-900">Valores Calculados</h3>
                  <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
                    <div>
                      <span className="text-green-700">Consumo Diário:</span>
                      <span className="font-medium text-green-900 ml-1">{(avgConsumption / 30).toFixed(2)} {item.unit}/dia</span>
                    </div>
                    <div>
                      <span className="text-green-700">Ponto de Pedido:</span>
                      <span className="font-medium text-green-900 ml-1">{calculatedReorderPoint} {item.unit}</span>
                    </div>
                  </div>
                  <p className="text-xs text-green-700 mt-2">
                    Fórmula: (Consumo Diário × Prazo de Entrega) × Fator de Segurança
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md">
              {error}
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar Configuração
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}