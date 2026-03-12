import { useAuth } from '@/contexts/auth'

export function Profile() {
  const { user } = useAuth()

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Profile</h1>
      <div className="bg-white p-6 rounded-lg shadow space-y-4 max-w-md">
        <div>
          <label className="text-sm text-gray-500">Full Name</label>
          <p className="font-medium">{user?.full_name}</p>
        </div>
        <div>
          <label className="text-sm text-gray-500">Email</label>
          <p className="font-medium">{user?.email}</p>
        </div>
        <div>
          <label className="text-sm text-gray-500">Role</label>
          <p className="font-medium capitalize">{user?.role}</p>
        </div>
      </div>
    </div>
  )
}