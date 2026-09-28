import { useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { usersService, usuarioAtivo } from '@/lib/services/users'
import type { User } from '@/lib/types'

interface DeactivateUserDialogProps {
  user: User
  open: boolean
  onOpenChange: (open: boolean) => void
  /** ativo = situação NOVA do usuário; aviso = algo ficou pendente (ver usersService.setActive). */
  onSuccess: (resultado: { ativo: boolean; aviso?: string }) => void
}

export function DeactivateUserDialog({ user, open, onOpenChange, onSuccess }: DeactivateUserDialogProps) {
  const [loading, setLoading] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const travaRef = useRef(false)
  // Situação pelo is_active E pelo deleted_at (antes só deleted_at, e o
  // "Reativar" chamava a função de DESATIVAR).
  const ativo = usuarioAtivo(user)

  const handleConfirm = async () => {
    if (travaRef.current) return
    travaRef.current = true
    setLoading(true)
    setErro(null)
    try {
      const { aviso } = await usersService.setActive(user.id, !ativo)
      onSuccess({ ativo: !ativo, aviso })
      onOpenChange(false)
    } catch (error) {
      console.error('Error changing user status:', error)
      setErro(error instanceof Error ? error.message : 'Não foi possível alterar o usuário.')
    } finally {
      travaRef.current = false
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!loading) { setErro(null); onOpenChange(o) } }}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle className={`flex items-center gap-2 ${ativo ? 'text-red-600' : 'text-emerald-700'}`}>
            <AlertTriangle className="w-5 h-5" />
            {ativo ? 'Desativar Usuário' : 'Reativar Usuário'}
          </DialogTitle>
        </DialogHeader>

        <div className="py-6">
          <p className="text-gray-700">
            {ativo ? (
              <>
                Tem certeza que deseja desativar o usuário <strong>{user.full_name}</strong>?
                Ele não conseguirá mais entrar no sistema.
              </>
            ) : (
              <>
                Tem certeza que deseja reativar o usuário <strong>{user.full_name}</strong>?
                Ele poderá entrar no sistema novamente.
              </>
            )}
          </p>
          <p className="text-sm text-gray-500 mt-2">Esta ação pode ser revertida depois.</p>
          {erro && (
            <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{erro}</div>
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={loading}>
            Cancelar
          </Button>
          <Button
            variant={ativo ? 'destructive' : 'default'}
            onClick={handleConfirm}
            disabled={loading}
          >
            {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {ativo ? 'Desativar Usuário' : 'Reativar Usuário'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
