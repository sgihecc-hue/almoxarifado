import { useState, useEffect, useRef } from 'react'
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
import { ErroCarregamento } from '@/components/ui/erro-carregamento'
import type { User, UserRole } from '@/lib/types'
import type { Department } from '@/lib/types/departments'

const userSchema = z.object({
  full_name: z
    .string()
    .min(3, 'Nome deve ter no mínimo 3 caracteres'),
  role: z.enum(['solicitante', 'atendente', 'pharmacist', 'gestor', 'administrador']),
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
  const [erroSetores, setErroSetores] = useState<unknown>(null)
  const [erroSalvar, setErroSalvar] = useState<string | null>(null)
  const salvandoRef = useRef(false)
  
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
      setErroSetores(null)
      const data = await departmentsService.getAll()
      setDepartments(data)
    } catch (error) {
      // Sem a lista, o campo Setor ficaria vazio e SALVAR tiraria o setor do
      // usuário: mostra o erro e bloqueia o salvar até carregar.
      console.error('Error loading departments for edit:', error)
      setErroSetores(error)
    } finally {
      setLoadingDepartments(false)
    }
  }

  const onSubmit = async (data: UserFormData) => {
    if (salvandoRef.current || erroSetores) return
    salvandoRef.current = true
    try {
      setLoading(true)
      setErroSalvar(null)
      await usersService.update(user.id, {
        full_name: data.full_name,
        role: data.role as UserRole,
        department_id: data.department_id || null,
      })
      onSuccess()
      onOpenChange(false)
    } catch (error) {
      console.error('Error updating user:', error)
      setErroSalvar(error instanceof Error ? error.message : 'Não foi possível salvar as alterações.')
    } finally {
      salvandoRef.current = false
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
                <option value="atendente">Atendente</option>
                <option value="pharmacist">Farmacêutico</option>
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
              <ErroCarregamento className="mt-2" titulo="Não foi possível carregar os setores." erro={erroSetores} onTentar={loadDepartments} />
              {!loadingDepartments && !erroSetores && departments.length === 0 && (
                <p className="text-sm text-yellow-600 mt-1">
                  Nenhum departamento encontrado
                </p>
              )}
            </div>
          </div>

          {erroSalvar && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{erroSalvar}</div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" disabled={loading || loadingDepartments || !!erroSetores}>
              {loading && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Salvar Alterações
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}