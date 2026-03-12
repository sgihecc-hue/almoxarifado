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
import { usersService } from '@/lib/services/users'
import type { User } from '@/lib/types'

interface DeactivateUserDialogProps {
  user: User
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function DeactivateUserDialog({ user, open, onOpenChange, onSuccess }: DeactivateUserDialogProps) {
  const [loading, setLoading] = useState(false)

  const handleDeactivate = async () => {
    try {
      setLoading(true)
      await usersService.deactivate(user.id)
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error deactivating user:', error)
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
            {user.deleted_at ? 'Reativar Usuário' : 'Desativar Usuário'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          <p className="text-gray-700">
            {user.deleted_at ? (
              <>
                Tem certeza que deseja reativar o usuário <strong>{user.full_name}</strong>?
                O usuário poderá acessar o sistema novamente após a reativação.
              </>
            ) : (
              <>
                Tem certeza que deseja desativar o usuário <strong>{user.full_name}</strong>?
                O usuário não poderá mais acessar o sistema após a desativação.
              </>
            )}
          </p>
          <p className="text-sm text-gray-500 mt-2">
            {user.deleted_at
              ? 'Esta ação pode ser revertida posteriormente.'
              : 'Esta ação pode ser revertida posteriormente.'
            }
          </p>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button 
            variant={user.deleted_at ? 'default' : 'destructive'}
            onClick={handleDeactivate}
            disabled={loading}
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {user.deleted_at ? 'Reativar Usuário' : 'Desativar Usuário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}