import { useState, useEffect } from 'react'
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
import { departmentsService } from '@/lib/services/departments'
import type { UserRole } from '@/lib/types'
import type { Department } from '@/lib/types/departments'

const userSchema = z.object({
  email: z
    .string()
    .email('Digite um e-mail válido'),
  full_name: z
    .string()
    .min(3, 'Nome deve ter no mínimo 3 caracteres'),
  role: z.enum(['solicitante', 'gestor', 'administrador']),
  department_id: z.string().optional(),
  password: z
    .string()
    .min(8, 'A senha deve ter no mínimo 8 caracteres'),
  confirm_password: z.string()
}).refine((data) => data.password === data.confirm_password, {
  message: "As senhas não coincidem",
  path: ["confirm_password"],
})

type UserFormData = z.infer<typeof userSchema>

interface NewUserDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function NewUserDialog({ open, onOpenChange, onSuccess }: NewUserDialogProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [departments, setDepartments] = useState<Department[]>([])
  const [loadingDepartments, setLoadingDepartments] = useState(false)
  
  const { register, handleSubmit, formState: { errors }, reset } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      role: 'solicitante',
    }
  })

  useEffect(() => {
    if (open) {
      loadDepartments()
    }
  }, [open])

  const loadDepartments = async () => {
    try {
      setLoadingDepartments(true)
      console.log('Loading departments from database...')
      const data = await departmentsService.getAll()
      console.log('Departments loaded successfully:', data?.length || 0, 'departments')
      setDepartments(data)
      if (!data || data.length === 0) {
        console.warn('No departments found in database. Check RLS policies.')
      }
    } catch (error) {
      console.error('Error loading departments (check RLS policies):', error)
      setDepartments([]) // Set empty array to prevent undefined issues
    } finally {
      setLoadingDepartments(false)
    }
  }

  const onSubmit = async (data: UserFormData) => {
    try {
      setLoading(true)
      setError(null)
      await usersService.create({
        email: data.email,
        full_name: data.full_name,
        role: data.role as UserRole,
        password: data.password,
        department_id: data.department_id || undefined
      })
      reset()
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error creating user:', error)
      if (error instanceof Error) {
        setError(error.message)
      } else {
        setError('Erro ao criar usuário. Por favor, tente novamente.')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Novo Usuário</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
            {/* Full Name */}
            <div>
              <Label htmlFor="full_name">Nome Completo</Label>
              <Input
                id="full_name"
                {...register('full_name')}
                className="mt-1"
                placeholder="Digite o nome completo"
              />
              {errors.full_name && (
                <p className="text-sm text-red-500 mt-1">{errors.full_name.message}</p>
              )}
            </div>

            {/* Email */}
            <div>
              <Label htmlFor="email">E-mail</Label>
              <Input
                id="email"
                type="email"
                {...register('email')}
                className="mt-1"
                placeholder="nome@email.com"
              />
              {errors.email && (
                <p className="text-sm text-red-500 mt-1">{errors.email.message}</p>
              )}
            </div>

            {/* Role */}
            <div>
              <Label htmlFor="role">Função</Label>
              <select
                id="role"
                {...register('role')}
                className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
              >
                <option value="solicitante">Solicitante</option>
                <option value="gestor">Gestor</option>
                <option value="administrador">Administrador</option>
              </select>
              {errors.role && (
                <p className="text-sm text-red-500 mt-1">{errors.role.message}</p>
              )}
            </div>

            {/* Department */}
            <div>
              <Label htmlFor="department_id">Departamento/Setor</Label>
              {loadingDepartments ? (
                <div className="flex items-center gap-2 mt-1 p-2 border rounded-md">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm text-gray-500">Carregando departamentos...</span>
                </div>
              ) : (
                <select
                  id="department_id"
                  {...register('department_id')}
                  className="w-full mt-1 h-9 rounded-md border border-input px-3 py-1"
                >
                  <option value="">Selecione um departamento</option>
                  {departments.map(dept => (
                    <option key={dept.id} value={dept.id}>
                      {dept.name}
                    </option>
                  ))}
                </select>
              )}
              {errors.department_id && (
                <p className="text-sm text-red-500 mt-1">{errors.department_id.message}</p>
              )}
              {!loadingDepartments && departments.length === 0 && (
                <p className="text-sm text-yellow-600 mt-1">
                  Nenhum departamento encontrado
                </p>
              )}
            </div>

            {/* Password Requirements */}
            <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
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

            {/* Password */}
            <div>
              <Label htmlFor="password">Senha</Label>
              <Input
                id="password"
                type="password"
                {...register('password')}
                className="mt-1"
                placeholder="••••••••"
              />
              {errors.password && (
                <p className="text-sm text-red-500 mt-1">{errors.password.message}</p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <Label htmlFor="confirm_password">Confirmar Senha</Label>
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
              Criar Usuário
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}