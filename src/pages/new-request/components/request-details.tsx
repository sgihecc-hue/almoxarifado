import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { format } from 'date-fns'
import { CheckSquare } from 'lucide-react'
import { departmentsService } from '@/lib/services/departments'
import { useAuth } from '@/contexts/auth'
import type { Department } from '@/lib/types/departments'

// Updated schema to use justification_option instead of justification text
const detailsSchema = z.object({
  department: z.string().min(1, 'Setor solicitante é obrigatório'),
  priority: z.enum(['low', 'medium', 'high']),
  justification_option: z.string().min(1, 'Selecione uma justificativa'),
  requestDate: z.string(),
})

export type RequestDetails = z.infer<typeof detailsSchema>

interface RequestDetailsProps {
  onSubmit: (data: RequestDetails) => void
  defaultValues?: Partial<RequestDetails>
}

// Predefined justification options
const justificationOptions = [
  { id: 'routine', label: 'Reposição de Rotina', description: 'Reposição regular para manter os níveis de estoque' },
  { id: 'increased_demand', label: 'Aumento de Demanda', description: 'Aumento inesperado no consumo do item' },
  { id: 'new_procedure', label: 'Novo Procedimento', description: 'Item necessário para novo procedimento ou serviço' },
  { id: 'critical_level', label: 'Nível Crítico', description: 'Estoque em nível crítico, necessita reposição urgente' },
  { id: 'replacement', label: 'Substituição', description: 'Substituição de item danificado ou vencido' },
  { id: 'special_event', label: 'Evento Especial', description: 'Necessário para evento ou campanha específica' },
  { id: 'emergency', label: 'Emergência', description: 'Situação de emergência ou contingência' },
]

export function RequestDetails({ onSubmit, defaultValues }: RequestDetailsProps) {
  const { user } = useAuth()
  const [loading, setLoading] = useState(true)
  const [userDepartment, setUserDepartment] = useState<Department | null>(null)
  const [loadingUserDepartment, setLoadingUserDepartment] = useState(true)

  const { register, handleSubmit, setValue, formState: { errors } } = useForm<RequestDetails>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      priority: 'medium',
      requestDate: format(new Date(), 'yyyy-MM-dd'),
      ...defaultValues,
    },
  })

  useEffect(() => {
    loadUserDepartment()
  }, [])

  async function loadUserDepartment() {
    try {
      setLoading(true)
      setLoadingUserDepartment(true)

      if (!user?.department_id) {
        setUserDepartment(null)
        return
      }

      const allDepartments = await departmentsService.getAll()
      const department = allDepartments.find(d => d.id === user.department_id)

      if (department) {
        setUserDepartment(department)
        setValue('department', department.id, { shouldValidate: true })
      } else {
        setUserDepartment(null)
      }
    } catch (error) {
      console.error('Error loading user department:', error)
      setUserDepartment(null)
    } finally {
      setLoading(false)
      setLoadingUserDepartment(false)
    }
  }

  if (loading || loadingUserDepartment) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="w-8 h-8 border-4 border-primary-500 border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-500">Carregando informações do usuário...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <form id="requestDetailsForm" onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Request Date */}
        <div className="space-y-2">
          <Label htmlFor="requestDate">Data da Solicitação</Label>
          <Input
            type="date"
            id="requestDate"
            {...register('requestDate')}
            disabled
            className="bg-gray-50 cursor-not-allowed"
          />
        </div>

        {/* Department Selection */}
        <div className="space-y-2">
          <Label htmlFor="department">Setor Solicitante</Label>
          <input
            type="hidden"
            {...register('department')}
          />
          
          {userDepartment ? (
            <div className="p-4 bg-primary-50 rounded-lg border border-primary-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-primary-900">{userDepartment.name}</p>
                  {userDepartment.description && (
                    <p className="text-sm text-primary-700">{userDepartment.description}</p>
                  )}
                </div>
                <span className="px-2 py-1 text-xs font-medium rounded-full bg-primary-100 text-primary-600">
                  Seu Setor
                </span>
              </div>
            </div>
          ) : (
            <div className="p-4 bg-red-50 rounded-lg border border-red-200">
              <div className="space-y-2">
                <p className="text-sm font-medium text-red-800">
                  Departamento não encontrado
                </p>
                <p className="text-sm text-red-700">
                  Seu usuário não possui um departamento associado ou o departamento não foi encontrado.
                  Entre em contato com o administrador para configurar seu departamento.
                </p>
              </div>
            </div>
          )}
          
          {errors.department && (
            <p className="text-sm text-red-500 mt-1">{errors.department.message}</p>
          )}
        </div>

        {/* Priority Selection */}
        <div className="space-y-2">
          <Label>Prioridade</Label>
          <div className="grid grid-cols-3 gap-4">
            <div className="relative">
              <input
                type="radio"
                {...register('priority')}
                value="low"
                id="priority-low"
                className="peer sr-only"
              />
              <label
                htmlFor="priority-low"
                className="flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all peer-checked:border-green-500 peer-checked:bg-green-50 hover:bg-gray-50"
              >
                <span className="font-medium text-sm">Baixa</span>
              </label>
            </div>
            <div className="relative">
              <input
                type="radio"
                {...register('priority')}
                value="medium"
                id="priority-medium"
                className="peer sr-only"
              />
              <label
                htmlFor="priority-medium"
                className="flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all peer-checked:border-yellow-500 peer-checked:bg-yellow-50 hover:bg-gray-50"
              >
                <span className="font-medium text-sm">Média</span>
              </label>
            </div>
            <div className="relative">
              <input
                type="radio"
                {...register('priority')}
                value="high"
                id="priority-high"
                className="peer sr-only"
              />
              <label
                htmlFor="priority-high"
                className="flex items-center justify-center p-3 border-2 rounded-lg cursor-pointer transition-all peer-checked:border-red-500 peer-checked:bg-red-50 hover:bg-gray-50"
              >
                <span className="font-medium text-sm">Alta</span>
              </label>
            </div>
          </div>
          {errors.priority && (
            <p className="text-sm text-red-500">{errors.priority.message}</p>
          )}
        </div>

        {/* Justification Options */}
        <div className="space-y-2">
          <Label htmlFor="justification_option">Justificativa</Label>
          <div className="grid grid-cols-1 gap-3">
            {justificationOptions.map((option) => (
              <div key={option.id} className="relative">
                <input
                  type="radio"
                  id={`justification-${option.id}`}
                  value={option.id}
                  {...register('justification_option')}
                  className="peer sr-only"
                />
                <label
                  htmlFor={`justification-${option.id}`}
                  className="flex items-start gap-3 p-3 border-2 rounded-lg cursor-pointer transition-all peer-checked:border-primary-500 peer-checked:bg-primary-50 hover:bg-gray-50"
                >
                  <div className="flex-shrink-0 h-5 w-5 mt-0.5 border rounded-md peer-checked:bg-primary-500 peer-checked:border-primary-500 flex items-center justify-center">
                    <CheckSquare className="h-4 w-4 text-white peer-checked:opacity-100 opacity-0" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{option.label}</p>
                    <p className="text-sm text-gray-500">{option.description}</p>
                  </div>
                </label>
              </div>
            ))}
          </div>
          {errors.justification_option && (
            <p className="text-sm text-red-500 mt-1">{errors.justification_option.message}</p>
          )}
        </div>
      </form>

      {/* Submit Button */}
      <Button
        type="submit"
        form="requestDetailsForm"
        className="w-full bg-primary-500 hover:bg-primary-600 text-white"
        disabled={!userDepartment}
      >
        Próximo
      </Button>
    </div>
  )
}