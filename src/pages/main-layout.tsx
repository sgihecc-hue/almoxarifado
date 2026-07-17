import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Sidebar } from '@/components/sidebar'
import { Header } from '@/components/header'
import { useTheme } from '@/contexts/theme'
import { useModule } from '@/contexts/module'
import { ExpiryAlertPopup } from '@/components/expiry-alert-popup'
import { ActiveStockBanner } from '@/components/active-stock-banner'

interface MainLayoutProps {
  children: React.ReactNode
}

export function MainLayout({ children }: MainLayoutProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const { mode, colors } = useTheme()
  const { activeModule, isModuleUser } = useModule()
  const location = useLocation()

  const toggleSidebar = () => {
    setSidebarOpen(!sidebarOpen)
  }

  // Tela de seleção de módulo (raiz "/", usuário de módulo sem módulo ativo):
  // é uma tela de escolha em tela cheia — sem sidebar, header, banner ou popup.
  const isModuleSelection = isModuleUser && !activeModule && location.pathname === '/'
  if (isModuleSelection) {
    return (
      <div className="h-screen overflow-y-auto" style={{ background: colors.gradient, transition: 'background 0.6s ease' }}>
        {children}
      </div>
    )
  }

  return (
    <div className="flex h-screen" style={{ background: colors.gradient, transition: 'background 0.6s ease' }}>
      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex flex-col flex-1 overflow-hidden">
        <Header toggleSidebar={toggleSidebar} isSidebarOpen={sidebarOpen} />
        <ActiveStockBanner />

        {/* overflow-y-auto (nao overflow-auto): overflow horizontal do
            conteudo e clipado aqui, forcando o scroll a acontecer dentro
            da tabela (via overflow-x-auto da propria tabela). Antes, a tela
            inteira scrollava lateralmente e a tabela nao mostrava barra. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-8 min-w-0">
          {children}
        </main>
      </div>

      <ExpiryAlertPopup />

      {mode === 'dark' && (
        <style>{`
          .bg-white { background: #1e2e26 !important; color: #e8f0ec !important; }
          .bg-gray-50 { background: #1a2a22 !important; }
          .bg-gray-100 { background: #1e2e26 !important; }
          .border-gray-100, .border-gray-200, .border-gray-300 { border-color: rgba(255,255,255,0.08) !important; }
          .text-gray-900 { color: #e8f0ec !important; }
          .text-gray-800 { color: #d0ddd6 !important; }
          .text-gray-700 { color: #b8c8c0 !important; }
          .text-gray-600 { color: #98b0a4 !important; }
          .text-gray-500 { color: #7a9488 !important; }
          .text-gray-400 { color: #5a7a6c !important; }
          .shadow-sm { box-shadow: none !important; }
          input, select, textarea {
            background: #243830 !important;
            border-color: rgba(255,255,255,0.1) !important;
            color: #e8f0ec !important;
          }
          input::placeholder, textarea::placeholder { color: rgba(255,255,255,0.35) !important; }
          .bg-primary-50 { background: rgba(45,180,140,0.15) !important; }
          .text-primary-900 { color: #5ee8b8 !important; }
          table th { color: #7a9488 !important; }
          .divide-gray-200 > * + * { border-color: rgba(255,255,255,0.06) !important; }
          .hover\\:bg-gray-50:hover { background: rgba(255,255,255,0.05) !important; }
          .ring-primary-500 { --tw-ring-color: rgba(45,180,140,0.5) !important; }
          label { color: #b8c8c0 !important; }
          h1, h2, h3, h4 { color: #e8f0ec !important; }
          p { color: #98b0a4 !important; }
          .bg-red-50 { background: rgba(239,68,68,0.1) !important; }
          .bg-green-50 { background: rgba(34,197,94,0.1) !important; }
          .bg-blue-50 { background: rgba(59,130,246,0.1) !important; }
          .bg-amber-50 { background: rgba(251,191,36,0.1) !important; }
          .bg-emerald-50 { background: rgba(16,185,129,0.1) !important; }
          .bg-indigo-50 { background: rgba(99,102,241,0.1) !important; }
          .bg-purple-50 { background: rgba(139,92,246,0.1) !important; }
          [class*="border-emerald"], [class*="border-green"], [class*="border-amber"],
          [class*="border-indigo"], [class*="border-purple"], [class*="border-red"] {
            border-color: rgba(255,255,255,0.1) !important;
          }
        `}</style>
      )}
    </div>
  )
}
