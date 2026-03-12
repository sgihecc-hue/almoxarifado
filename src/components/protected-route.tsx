import { Navigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, error, connectionError, checkConnection } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <Loader2 className="w-8 h-8 text-primary-500 animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Verificando autenticação...</p>
        </div>
      </div>
    )
  }

  if (connectionError || error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
          <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
          <h1 className="text-xl font-bold text-gray-900 mb-2">
            Erro de Conexão
          </h1>
          <p className="text-gray-600 mb-6">
            {error || 'Problema de conexão com o servidor'}
          </p>
          <div className="space-y-3">
            <Button
              onClick={() => checkConnection()}
              className="w-full"
            >
              Tentar Novamente
            </Button>
            <Button
              variant="outline"
              onClick={() => window.location.href = '/login'}
              className="w-full"
            >
              Ir para Login
            </Button>
          </div>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  return <>{children}</>
}