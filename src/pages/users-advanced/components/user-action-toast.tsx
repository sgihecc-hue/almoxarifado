import { toast } from 'sonner'
import { CheckCircle2, AlertCircle } from 'lucide-react'

interface ToastProps {
  title: string
  description: string
  type: 'success' | 'error'
}

function showToast({ title, description, type }: ToastProps) {
  const Icon = type === 'success' ? CheckCircle2 : AlertCircle
  const bgColor = type === 'success' ? 'bg-green-50' : 'bg-red-50'
  const textColor = type === 'success' ? 'text-green-600' : 'text-red-600'
  const borderColor = type === 'success' ? 'border-green-200' : 'border-red-200'

  toast(
    <div className={`flex items-start gap-3 p-2 rounded-lg border ${bgColor} ${borderColor}`}>
      <Icon className={`w-5 h-5 mt-0.5 ${textColor}`} />
      <div>
        <p className={`font-medium ${textColor}`}>{title}</p>
        <p className="text-sm text-gray-600">{description}</p>
      </div>
    </div>
  )
}

export const userActionToasts = {
  created: () => showToast({
    title: 'Usuário criado com sucesso',
    description: 'O novo usuário já pode acessar o sistema',
    type: 'success'
  }),
  updated: () => showToast({
    title: 'Usuário atualizado',
    description: 'As alterações foram salvas com sucesso',
    type: 'success'
  }),
  deactivated: () => showToast({
    title: 'Usuário desativado',
    description: 'O usuário não poderá mais acessar o sistema',
    type: 'success'
  }),
  error: (message: string) => showToast({
    title: 'Erro',
    description: message,
    type: 'error'
  })
}