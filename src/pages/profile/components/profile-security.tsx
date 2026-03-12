import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, AlertTriangle, CheckCircle2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usersService } from '@/lib/services/users'
import type { User } from '@/lib/types'

const passwordSchema = z.object({
  current_password: z
    .string()
    .min(1, 'Senha atual é obrigatória'),
  new_password: z
    .string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres'),
  confirm_password: z.string()
}).refine((data) => data.new_password === data.confirm_password, {
  message: "As senhas não coincidem",
  path: ["confirm_password"],
})

type PasswordFormData = z.infer<typeof passwordSchema>

interface ProfileSecurityProps {
  user?: User | null; // Keep the prop even though it's unused
}

export function ProfileSecurity(_props: ProfileSecurityProps) {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<PasswordFormData>({
    resolver: zodResolver(passwordSchema)
  })

  const onSubmit = async (data: PasswordFormData) => {
    try {
      setLoading(true)
      setSuccess(false)
      setError('')

      await usersService.changePassword(
        data.current_password,
        data.new_password
      )

      setSuccess(true)
      reset()

      // Hide success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
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
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Segurança</h2>
        <p className="text-sm text-gray-500 mt-1">
          Mantenha sua conta segura alterando sua senha periodicamente
        </p>
      </div>

      {/* Password Requirements */}
      <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 mb-8">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert className="w-5 h-5 text-blue-600" />
          <h3 className="font-medium text-blue-900">Requisitos de Senha</h3>
        </div>
        <ul className="space-y-1 text-sm text-blue-700">
          <li>• Mínimo de 8 caracteres</li>
          <li>• Pelo menos uma letra maiúscula</li>
          <li>• Pelo menos uma letra minúscula</li>
          <li>• Pelo menos um número</li>
        </ul>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Current Password */}
        <div>
          <Label htmlFor="current_password">Senha Atual</Label>
          <Input
            id="current_password"
            type="password"
            {...register('current_password')}
            className="mt-1"
            placeholder="••••••••"
          />
          {errors.current_password && (
            <p className="text-sm text-red-500 mt-1">{errors.current_password.message}</p>
          )}
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
          <div className="p-4 rounded-lg bg-red-50 border border-red-200">
            <div className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              <p className="font-medium">{error}</p>
            </div>
          </div>
        )}

        {/* Success Message */}
        {success && (
          <div className="p-4 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              <p className="font-medium">Senha alterada com sucesso!</p>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" disabled={loading}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Alterar Senha
        </Button>
      </form>
    </div>
  )
}