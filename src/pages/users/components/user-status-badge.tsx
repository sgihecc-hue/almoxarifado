import { CheckCircle2, Ban } from 'lucide-react'

interface UserStatusBadgeProps {
  active: boolean
  size?: 'sm' | 'md'
}

export function UserStatusBadge({ active, size = 'sm' }: UserStatusBadgeProps) {
  const Icon = active ? CheckCircle2 : Ban
  const colorClasses = active
    ? 'text-green-600 bg-green-50 border-green-200'
    : 'text-red-600 bg-red-50 border-red-200'
  const sizeClasses = size === 'sm' 
    ? 'px-2.5 py-0.5 text-xs gap-1'
    : 'px-3 py-1 text-sm gap-2'

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${colorClasses} ${sizeClasses}`}>
      <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      <span>{active ? 'Ativo' : 'Inativo'}</span>
    </span>
  )
}