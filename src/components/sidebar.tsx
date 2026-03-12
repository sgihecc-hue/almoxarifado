import { NavLink } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { Button } from '@/components/ui/button'
import { 
  Building2, 
  ClipboardList, 
  UserCircle, 
  LogOut,
  LayoutDashboard,
  Settings,
  Users,
  FileText,
  BarChart3,
  InboxIcon,
  CheckSquare,
  History,
  AlertCircle,
  ListChecks,
  Database,
  Pill,
  Package2,
  X,
  Tv
} from 'lucide-react'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
}

export function Sidebar({ isOpen, onClose }: SidebarProps) {
  const { user, signOut } = useAuth()
  const isAdmin = user?.role === 'administrador'
  const isManager = user?.role === 'gestor'
  const canManageRequests = isAdmin || isManager

  const menuItems = [
    {
      title: 'Principal',
      items: [
        {
          name: 'Dashboard',
          icon: LayoutDashboard,
          href: '/',
          show: true
        },
        {
          name: 'Painel TV - Almoxarifado',
          icon: Tv,
          href: '/tv/warehouse',
          show: isManager || isAdmin
        },
        {
          name: 'Painel TV - Farmácia',
          icon: Tv,
          href: '/tv/pharmacy',
          show: isManager || isAdmin
        }
      ]
    },
    {
      title: 'Solicitações',
      items: [
        {
          name: 'Minhas Solicitações',
          icon: ClipboardList,
          href: '/requests',
          show: true
        },
        {
          name: 'Nova Solicitação',
          icon: ListChecks,
          href: '/requests/new',
          show: true
        }
      ]
    },
    {
      title: 'Gestão de Solicitações',
      items: [
        {
          name: 'Caixa de Entrada',
          icon: InboxIcon,
          href: '/requests/inbox',
          show: canManageRequests
        },
        {
          name: 'Em Processamento',
          icon: CheckSquare,
          href: '/requests/processing',
          show: canManageRequests
        },
        {
          name: 'Histórico',
          icon: History,
          href: '/requests/history',
          show: canManageRequests
        },
        {
          name: 'Pendências',
          icon: AlertCircle,
          href: '/requests/pending',
          show: canManageRequests
        }
      ]
    },
    {
      title: 'Estoque',
      items: [
        {
          name: 'Farmácia',
          icon: Pill,
          href: '/inventory/pharmacy',
          show: isManager || isAdmin
        },
        {
          name: 'Almoxarifado',
          icon: Package2,
          href: '/inventory/warehouse',
          show: isManager || isAdmin
        }
      ]
    },
    {
      title: 'Relatórios',
      items: [
        {
          name: 'Consumo da Farmácia',
          icon: BarChart3,
          href: '/reports/pharmacy-consumption',
          show: isManager || isAdmin
        },
        {
          name: 'Consumo do Almoxarifado',
          icon: BarChart3,
          href: '/reports/warehouse-consumption',
          show: isManager || isAdmin
        },
        {
          name: 'Gestão de Consumo - Farmácia',
          icon: FileText,
          href: '/reports/pharmacy-admin-consumption',
          show: isAdmin
        },
        {
          name: 'Gestão de Consumo - Almoxarifado',
          icon: FileText,
          href: '/reports/warehouse-admin-consumption',
          show: isAdmin
        }
      ]
    },
    {
      title: 'Administração',
      items: [
        {
          name: 'Usuários',
          icon: Users,
          href: '/users-advanced',
          show: isAdmin
        },
        {
          name: 'Tabelas',
          icon: Database,
          href: '/tables',
          show: isAdmin,
          submenu: [
            {
              name: 'Setores',
              href: '/tables/departments',
              icon: Building2
            }
          ]
        }
      ]
    },
    {
      title: 'Configurações',
      items: [
        {
          name: 'Meu Perfil',
          icon: UserCircle,
          href: '/profile',
          show: true
        },
        {
          name: 'Configurações',
          icon: Settings,
          href: '/settings',
          show: true
        }
      ]
    }
  ]

  return (
    <div className={`fixed inset-y-0 left-0 z-50 w-64 bg-white border-r p-6 flex flex-col h-full transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : '-translate-x-full'} md:relative md:translate-x-0`}>
      {/* Close button for mobile */}
      <button 
        className="absolute top-4 right-4 md:hidden" 
        onClick={onClose}
      >
        <X className="h-5 w-5 text-gray-500" />
      </button>
      
      {/* Logo & User Info */}
      <div className="mb-8 space-y-2">
        <div className="flex items-center space-x-2">
          <div className="relative">
            <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg blur opacity-75"></div>
            <div className="relative bg-white p-2 rounded-lg">
              <Building2 className="w-6 h-6 text-blue-600" />
            </div>
          </div>
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
            HECC
          </h1>
        </div>
        <h2 className="text-sm font-medium text-gray-600">Hospital Estadual Costa dos Coqueiros</h2>
        <div className="pt-2 border-t">
          <p className="text-sm font-medium text-gray-900">{user?.full_name}</p>
          <p className="text-xs text-gray-500 capitalize">{user?.role}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-6 overflow-y-auto">
        {menuItems.map((section) => {
          const visibleItems = section.items.filter(item => item.show)
          if (visibleItems.length === 0) return null

          return (
            <div key={section.title}>
              <h3 className="px-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {section.title}
              </h3>
              <div className="mt-2 space-y-1">
                {visibleItems.map((item) => (
                  <div key={item.href}>
                    <NavLink
                      to={item.href}
                      className={({ isActive }) =>
                        `flex items-center justify-between px-2 py-2 text-sm font-medium rounded-lg transition-colors ${
                          isActive
                            ? 'bg-primary-50 text-primary-900'
                            : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                        }`
                      }
                      onClick={item.submenu ? undefined : onClose}
                    >
                      <div className="flex items-center gap-2">
                        <item.icon className="w-5 h-5" />
                        {item.name}
                      </div>
                    </NavLink>
                    {item.submenu && (
                      <div className="ml-7 mt-1 space-y-1">
                        {item.submenu.map((subitem) => (
                          <NavLink
                            key={subitem.href}
                            to={subitem.href}
                            className={({ isActive }) =>
                              `flex items-center gap-2 px-2 py-1.5 text-sm rounded-lg transition-colors ${
                                isActive
                                  ? 'bg-primary-50 text-primary-900'
                                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                              }`
                            }
                            onClick={onClose}
                          >
                            <subitem.icon className="w-4 h-4" />
                            {subitem.name}
                          </NavLink>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </nav>

      {/* Logout Button */}
      <Button
        variant="ghost"
        className="mt-6 flex items-center gap-2 w-full justify-start text-gray-600 hover:text-gray-900 hover:bg-gray-50"
        onClick={() => signOut()}
      >
        <LogOut className="w-5 h-5" />
        Sair
      </Button>
    </div>
  )
}