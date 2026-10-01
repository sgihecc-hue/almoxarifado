import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { Button } from './button'
import { registrarErro } from '@/lib/registro-erros'

// =============================================================================
// Captura erro de render (auditoria 28/09/2026, X-04).
//
// Há DOIS níveis:
//   - raiz (App.tsx): último recurso, tela cheia com "Recarregar a página".
//   - por tela (MainLayout): <ErrorBoundary key={pathname} fallback={ErroDeTela}>
//     — o menu continua visível e trocar de tela limpa o erro (key muda).
// "Tentar de novo" remonta a tela; se o erro for do código ela cai de novo, por
// isso o fallback também oferece "Voltar" e "Ir para o início".
// =============================================================================

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
  tentativa: number
}

export interface ErrorFallbackProps {
  error: Error
  retry: () => void
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<ErrorFallbackProps>
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { hasError: false, tentativa: 0 }
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Erro de tela capturado:', error, errorInfo)
    registrarErro(error, { tipo: 'tela', mensagemUsuario: 'Algo deu errado (tela)', detalhe: { componentes: errorInfo?.componentStack?.slice(0, 1500) } })
    try {
      this.props.onError?.(error, errorInfo)
    } catch (handlerError) {
      console.error('Erro no tratador de erro:', handlerError)
    }
  }

  handleRetry = () => {
    // Remonta os filhos do zero (key nova) em vez de só limpar o estado.
    this.setState((prev) => ({ hasError: false, error: undefined, tentativa: prev.tentativa + 1 }))
  }

  render() {
    if (this.state.hasError) {
      const erro = this.state.error ?? new Error('Erro desconhecido')
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return <FallbackComponent error={erro} retry={this.handleRetry} />
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 p-4">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">Algo deu errado</h1>
            <p className="text-gray-600 mb-6">
              O sistema encontrou um erro inesperado. Recarregue a página; se continuar, avise o administrador.
            </p>
            <div className="space-y-3">
              <Button onClick={() => window.location.reload()} className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" />
                Recarregar a página
              </Button>
              <Button variant="outline" onClick={() => window.location.assign('/')} className="w-full">
                <Home className="w-4 h-4 mr-2" />
                Ir para o início
              </Button>
            </div>
            <details className="mt-4 text-left">
              <summary className="cursor-pointer text-xs text-gray-500">Detalhes técnicos</summary>
              <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto whitespace-pre-wrap">{erro.message}</pre>
            </details>
          </div>
        </div>
      )
    }

    return <React.Fragment key={this.state.tentativa}>{this.props.children}</React.Fragment>
  }
}
