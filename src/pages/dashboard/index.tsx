import { useState } from 'react'
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
  ChevronDown,
  HelpCircle,
  FileText,
  Settings
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useTheme } from '@/contexts/theme'

export function Dashboard() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { mode } = useTheme()

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
  const [showGuide, setShowGuide] = useState(false)

  const glass: React.CSSProperties = {
    background: mode === 'dark' ? 'rgba(10,15,20,0.55)' : 'rgba(255,255,255,0.65)',
    backdropFilter: 'blur(30px)',
    WebkitBackdropFilter: 'blur(30px)',
    border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.5)'}`,
    borderRadius: 16,
    transition: 'background 0.4s, border-color 0.4s',
  }
  const txt = mode === 'dark' ? '#fff' : '#0d2e1c'
  const txtSec = mode === 'dark' ? 'rgba(255,255,255,0.7)' : 'rgba(13,46,28,0.65)'
  const txtMut = mode === 'dark' ? 'rgba(255,255,255,0.45)' : 'rgba(13,46,28,0.45)'

  return (
    <ErrorBoundary>
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: txt }}>
            Ola, {user?.full_name?.split(' ')[0]}!
          </h1>
          <p className="text-sm mt-1" style={{ color: txtSec }}>
            Sistema de Gestao de Insumos — HECC
          </p>
        </div>
        <Button
          className="bg-primary-500 hover:bg-primary-600 text-white"
          onClick={() => navigate('/requests/new')}
        >
          Nova Solicitacao
          <ArrowRight className="w-4 h-4 ml-2" />
        </Button>
      </div>

      {/* Main Features */}
      <div className="p-6" style={glass}>
        <h2 className="text-xl font-semibold mb-6" style={{ color: txt }}>Principais Funcionalidades</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Requests */}
          <div className="p-5 rounded-xl transition-colors" style={{ border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)'}` }}>
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-emerald-100 rounded-lg">
                <ClipboardList className="w-5 h-5 text-emerald-600" />
              </div>
              <h3 className="font-semibold" style={{ color: txt }}>Solicitações</h3>
            </div>
            <p className="text-sm mb-4" style={{ color: txtSec }}>
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
            <div className="p-5 rounded-xl transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-green-100 rounded-lg">
                  <Package2 className="w-5 h-5 text-green-600" />
                </div>
                <h3 className="font-semibold" style={{ color: txt }}>Estoque</h3>
              </div>
              <p className="text-sm mb-4" style={{ color: txtSec }}>
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
            <div className="p-5 rounded-xl transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-purple-100 rounded-lg">
                  <BarChart3 className="w-5 h-5 text-purple-600" />
                </div>
                <h3 className="font-semibold" style={{ color: txt }}>Relatórios</h3>
              </div>
              <p className="text-sm mb-4" style={{ color: txtSec }}>
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
            <div className="p-5 rounded-xl transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-amber-100 rounded-lg">
                  <CheckSquare className="w-5 h-5 text-amber-600" />
                </div>
                <h3 className="font-semibold" style={{ color: txt }}>Gestão de Solicitações</h3>
              </div>
              <p className="text-sm mb-4" style={{ color: txtSec }}>
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
            <div className="p-5 rounded-xl transition-colors">
              <div className="flex items-center gap-3 mb-3">
                <div className="p-2 bg-indigo-100 rounded-lg">
                  <Users className="w-5 h-5 text-indigo-600" />
                </div>
                <h3 className="font-semibold" style={{ color: txt }}>Gestão de Usuários</h3>
              </div>
              <p className="text-sm mb-4" style={{ color: txtSec }}>
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
          <div className="p-5 rounded-xl transition-colors">
            <div className="flex items-center gap-3 mb-3">
              <div className="p-2 bg-gray-100 rounded-lg">
                <Settings className="w-5 h-5 text-gray-600" />
              </div>
              <h3 className="font-semibold" style={{ color: txt }}>Configurações</h3>
            </div>
            <p className="text-sm mb-4" style={{ color: txtSec }}>
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

      {/* Quick Guide - Collapsible */}
      <div style={glass}>
        <button
          onClick={() => setShowGuide(!showGuide)}
          className="w-full p-4 flex items-center justify-between cursor-pointer"
          style={{ background: 'transparent', border: 'none' }}
        >
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 rounded-lg">
              <BookOpen className="w-5 h-5 text-emerald-600" />
            </div>
            <span className="text-base font-semibold" style={{ color: txt }}>Guia Rapido</span>
          </div>
          <ChevronDown size={20} style={{ color: txtMut, transform: showGuide ? 'rotate(180deg)' : 'rotate(0)', transition: 'transform 0.3s' }} />
        </button>
        {showGuide && (
          <div className="px-6 pb-6 space-y-4">
            <div className="p-4 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
              <h3 className="font-medium mb-1 flex items-center gap-2 text-sm" style={{ color: txt }}>
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs font-semibold">1</span>
                Como criar uma nova solicitacao
              </h3>
              <p className="text-sm ml-7" style={{ color: txtSec }}>
                Acesse "Nova Solicitacao", selecione Farmacia ou Almoxarifado, preencha os detalhes e adicione os itens.
              </p>
            </div>
            <div className="p-4 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
              <h3 className="font-medium mb-1 flex items-center gap-2 text-sm" style={{ color: txt }}>
                <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs font-semibold">2</span>
                Como acompanhar suas solicitacoes
              </h3>
              <p className="text-sm ml-7" style={{ color: txtSec }}>
                Acesse "Minhas Solicitacoes" para ver status, filtrar e visualizar detalhes.
              </p>
            </div>
            {canManageRequests && (
              <div className="p-4 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
                <h3 className="font-medium mb-1 flex items-center gap-2 text-sm" style={{ color: txt }}>
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs font-semibold">3</span>
                  Como aprovar ou rejeitar solicitacoes
                </h3>
                <p className="text-sm ml-7" style={{ color: txtSec }}>
                  Acesse "Caixa de Entrada", selecione a solicitacao e use os botoes de acao.
                </p>
              </div>
            )}
            {(isManager || isAdmin) && (
              <div className="p-4 rounded-lg" style={{ background: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)' }}>
                <h3 className="font-medium mb-1 flex items-center gap-2 text-sm" style={{ color: txt }}>
                  <span className="flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600 text-xs font-semibold">4</span>
                  Como gerenciar o estoque
                </h3>
                <p className="text-sm ml-7" style={{ color: txtSec }}>
                  Acesse "Farmacia" ou "Almoxarifado" no menu de Estoque.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Video Tutorial Section */}
      <div className="p-6" style={glass}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-red-100 rounded-lg">
            <PlayCircle className="w-5 h-5 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold" style={{ color: txt }}>Tutorial em Vídeo</h2>
        </div>
        <p className="mb-4" style={{ color: txtSec }}>
          Assista ao nosso tutorial completo para aprender a utilizar todas as funcionalidades do sistema de forma eficiente.
        </p>
        <div className="aspect-video rounded-lg flex items-center justify-center mb-4" style={{ background: mode === 'dark' ? 'rgba(0,0,0,0.2)' : 'rgba(0,0,0,0.04)', border: `1px solid ${mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.06)'}` }}>
          <div className="text-center">
            <PlayCircle className="w-16 h-16 text-red-500 mx-auto mb-3" />
            <p className="font-medium" style={{ color: txt }}>Tutorial do Sistema de Gestão de Insumos</p>
            <p className="text-sm" style={{ color: txtMut }}>Duração: 10:25</p>
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
      <div className="p-6" style={glass}>
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 bg-green-100 rounded-lg">
            <HelpCircle className="w-5 h-5 text-green-600" />
          </div>
          <h2 className="text-xl font-semibold" style={{ color: txt }}>Ajuda e Suporte</h2>
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