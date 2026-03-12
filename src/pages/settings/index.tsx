import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { 
  Settings as SettingsIcon, User, Shield, 
  Loader2
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { useAuth } from '@/contexts/auth'

interface SettingsProps {
  initialTab?: string
}

export function Settings({ initialTab = 'profile' }: SettingsProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState(initialTab)

  useEffect(() => {
    if (initialTab) {
      setActiveTab(initialTab)
    }
  }, [initialTab])

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 text-primary-500 animate-spin" />
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-primary-100 rounded-lg">
            <SettingsIcon className="w-6 h-6 text-primary-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Configurações</h1>
            <p className="text-sm text-gray-500 mt-1">
              Gerencie suas preferências e configurações do sistema
            </p>
          </div>
        </div>
      </div>

      {/* Settings Tabs */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-2 gap-4">
              <TabsTrigger value="profile" className="flex items-center gap-2">
                <User className="w-4 h-4" />
                Perfil
              </TabsTrigger>
              <TabsTrigger value="security" className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                Segurança
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="p-6">
            <TabsContent value="profile">
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900">Configurações de Perfil</h2>
                <p className="text-sm text-gray-500">
                  Gerencie suas informações pessoais e preferências de conta
                </p>
                
                <Button 
                  onClick={() => navigate('/profile/advanced')}
                  className="mt-4"
                >
                  Ir para Configurações de Perfil
                </Button>
              </div>
            </TabsContent>

            <TabsContent value="security">
              <div className="space-y-6">
                <h2 className="text-lg font-semibold text-gray-900">Configurações de Segurança</h2>
                <p className="text-sm text-gray-500">
                  Gerencie sua senha e configurações de segurança da conta
                </p>
                
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
                  <p className="text-sm text-yellow-700">
                    As configurações de segurança estão disponíveis na página de perfil avançado.
                  </p>
                  <Button 
                    variant="outline" 
                    onClick={() => navigate('/profile/advanced')}
                    className="mt-2"
                  >
                    Ir para Perfil Avançado
                  </Button>
                </div>
              </div>
            </TabsContent>
          </div>
        </Tabs>
      </div>

      {/* System Information */}
      {(user.role === 'administrador' || user.role === 'gestor') && (
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Informações do Sistema</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg">
                  <SettingsIcon className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Versão do Sistema</p>
                  <p className="font-medium">1.0.0</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg">
                  <User className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Última Atualização</p>
                  <p className="font-medium">01/04/2025</p>
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-gray-100 rounded-lg">
                  <Shield className="w-5 h-5 text-gray-600" />
                </div>
                <div>
                  <p className="text-sm text-gray-500">Status do Servidor</p>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-green-500"></span>
                    <p className="font-medium">Online</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}