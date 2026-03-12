import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, ShieldAlert } from 'lucide-react'
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
import { usersService } from '@/lib/services/users'
import type { User } from '@/lib/types'

const passwordSchema = z.object({
  new_password: z
    .string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres'),
  confirm_password: z.string()
}).refine((data) => data.new_password === data.confirm_password, {
  message: "As senhas não coincidem",
  path: ["confirm_password"],
})

type PasswordFormData = z.infer<typeof passwordSchema>

interface ChangePasswordDialogProps {
  user: User
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function ChangePasswordDialog({ user, open, onOpenChange, onSuccess }: ChangePasswordDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema)
  })

  const onSubmit = async (data: PasswordFormData) => {
    try {
      setLoading(true)
      setError('')

      await usersService.adminChangePassword(user.id, data.new_password)

      reset()
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error changing password:', error)
      if (error instanceof Error) {
        setError(error.message)
      } else {
        setError('Erro ao alterar senha')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Alterar Senha do Usuário</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          {/* User Info */}
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-blue-900">Alteração de Senha</h3>
            </div>
            <p className="text-sm text-blue-700">
              Você está alterando a senha do usuário <strong>{user.full_name}</strong>.
              A nova senha será enviada para o e-mail {user.email}.
            </p>
          </div>

          <div className="space-y-4">
            {/* Password Requirements */}
            <div>
              <Label>Requisitos de Senha</Label>
              <ul className="mt-1 space-y-1 text-sm text-gray-500">
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  Mínimo de 8 caracteres
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  Pelo menos uma letra maiúscula
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  Pelo menos uma letra minúscula
                </li>
                <li className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
                  Pelo menos um número
                </li>
              </ul>
            </div>

            {/* New Password */}
            <div>
              <Label htmlFor="new_password">Nova Senha</Label>
              <Input
                id="new_password"
                type="password"
                {...register('new_password')}
                className="mt-1"
                placeholder="••••••••"
              />
              {errors.new_password && (
                <p className="text-sm text-red-500 mt-1">{errors.new_password.message}</p>
              )}
            </div>

            {/* Confirm New Password */}
            <div>
              <Label htmlFor="confirm_password">Confirmar Nova Senha</Label>
              <Input
                id="confirm_password"
                type="password"
                {...register('confirm_password')}
                className="mt-1"
                placeholder="••••••••"
              />
              {errors.confirm_password && (
                <p className="text-sm text-red-500 mt-1">{errors.confirm_password.message}</p>
              )}
            </div>

            {/* Error Message */}
            {error && (
              <div className="p-3 text-sm text-red-500 bg-red-50 rounded-md">
                {error}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Alterar Senha
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}