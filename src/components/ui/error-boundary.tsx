import React from 'react'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { Button } from './button'
import { supabase } from '@/lib/supabase'

interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
  errorInfo?: React.ErrorInfo
  retryCount: number
  isSupabaseConnected: boolean
}

interface ErrorBoundaryProps {
  children: React.ReactNode
  fallback?: React.ComponentType<{ error: Error; retry: () => void }>
  maxRetries?: number
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
}

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  private retryTimeoutId?: NodeJS.Timeout
  private mounted = true
  private connectionCheckInterval?: NodeJS.Timeout

  constructor(props: ErrorBoundaryProps) {
    super(props)
    this.state = { 
      hasError: false, 
      retryCount: 0,
      isSupabaseConnected: true
    }
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      error,
      retryCount: 0,
      isSupabaseConnected: true
    }
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('Error caught by boundary:', error, errorInfo)
    
    // Check if it's a Supabase connection error
    if (error.message?.includes('fetch') || error.message?.includes('network')) {
      this.checkSupabaseConnection()
    }
    
    // Call custom error handler if provided
    try {
      this.props.onError?.(error, errorInfo)
    } catch (handlerError) {
      console.error('Error in custom error handler:', handlerError)
    }
    
    // Send to monitoring service in production
    if (process.env.NODE_ENV === 'production') {
      // TODO: Send to error monitoring service (Sentry, etc.)
    }
    
    if (this.mounted) {
      this.setState({
        error,
        errorInfo
      })
    }
  }

  checkSupabaseConnection = async () => {
    try {
      // Add timeout and better error handling
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 3000) // 3 second timeout
      
      const { error } = await supabase
        .from('users')
        .select('id')
        .limit(1)
        .abortSignal(controller.signal)
      
      clearTimeout(timeoutId)
      
      if (this.mounted) {
        this.setState({ isSupabaseConnected: !error })
      }
    } catch (error) {
      if (this.mounted) {
        console.error('Supabase connection check failed:', error)
        this.setState({ isSupabaseConnected: false })
      }
    }
  }

  componentDidMount() {
    // Check connection periodically
    this.connectionCheckInterval = setInterval(() => {
      this.checkSupabaseConnection()
    }, 30000) // Check every 30 seconds
  }

  handleRetry = () => {
    if (!this.mounted) return
    
    const maxRetries = this.props.maxRetries || 3
    
    if (this.state.retryCount >= maxRetries) {
      console.warn('Maximum retry attempts reached')
      return
    }

    if (this.mounted) {
      this.setState(prevState => ({ 
        hasError: false, 
        error: undefined, 
        errorInfo: undefined,
        retryCount: prevState.retryCount + 1
      }))
    }

    // Auto-retry with exponential backoff for certain errors
    if (this.state.error?.message.includes('fetch') || this.state.error?.message.includes('network')) {
      if (this.mounted) {
        const delay = Math.min(1000 * Math.pow(2, this.state.retryCount), 10000) // Max 10 seconds
        this.retryTimeoutId = setTimeout(() => {
          if (this.mounted) {
            this.handleRetry()
          }
        }, delay)
      }
    }
  }

  componentWillUnmount() {
    this.mounted = false
    if (this.connectionCheckInterval) {
      clearInterval(this.connectionCheckInterval)
    }
    if (this.retryTimeoutId) {
      clearTimeout(this.retryTimeoutId)
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback
        return <FallbackComponent error={this.state.error!} retry={this.handleRetry} />
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
            <AlertTriangle className="w-16 h-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-xl font-bold text-gray-900 mb-2">
              Algo deu errado
            </h1>
            {!this.state.isSupabaseConnected && (
              <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-200">
                <p className="text-sm text-red-700">
                  Problema de conexão com o banco de dados
                </p>
              </div>
            )}
            <p className="text-gray-600 mb-6">
              Ocorreu um erro inesperado. Por favor, tente novamente.
            </p>
            <Button
              onClick={this.handleRetry}
              className="w-full"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Tentar Novamente
            </Button>
            
            <div className="mt-4">
              <Button 
                variant="outline" 
                onClick={() => window.location.href = '/login'}
              >
                Ir para Login
              </Button>
            </div>
            
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-4 text-left">
                <summary className="cursor-pointer text-sm text-gray-500">
                  Detalhes do Erro (Desenvolvimento)
                </summary>
                <pre className="mt-2 text-xs bg-gray-100 p-2 rounded overflow-auto">
                  {this.state.error.toString()}
                </pre>
              </details>
            )}
          </div>
        </div>
      )
    }

    return this.props.children
  }
}