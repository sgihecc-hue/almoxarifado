import { useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { departmentsService } from '@/lib/services/departments'
import type { Department } from '@/lib/types/departments'

interface DeleteDepartmentDialogProps {
  department: Department
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function DeleteDepartmentDialog({ 
  department, 
  open, 
  onOpenChange, 
  onSuccess 
}: DeleteDepartmentDialogProps) {
  const [loading, setLoading] = useState(false)

  const handleDelete = async () => {
    try {
      setLoading(true)
      await departmentsService.delete(department.id)
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error deleting department:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            Excluir Setor
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          <p className="text-gray-700">
            Tem certeza que deseja excluir o setor <strong>{department.name}</strong>?
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Esta ação não poderá ser desfeita e todos os dados relacionados a este setor serão perdidos.
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            variant="destructive" 
            onClick={handleDelete}
            disabled={loading}
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            Excluir Setor
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}