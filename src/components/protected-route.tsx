import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useState } from 'react'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, error, connectionError, checkConnection, statusMsg, signOut } = useAuth()
  const location = useLocation()
  const [tentando, setTentando] = useState(false)

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center px-4">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">{statusMsg || 'Verificando autenticação...'}</p>
        </div>
      </div>
    )
  }

  // Só chega aqui depois de várias tentativas automáticas (contexts/auth.tsx).
  if (!user && connectionError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Sem conexão com o servidor
          </h1>
          <p className="text-gray-600 mb-6">
            {error || 'O servidor não respondeu.'} Nada foi perdido: assim que a conexão voltar, clique em "Tentar de novo".
          </p>
          <div className="space-y-3">
            <Button
              onClick={async () => { setTentando(true); try { await checkConnection() } finally { setTentando(false) } }}
              className="w-full"
              disabled={tentando}
            >
              {tentando ? 'Tentando...' : 'Tentar de novo'}
            </Button>
            <Button
              variant="outline"
              onClick={async () => { await signOut(); window.location.assign('/login') }}
              className="w-full"
            >
              Sair e ir para o login
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    // Guarda onde a pessoa queria ir: depois do login ela volta para a mesma tela.
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }

  // Troca de senha obrigatória vale em TODA rota protegida, não só logo após o login.
  if (user.must_change_password && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace state={{ from: location.pathname + location.search }} />
  }

  return <>{children}</>
}
