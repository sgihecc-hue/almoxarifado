import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Calendar as CalendarIcon, Loader2 } from 'lucide-react'
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
import { format } from 'date-fns'

const periodSchema = z.object({
  startDate: z.string().min(1, 'Data inicial é obrigatória'),
  endDate: z.string().min(1, 'Data final é obrigatória'),
}).refine((data) => {
  const start = new Date(data.startDate)
  const end = new Date(data.endDate)
  return start <= end
}, {
  message: "Data inicial deve ser menor ou igual à data final",
  path: ["endDate"]
})

type PeriodFormData = z.infer<typeof periodSchema>

interface PeriodFilterDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onFilter: (startDate: Date, endDate: Date) => void
  defaultStartDate?: Date
  defaultEndDate?: Date
}

export function PeriodFilterDialog({ 
  open, 
  onOpenChange, 
  onFilter,
  defaultStartDate = new Date(),
  defaultEndDate = new Date()
}: PeriodFilterDialogProps) {
  const [loading, setLoading] = useState(false)
  
  const { register, handleSubmit, formState: { errors } } = useForm<PeriodFormData>({
    resolver: zodResolver(periodSchema),
    defaultValues: {
      startDate: format(defaultStartDate, 'yyyy-MM-dd'),
      endDate: format(defaultEndDate, 'yyyy-MM-dd')
    }
  })

  const onSubmit = async (data: PeriodFormData) => {
    try {
      setLoading(true)
      const startDate = new Date(data.startDate)
      const endDate = new Date(data.endDate)
      
      // Set time to start and end of day
      startDate.setHours(0, 0, 0, 0)
      endDate.setHours(23, 59, 59, 999)
      
      onFilter(startDate, endDate)
      onOpenChange(false)
    } catch (error) {
      console.error('Error applying period filter:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Filtrar por Período</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            {/* Start Date */}
            <div>
              <Label htmlFor="startDate">Data Inicial</Label>
              <div className="relative mt-1">
                <CalendarIcon className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  id="startDate"
                  type="date"
                  {...register('startDate')}
                  className="pl-9"
                />
              </div>
              {errors.startDate && (
                <p className="text-sm text-red-500 mt-1">{errors.startDate.message}</p>
              )}
            </div>

            {/* End Date */}
            <div>
              <Label htmlFor="endDate">Data Final</Label>
              <div className="relative mt-1">
                <CalendarIcon className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
                <Input
                  id="endDate"
                  type="date"
                  {...register('endDate')}
                  className="pl-9"
                />
              </div>
              {errors.endDate && (
                <p className="text-sm text-red-500 mt-1">{errors.endDate.message}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Aplicar Filtro
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}