import { Shield, Users, UserPlus } from 'lucide-react'
import type { UserRole } from '@/lib/types'

interface UserRoleBadgeProps {
  role: UserRole
  size?: 'sm' | 'md'
}

export function UserRoleBadge({ role, size = 'sm' }: UserRoleBadgeProps) {
  const getRoleColor = (role: UserRole) => {
    switch (role) {
      case 'administrador':
        return 'text-purple-600 bg-purple-50 border-purple-200'
      case 'gestor':
        return 'text-blue-600 bg-blue-50 border-blue-200'
      case 'solicitante':
        return 'text-green-600 bg-green-50 border-green-200'
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200'
    }
  }

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'administrador':
        return Shield
      case 'gestor':
        return Users
      case 'solicitante':
        return UserPlus
      default:
        return Shield
    }
  }

  const Icon = getRoleIcon(role)
  const colorClasses = getRoleColor(role)
  const sizeClasses = size === 'sm' 
    ? 'px-2.5 py-0.5 text-xs gap-1'
    : 'px-3 py-1 text-sm gap-2'

  return (
    <span className={`inline-flex items-center rounded-full border font-medium ${colorClasses} ${sizeClasses}`}>
      <Icon className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      <span className="capitalize">{role}</span>
    </span>
  )
}