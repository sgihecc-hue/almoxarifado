import { useAuth } from '@/contexts/auth'

export function Profile() {
  const { user } = useAuth()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Meu Perfil</h1>
      <div className="bg-white p-6 rounded-lg shadow space-y-4 max-w-md">
        <div>
          <label className="text-sm text-gray-500">Nome completo</label>
          <p className="font-medium">{user?.full_name}</p>
        </div>
        <div>
          <label className="text-sm text-gray-500">E-mail / login</label>
          <p className="font-medium">{user?.email}</p>
        </div>
        <div>
          <label className="text-sm text-gray-500">Função</label>
          <p className="font-medium capitalize">{user?.role}</p>
        </div>
      </div>
    </div>
  )
}