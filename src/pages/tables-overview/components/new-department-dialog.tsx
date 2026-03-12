import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
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
import { departmentsService } from '@/lib/services/departments'

const departmentSchema = z.object({
  name: z.string().min(3, 'Nome deve ter no mínimo 3 caracteres'),
  description: z.string().optional(),
})

type DepartmentFormData = z.infer<typeof departmentSchema>

interface NewDepartmentDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function NewDepartmentDialog({ open, onOpenChange, onSuccess }: NewDepartmentDialogProps) {
  const [loading, setLoading] = useState(false)

  const { register, handleSubmit, formState: { errors }, reset } = useForm<DepartmentFormData>({
    resolver: zodResolver(departmentSchema)
  })

  const onSubmit = async (data: DepartmentFormData) => {
    try {
      setLoading(true)
      await departmentsService.create(data)
      reset()
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error creating department:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Novo Setor</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            {/* Name */}
            <div>
              <Label htmlFor="name">Nome do Setor</Label>
              <Input
                id="name"
                {...register('name')}
                className="mt-1"
                placeholder="Digite o nome do setor"
              />
              {errors.name && (
                <p className="text-sm text-red-500 mt-1">{errors.name.message}</p>
              )}
            </div>

            {/* Description */}
            <div>
              <Label htmlFor="description">Descrição (opcional)</Label>
              <Input
                id="description"
                {...register('description')}
                className="mt-1"
                placeholder="Digite uma descrição para o setor"
              />
              {errors.description && (
                <p className="text-sm text-red-500 mt-1">{errors.description.message}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Criar Setor
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}