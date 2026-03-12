import { useState } from 'react'
import { Loader2, Trash2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { itemsService } from '@/lib/services/items'
import type { Item } from '@/lib/services/items'
import { toast } from 'sonner'

interface DeleteItemDialogProps {
  item: Item
  type: 'pharmacy' | 'warehouse'
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

const DELETE_PASSWORD = 'coruja'

export function DeleteItemDialog({
  item,
  type,
  open,
  onOpenChange,
  onSuccess
}: DeleteItemDialogProps) {
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleDelete = async () => {
    setError(null)

    if (password !== DELETE_PASSWORD) {
      setError('Senha incorreta')
      return
    }

    try {
      setLoading(true)
      await itemsService.delete(item.id, type)
      toast.success('Item excluido com sucesso')
      setPassword('')
      onOpenChange(false)
      onSuccess()
    } catch (err) {
      console.error('Error deleting item:', err)
      setError('Erro ao excluir item. Tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleClose = (isOpen: boolean) => {
    if (!isOpen) {
      setPassword('')
      setError(null)
    }
    onOpenChange(isOpen)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-red-600">
            <AlertTriangle className="w-5 h-5" />
            Excluir Item
          </DialogTitle>
          <DialogDescription>
            Esta acao e irreversivel. O item sera permanentemente removido do sistema.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm text-red-800 font-medium mb-1">
              Item a ser excluido:
            </p>
            <p className="text-sm text-red-700">
              <span className="font-mono">{item.code}</span> - {item.name}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="delete-password">
              Digite a senha para confirmar a exclusao
            </Label>
            <Input
              id="delete-password"
              type="password"
              placeholder="Digite a senha..."
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                setError(null)
              }}
              className={error ? 'border-red-500' : ''}
            />
            {error && (
              <p className="text-sm text-red-500">{error}</p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            disabled={loading}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleDelete}
            disabled={loading || !password}
            className="bg-red-600 hover:bg-red-700"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Excluindo...
              </>
            ) : (
              <>
                <Trash2 className="w-4 h-4 mr-2" />
                Excluir Item
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
