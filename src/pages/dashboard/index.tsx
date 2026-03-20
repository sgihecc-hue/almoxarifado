import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { ErrorBoundary } from '@/components/ui/error-boundary'
import { 
  Package2, 
  Pill, 
  ClipboardList, 
  Users, 
  BarChart3,
  PlayCircle,
  ArrowRight,
  CheckSquare,
  BookOpen,
  Lightbulb,
  HelpCircle,
  FileText,
  Settings
} from 'lucide-react'
import { Button } from '@/components/ui/button'

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-gray-500">Carregando...</p>
        </div>
      </div>
    )
  }

  const isAdmin = user?.role === 'administrador'
  const isManager = user?.role === 'gestor'
  const canManageRequests = isAdmin || isManager

  return (
    <ErrorBoundary>
    <div className="space-y-8">
      {/* Welcome Section */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex flex-col md:flex-row gap-6 items-start">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Sistema de Gestão de Insumos
            </h1>
            <p className="text-lg text-gray-600 mb-6">
              Olá, <span className="font-medium">{user?.full_name}</span>! Este sistema permite gerenciar o estoque e solicitações de insumos do Hospital Estadual Costa dos Coqueiros de forma eficiente.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button 
                className="bg-primary-500 hover:bg-primary-600 text-white"
                onClick={() => navigate('/requests/new')}
              >
                Nova Solicitação
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
              <Button 
                variant="outline"
                onClick={() => window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank')}
              >
                <PlayCircle className="w-4 h-4 mr-2" />
                Assistir Tutorial
              </Button>
            </div>
          </div>
          <div className="w-full md:w-auto">
            <div className="relative">
              <div className="absolute -inset-1 bg-gradient-to-r from-emerald-600 to-teal-500 rounded-xl blur opacity-25"></div>
              <div className="relative bg-white p-6 rounded-xl border border-gray-200">
                <div className="flex items-center gap-3 mb-4">
                  <div className="p-2 bg-emerald-100 rounded-lg">
                    <Lightbulb className="w-5 h-5 text-emerald-600" />
                  </div>
                  <h3 className="font-semibold text-gray-900">Dica Rápida</h3>
                </div>
                <p className="text-sm text-gray-600 mb-4">
                  Você pode acompanhar o status de suas solicitações na seção "Minhas Solicitações" e visualizar detalhes completos clicando em qualquer solicitação.
                </p>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-emerald-600"
                  onClick={() => navigate('/requests')}
                >
                  Ver minhas solicitações
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Features */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Principais Funcionalidades</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Requests */}
          <div className="p-5 border border-gray-200 rounded-xl hover:border-primary-200 hover:bg-primary-50/20 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <ClipboardList className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Solicitações</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Crie e acompanhe solicitações de materiais e medicamentos para seu setor. Visualize o histórico completo e status de cada pedido.
            </p>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-emerald-600"
              onClick={() => navigate('/requests')}
            >
              Acessar Solicitações
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>

          {/* Inventory */}
          {(isManager || isAdmin) && (
            <div className="p-5 border border-gray-200 rounded-xl hover:border-primary-200 hover:bg-primary-50/20 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Package2 className="w-5 h-5 text-green-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Estoque</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Gerencie o estoque de materiais e medicamentos. Acompanhe níveis de estoque, adicione novos itens e registre movimentações.
              </p>
              <div className="flex gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-green-600"
                  onClick={() => navigate('/inventory/pharmacy')}
                >
                  <Pill className="w-4 h-4 mr-1" />
                  Farmácia
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-green-600"
                  onClick={() => navigate('/inventory/warehouse')}
                >
                  <Package2 className="w-4 h-4 mr-1" />
                  Almoxarifado
                </Button>
              </div>
            </div>
          )}

          {/* Reports */}
          {(isManager || isAdmin) && (
            <div className="p-5 border border-gray-200 rounded-xl hover:border-primary-200 hover:bg-primary-50/20 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Relatórios</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Visualize relatórios detalhados de consumo, estoque e solicitações. Exporte dados para análise e tomada de decisões.
              </p>
              <div className="flex gap-2">
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-purple-600"
                  onClick={() => navigate('/reports/pharmacy-consumption')}
                >
                  Farmácia
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  className="text-purple-600"
                  onClick={() => navigate('/reports/warehouse-consumption')}
                >
                  Almoxarifado
                </Button>
              </div>
            </div>
          )}

          {/* Request Management */}
          {canManageRequests && (
            <div className="p-5 border border-gray-200 rounded-xl hover:border-primary-200 hover:bg-primary-50/20 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <CheckSquare className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Gestão de Solicitações</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Aprove, rejeite e processe solicitações. Acompanhe o fluxo completo desde a criação até a entrega.
              </p>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-amber-600"
                onClick={() => navigate('/requests/inbox')}
              >
                Acessar Caixa de Entrada
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {/* User Management */}
          {isAdmin && (
            <div className="p-5 border border-gray-200 rounded-xl hover:border-primary-200 hover:bg-primary-50/20 transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <Users className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="font-semibold text-gray-900">Gestão de Usuários</h3>
              </div>
              <p className="text-sm text-gray-600 mb-4">
                Gerencie usuários do sistema, defina permissões e controle o acesso às funcionalidades.
              </p>
              <Button 
                variant="ghost" 
                size="sm" 
                className="text-indigo-600"
                onClick={() => navigate('/users-advanced')}
              >
                Gerenciar Usuários
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </div>
          )}

          {/* Settings */}
          <div className="p-5 border border-gray-200 rounded-xl hover:border-primary-200 hover:bg-primary-50/20 transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Settings className="w-5 h-5 text-gray-600" />
              </div>
              <h3 className="font-semibold text-gray-900">Configurações</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">
              Personalize suas preferências, gerencie seu perfil e configure notificações do sistema.
            </p>
            <Button 
              variant="ghost" 
              size="sm" 
              className="text-gray-600"
              onClick={() => navigate('/settings')}
            >
              Acessar Configurações
              <ArrowRight className="w-4 h-4 ml-1" />
            </Button>
          </div>
        </div>
      </div>

      {/* Quick Guide */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-emerald-100 rounded-lg">
            <BookOpen className="w-5 h-5 text-emerald-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Guia Rápido</h2>
        </div>
        
        <div className="space-y-4">
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-sm font-semibold">1</span>
              Como criar uma nova solicitação
            </h3>
            <p className="text-sm text-gray-600 ml-8">
              Acesse o menu "Nova Solicitação", selecione o tipo (Farmácia ou Almoxarifado), preencha os detalhes, adicione os itens desejados e confirme o pedido.
            </p>
          </div>
          
          <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
            <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
              <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-sm font-semibold">2</span>
              Como acompanhar suas solicitações
            </h3>
            <p className="text-sm text-gray-600 ml-8">
              Acesse "Minhas Solicitações" para ver todas as suas solicitações. Você pode filtrar por status (pendente, aprovada, rejeitada, etc.) e visualizar detalhes completos.
            </p>
          </div>
          
          {canManageRequests && (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-sm font-semibold">3</span>
                Como aprovar ou rejeitar solicitações
              </h3>
              <p className="text-sm text-gray-600 ml-8">
                Acesse "Caixa de Entrada", selecione a solicitação desejada e utilize os botões de ação para aprovar ou rejeitar. Você pode ajustar as quantidades aprovadas e adicionar comentários.
              </p>
            </div>
          )}
          
          {(isManager || isAdmin) && (
            <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
              <h3 className="font-medium text-gray-900 mb-2 flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-full bg-emerald-100 text-emerald-600 text-sm font-semibold">4</span>
                Como gerenciar o estoque
              </h3>
              <p className="text-sm text-gray-600 ml-8">
                Acesse "Farmácia" ou "Almoxarifado" no menu de Estoque. Você pode adicionar novos itens, atualizar quantidades, configurar níveis mínimos e registrar movimentações.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Video Tutorial Section */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg">
            <PlayCircle className="w-5 h-5 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Tutorial em Vídeo</h2>
        </div>
        <p className="text-gray-600 mb-4">
          Assista ao nosso tutorial completo para aprender a utilizar todas as funcionalidades do sistema de forma eficiente.
        </p>
        <div className="aspect-video bg-gray-100 rounded-lg flex items-center justify-center mb-4 border border-gray-200">
          <div className="text-center">
            <PlayCircle className="w-16 h-16 text-red-500 mx-auto mb-3" />
            <p className="text-gray-700 font-medium">Tutorial do Sistema de Gestão de Insumos</p>
            <p className="text-gray-500 text-sm">Duração: 10:25</p>
          </div>
        </div>
        <div className="flex justify-center">
          <Button
            className="bg-red-600 hover:bg-red-700 text-white"
            onClick={() => window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank')}
          >
            <PlayCircle className="w-4 h-4 mr-2" />
            Assistir no YouTube
          </Button>
        </div>
      </div>

      {/* Help & Support */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <HelpCircle className="w-5 h-5 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold text-gray-900">Ajuda e Suporte</h2>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="p-4 bg-green-50 rounded-lg border border-green-100">
            <h3 className="font-medium text-green-900 mb-2">Manual do Usuário</h3>
            <p className="text-sm text-green-700 mb-3">
              Acesse o manual completo com instruções detalhadas sobre todas as funcionalidades do sistema.
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              className="border-green-200 text-green-700 hover:bg-green-100"
              onClick={() => window.open('#', '_blank')}
            >
              <FileText className="w-4 h-4 mr-2" />
              Baixar Manual
            </Button>
          </div>
          
          <div className="p-4 bg-teal-50 rounded-lg border border-teal-100">
            <h3 className="font-medium text-teal-900 mb-2">Tutoriais em Vídeo</h3>
            <p className="text-sm text-teal-700 mb-3">
              Assista aos tutoriais em vídeo para aprender a utilizar o sistema de forma visual e prática.
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              className="border-teal-200 text-teal-700 hover:bg-emerald-100"
              onClick={() => window.open('https://www.youtube.com/watch?v=dQw4w9WgXcQ', '_blank')}
            >
              <PlayCircle className="w-4 h-4 mr-2" />
              Ver Tutoriais
            </Button>
          </div>
          
          <div className="p-4 bg-purple-50 rounded-lg border border-purple-100">
            <h3 className="font-medium text-purple-900 mb-2">Suporte Técnico</h3>
            <p className="text-sm text-purple-700 mb-3">
              Entre em contato com nossa equipe de suporte para resolver dúvidas ou problemas técnicos.
            </p>
            <Button 
              variant="outline" 
              size="sm" 
              className="border-purple-200 text-purple-700 hover:bg-purple-100"
              onClick={() => window.open('mailto:suporte@hgc.gov.br', '_blank')}
            >
              <HelpCircle className="w-4 h-4 mr-2" />
              Contatar Suporte
            </Button>
          </div>
        </div>
      </div>
    </div>
    </ErrorBoundary>
  )
}