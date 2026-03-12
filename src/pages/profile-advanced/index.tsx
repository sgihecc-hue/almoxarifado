import { useState } from 'react'
import { useAuth } from '@/contexts/auth'
import { 
  User, Mail, Calendar, 
  Key, Loader2
} from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { ProfileDetails } from '../profile/components/profile-details'
import { ProfileSecurity } from '../profile/components/profile-security'
import { UserRoleBadge } from '../users/components/user-role-badge'

export function ProfileAdvanced() {
  const { user } = useAuth()
  const [activeTab, setActiveTab] = useState('details')

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando perfil...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-start gap-6">
          {/* Avatar */}
          <div className="relative group">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary-500 to-primary-600 flex items-center justify-center text-white">
              <span className="text-3xl font-semibold">
                {user.full_name.charAt(0).toUpperCase()}
              </span>
            </div>
          </div>

          {/* User Info */}
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900">{user.full_name}</h1>
              <UserRoleBadge role={user.role} size="md" />
            </div>

            <div className="flex items-center gap-6 mt-4">
              <div className="flex items-center gap-2 text-gray-500">
                <Mail className="w-4 h-4" />
                <span>{user.email}</span>
              </div>
              <div className="flex items-center gap-2 text-gray-500">
                <Calendar className="w-4 h-4" />
                <span>
                  Membro desde {format(new Date(user.created_at), "MMMM 'de' yyyy", { locale: ptBR })}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Sections */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-2 gap-4">
              <TabsTrigger value="details" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Dados Pessoais
              </TabsTrigger>
              <TabsTrigger value="security" className="flex items-center gap-2">
                <Key className="w-4 h-4" />
                Segurança
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-6">
            <TabsContent value="details">
              <ProfileDetails user={user} />
            </TabsContent>

            <TabsContent value="security">
              <ProfileSecurity user={user} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  )
}