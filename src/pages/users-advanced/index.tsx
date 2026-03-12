import { useState, useEffect } from 'react'
import { 
  Users, Download, Plus, Filter, 
  Shield, Mail, Calendar, Activity,
  CheckCircle2, Ban, Loader2, Search,
  Key, Edit, 
  AlertTriangle, Building2, UserPlus
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { format } from 'date-fns'
import { ptBR } from 'date-fns/locale'
import { usersService } from '@/lib/services/users'
import { UserRoleBadge } from '../users/components/user-role-badge'
import { UserStatusBadge } from '../users/components/user-status-badge'
import { NewUserDialog } from './components/new-user-dialog.tsx'
import { EditUserDialog } from './components/edit-user-dialog.tsx'
import { ChangePasswordDialog } from './components/change-password-dialog.tsx'
import { DeactivateUserDialog } from './components/deactivate-user-dialog.tsx'
import { userActionToasts } from './components/user-action-toast.tsx'
import type { User, UserRole } from '@/lib/types'

export function UsersAdvanced() {
  const [users, setUsers] = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [roleFilter, setRoleFilter] = useState<'all' | UserRole>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all')
  const [activeTab, setActiveTab] = useState<'all' | 'active' | 'inactive'>('all')
  
  // Dialog states
  const [showNewUserDialog, setShowNewUserDialog] = useState(false)
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [showEditDialog, setShowEditDialog] = useState(false)
  const [showPasswordDialog, setShowPasswordDialog] = useState(false)
  const [showDeactivateDialog, setShowDeactivateDialog] = useState(false)

  useEffect(() => {
    loadUsers()
  }, [])

  async function loadUsers() {
    try {
      setLoading(true)
      setError(null)
      const data = await usersService.getAll()
      setUsers(data)
    } catch (error) {
      console.error('Error loading users:', error)
      setError('Erro ao carregar usuários. Por favor, tente novamente.')
    } finally {
      setLoading(false)
    }
  }

  const handleExport = async () => {
    try {
      const csvContent = await usersService.exportToCSV(filteredUsers)
      
      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const link = document.createElement('a')
      const url = URL.createObjectURL(blob)
      
      link.setAttribute('href', url)
      link.setAttribute('download', `usuarios_${format(new Date(), 'dd-MM-yyyy')}.csv`)
      link.style.visibility = 'hidden'
      
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
    } catch (error) {
      console.error('Error exporting users:', error)
      userActionToasts.error('Erro ao exportar usuários')
    }
  }

  const getUserStats = () => {
    const total = users.length
    const active = users.filter(u => !u.deleted_at).length
    const inactive = users.filter(u => u.deleted_at).length
    const admins = users.filter(u => u.role === 'administrador' && !u.deleted_at).length
    const managers = users.filter(u => u.role === 'gestor' && !u.deleted_at).length
    const requesters = users.filter(u => u.role === 'solicitante' && !u.deleted_at).length

    return { total, active, inactive, admins, managers, requesters }
  }

  const filteredUsers = users.filter(user => {
    const matchesSearch = searchTerm === '' || 
      user.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      user.email.toLowerCase().includes(searchTerm.toLowerCase())
    
    const matchesRole = roleFilter === 'all' || user.role === roleFilter
    
    const matchesStatus = statusFilter === 'all' || 
      (statusFilter === 'active' && !user.deleted_at) ||
      (statusFilter === 'inactive' && user.deleted_at)

    const matchesTab = activeTab === 'all' || 
      (activeTab === 'active' && !user.deleted_at) ||
      (activeTab === 'inactive' && user.deleted_at)

    return matchesSearch && matchesRole && matchesStatus && matchesTab
  })

  const handleEditUser = (user: User) => {
    setSelectedUser(user)
    setShowEditDialog(true)
  }

  const handleChangePassword = (user: User) => {
    setSelectedUser(user)
    setShowPasswordDialog(true)
  }

  const handleDeactivateUser = (user: User) => {
    setSelectedUser(user)
    setShowDeactivateDialog(true)
  }

  const stats = getUserStats()

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Carregando usuários...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
          <p className="text-red-500 mb-4">{error}</p>
          <Button onClick={loadUsers}>Tentar Novamente</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
            <div className="p-3 bg-primary-100 rounded-lg">
              <Users className="w-6 h-6 text-primary-600" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Gestão de Usuários</h1>
              <p className="text-sm text-gray-500 mt-1">
                Gerencie os usuários do sistema de forma avançada
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleExport}
            >
              <Download className="w-4 h-4 mr-2" />
              Exportar
            </Button>
            <Button 
              className="bg-primary-500 hover:bg-primary-600 text-white"
              onClick={() => setShowNewUserDialog(true)}
            >
              <Plus className="w-4 h-4 mr-2" />
              Novo Usuário
            </Button>
          </div>
        </div>

        {/* Quick Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-primary-100 rounded-lg">
                <Activity className="w-5 h-5 text-primary-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Total</p>
                <p className="text-lg font-semibold text-gray-900">{stats.total}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-green-100 rounded-lg">
                <CheckCircle2 className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Ativos</p>
                <p className="text-lg font-semibold text-gray-900">{stats.active}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-red-100 rounded-lg">
                <Ban className="w-5 h-5 text-red-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Inativos</p>
                <p className="text-lg font-semibold text-gray-900">{stats.inactive}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-purple-100 rounded-lg">
                <Shield className="w-5 h-5 text-purple-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Administradores</p>
                <p className="text-lg font-semibold text-gray-900">{stats.admins}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-blue-100 rounded-lg">
                <Users className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Gestores</p>
                <p className="text-lg font-semibold text-gray-900">{stats.managers}</p>
              </div>
            </div>
          </div>

          <div className="bg-gray-50 p-4 rounded-lg">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <UserPlus className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <p className="text-sm text-gray-500">Solicitantes</p>
                <p className="text-lg font-semibold text-gray-900">{stats.requesters}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="relative">
            <Search className="w-4 h-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" />
            <Input
              placeholder="Buscar por nome, e-mail..."
              className="pl-9"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>

          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'all' | UserRole)}
          >
            <option value="all">Todas as funções</option>
            <option value="administrador">Administradores</option>
            <option value="gestor">Gestores</option>
            <option value="solicitante">Solicitantes</option>
          </select>

          <select
            className="h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-sm"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | 'active' | 'inactive')}
          >
            <option value="all">Todos os status</option>
            <option value="active">Ativos</option>
            <option value="inactive">Inativos</option>
          </select>

          <Button variant="outline">
            <Filter className="w-4 h-4 mr-2" />
            Mais Filtros
          </Button>
        </div>
      </div>

      {/* Users List */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100">
        <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as typeof activeTab)}>
          <div className="p-6 border-b border-gray-100">
            <TabsList className="grid grid-cols-3 gap-4">
              <TabsTrigger value="all" className="flex items-center gap-2">
                <Activity className="w-4 h-4" />
                Todos ({stats.total})
              </TabsTrigger>
              <TabsTrigger value="active" className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Ativos ({stats.active})
              </TabsTrigger>
              <TabsTrigger value="inactive" className="flex items-center gap-2">
                <Ban className="w-4 h-4" />
                Inativos ({stats.inactive})
              </TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="all" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredUsers.map((user, index) => (
                <div 
                  key={user.id} 
                  className={`group p-6 transition-all ${
                    index % 2 === 0
                      ? 'bg-gradient-to-r from-gray-50/30 to-transparent'
                      : 'bg-white'
                  }`}
                >
                  <div className="flex items-center justify-between">
                    {/* User Info */}
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-lg font-semibold text-primary-600">
                          {user.full_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">{user.full_name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Mail className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">{user.email}</span>
                        </div>
                      </div>
                    </div>

                    {/* Role, Status and Actions */}
                    <div className="flex items-center gap-4">
                      <UserRoleBadge role={user.role} />
                      <UserStatusBadge active={!user.deleted_at} />
                      
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleEditUser(user)}
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Editar
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleChangePassword(user)}
                        >
                          <Key className="w-4 h-4 mr-2" />
                          Alterar Senha
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => handleDeactivateUser(user)}
                        >
                          <Ban className="w-4 h-4 mr-2" />
                          {user.deleted_at ? 'Reativar' : 'Desativar'}
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* User Details */}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Building2 className="w-4 h-4" />
                      <span className="text-sm">
                        Departamento: {user.department?.name || 'Não definido'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm">
                        Criado em {format(new Date(user.created_at), "dd 'de' MMMM 'de' yyyy", {
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="active" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredUsers.filter(user => !user.deleted_at).map((user, index) => (
                <div 
                  key={user.id} 
                  className={`group p-6 transition-all ${
                    index % 2 === 0
                      ? 'bg-gradient-to-r from-gray-50/30 to-transparent'
                      : 'bg-white'
                  }`}
                >
                  {/* Same user card content as above */}
                  <div className="flex items-center justify-between">
                    {/* User Info */}
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-lg font-semibold text-primary-600">
                          {user.full_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">{user.full_name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Mail className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">{user.email}</span>
                        </div>
                      </div>
                    </div>

                    {/* Role, Status and Actions */}
                    <div className="flex items-center gap-4">
                      <UserRoleBadge role={user.role} />
                      <UserStatusBadge active={!user.deleted_at} />
                      
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleEditUser(user)}
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Editar
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleChangePassword(user)}
                        >
                          <Key className="w-4 h-4 mr-2" />
                          Alterar Senha
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="text-red-500 hover:text-red-600"
                          onClick={() => handleDeactivateUser(user)}
                        >
                          <Ban className="w-4 h-4 mr-2" />
                          Desativar
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* User Details */}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Building2 className="w-4 h-4" />
                      <span className="text-sm">
                        Departamento: {user.department?.name || 'Não definido'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm">
                        Criado em {format(new Date(user.created_at), "dd 'de' MMMM 'de' yyyy", {
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="inactive" className="p-0">
            <div className="divide-y divide-gray-100">
              {filteredUsers.filter(user => user.deleted_at).map((user, index) => (
                <div 
                  key={user.id} 
                  className={`group p-6 transition-all ${
                    index % 2 === 0
                      ? 'bg-gradient-to-r from-gray-50/30 to-transparent'
                      : 'bg-white'
                  }`}
                >
                  {/* Same user card content as above */}
                  <div className="flex items-center justify-between">
                    {/* User Info */}
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-full bg-primary-100 flex items-center justify-center">
                        <span className="text-lg font-semibold text-primary-600">
                          {user.full_name.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <h3 className="font-medium text-gray-900">{user.full_name}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <Mail className="w-4 h-4 text-gray-400" />
                          <span className="text-sm text-gray-500">{user.email}</span>
                        </div>
                      </div>
                    </div>

                    {/* Role, Status and Actions */}
                    <div className="flex items-center gap-4">
                      <UserRoleBadge role={user.role} />
                      <UserStatusBadge active={!user.deleted_at} />
                      
                      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleEditUser(user)}
                        >
                          <Edit className="w-4 h-4 mr-2" />
                          Editar
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          onClick={() => handleChangePassword(user)}
                        >
                          <Key className="w-4 h-4 mr-2" />
                          Alterar Senha
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm"
                          className="text-green-500 hover:text-green-600"
                          onClick={() => handleDeactivateUser(user)}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          Reativar
                        </Button>
                      </div>
                    </div>
                  </div>

                  {/* User Details */}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="flex items-center gap-2 text-gray-500">
                      <Building2 className="w-4 h-4" />
                      <span className="text-sm">
                        Departamento: {user.department?.name || 'Não definido'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-gray-500">
                      <Calendar className="w-4 h-4" />
                      <span className="text-sm">
                        Criado em {format(new Date(user.created_at), "dd 'de' MMMM 'de' yyyy", {
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* Dialogs */}
      <NewUserDialog
        open={showNewUserDialog}
        onOpenChange={setShowNewUserDialog}
        onSuccess={() => {
          loadUsers()
          userActionToasts.created()
        }}
      />

      {selectedUser && (
        <>
          <EditUserDialog
            user={selectedUser}
            open={showEditDialog}
            onOpenChange={setShowEditDialog}
            onSuccess={() => {
              loadUsers()
              userActionToasts.updated()
            }}
          />

          <ChangePasswordDialog
            user={selectedUser}
            open={showPasswordDialog}
            onOpenChange={setShowPasswordDialog}
            onSuccess={() => {
              setShowPasswordDialog(false)
              userActionToasts.updated()
            }}
          />

          <DeactivateUserDialog
            user={selectedUser}
            open={showDeactivateDialog}
            onOpenChange={setShowDeactivateDialog}
            onSuccess={() => {
              loadUsers()
              userActionToasts.deactivated()
            }}
          />
        </>
      )}
    </div>
  )
}