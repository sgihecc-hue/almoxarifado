import { useState, useEffect } from 'react'
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
import { usersService } from '@/lib/services/users'
import { departmentsService } from '@/lib/services/departments'
import type { User, UserRole } from '@/lib/types'
import type { Department } from '@/lib/types/departments'

const userSchema = z.object({
  full_name: z
    .string()
    .min(3, 'Nome deve ter no mínimo 3 caracteres'),
  role: z.enum(['solicitante', 'gestor', 'administrador']),
  department_id: z.string().optional(),
})

type UserFormData = z.infer<typeof userSchema>

interface EditUserDialogProps {
  user: User
  open: boolean
  onOpenChange: (open: boolean) => void
  onSuccess: () => void
}

export function EditUserDialog({ user, open, onOpenChange, onSuccess }: EditUserDialogProps) {
  const [loading, setLoading] = useState(false)
  const [departments, setDepartments] = useState<Department[]>([])
  const [loadingDepartments, setLoadingDepartments] = useState(false)
  
  const { register, handleSubmit, formState: { errors } } = useForm<UserFormData>({
    resolver: zodResolver(userSchema),
    defaultValues: {
      full_name: user.full_name,
      role: user.role,
      department_id: user.department_id || '',
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
      console.log('Loading departments for user edit from database...')
      const data = await departmentsService.getAll()
      console.log('Available departments for edit:', data?.length || 0, 'departments')
      setDepartments(data)
      if (!data || data.length === 0) {
        console.warn('No departments available for selection. Check RLS policies.')
      }
    } catch (error) {
      console.error('Error loading departments for edit (check RLS policies):', error)
      setDepartments([]) // Set empty array to prevent undefined issues
    } finally {
      setLoadingDepartments(false)
    }
  }

  const onSubmit = async (data: UserFormData) => {
    try {
      setLoading(true)
      await usersService.update(user.id, {
        full_name: data.full_name,
        role: data.role as UserRole,
        department_id: data.department_id || null,
      })
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error updating user:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Editar Usuário</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
          <div className="space-y-4">
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
            </div>

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
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}