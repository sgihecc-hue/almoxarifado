import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, CheckCircle2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { usersService } from '@/lib/services/users'
import { UserRoleBadge } from '../../users/components/user-role-badge'
import type { User } from '@/lib/types'

const profileSchema = z.object({
  full_name: z
    .string()
    .min(3, 'Nome deve ter no mínimo 3 caracteres'),
})

type ProfileFormData = z.infer<typeof profileSchema>

interface ProfileDetailsProps {
  user: User
}

export function ProfileDetails({ user }: ProfileDetailsProps) {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)
  
  const { register, handleSubmit, formState: { errors, isDirty } } = useForm<ProfileFormData>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      full_name: user.full_name,
    }
  })

  const onSubmit = async (data: ProfileFormData) => {
    try {
      setLoading(true)
      setSuccess(false)
      await usersService.update(user.id, data)
      setSuccess(true)
      
      // Hide success message after 3 seconds
      setTimeout(() => setSuccess(false), 3000)
    } catch (error) {
      console.error('Error updating profile:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="max-w-2xl">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-gray-900">Informações Pessoais</h2>
        <p className="text-sm text-gray-500 mt-1">
          Atualize suas informações pessoais e dados de contato
        </p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Email (read-only) */}
        <div>
          <Label htmlFor="email">E-mail</Label>
          <Input
            id="email"
            type="email"
            value={user.email}
            disabled
            className="mt-1 bg-gray-50"
          />
          <p className="text-sm text-gray-500 mt-1">
            O e-mail não pode ser alterado
          </p>
        </div>

        {/* Full Name */}
        <div>
          <Label htmlFor="full_name">Nome Completo</Label>
          <Input
            id="full_name"
            {...register('full_name')}
            className="mt-1"
            placeholder="Digite seu nome completo"
          />
          {errors.full_name && (
            <p className="text-sm text-red-500 mt-1">{errors.full_name.message}</p>
          )}
        </div>

        {/* Role (read-only) */}
        <div>
          <Label>Função</Label>
          <div className="mt-1">
            <UserRoleBadge role={user.role} size="md" />
          </div>
          <p className="text-sm text-gray-500 mt-1">
            A função é definida pelo administrador do sistema
          </p>
        </div>

        {/* Success Message */}
        {success && (
          <div className="p-4 rounded-lg bg-green-50 border border-green-200">
            <div className="flex items-center gap-2 text-green-600">
              <CheckCircle2 className="w-5 h-5" />
              <p className="font-medium">Perfil atualizado com sucesso!</p>
            </div>
          </div>
        )}

        {/* Submit Button */}
        <Button type="submit" disabled={loading || !isDirty}>
          {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
          Salvar Alterações
        </Button>
      </form>
    </div>
  )
}