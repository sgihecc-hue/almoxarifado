import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2, Mail, Lock, ArrowRight, CheckCircle2 } from 'lucide-react'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, connectionError, checkConnection } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const [isCheckingConnection, setIsCheckingConnection] = useState(false)

  useEffect(() => {
    // Check for success message from registration
    if (location.state?.message && location.state?.type === 'success') {
      setSuccessMessage(location.state.message)
      
      // Clear the location state
      navigate(location.pathname, { replace: true, state: {} })
      
      // Clear success message after 5 seconds
      const timer = setTimeout(() => {
        setSuccessMessage('')
      }, 5000)
      
      return () => clearTimeout(timer)
    }
  }, [location, navigate])

  const handleConnectionCheck = async () => {
    setIsCheckingConnection(true)
    try {
      await checkConnection()
    } finally {
      setIsCheckingConnection(false)
    }
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const formData = new FormData(e.currentTarget)
      const email = formData.get('email') as string
      const password = formData.get('password') as string

      // Basic validation
      if (!email || !password) {
        setError('Por favor, preencha todos os campos')
        setLoading(false)
        return
      }

      await signIn(email, password)
      navigate('/')
    } catch (error) {
      console.error('Login error:', error)
      setError('Email ou senha inválidos')
    } finally {
      setLoading(false)
    }
  }

  // Show connection error if present
  if (connectionError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-6 text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-4">Erro de Conexão</h1>
          <p className="text-gray-600 mb-6">Não foi possível conectar com o servidor</p>
          <Button onClick={handleConnectionCheck} disabled={isCheckingConnection}>
            {isCheckingConnection ? 'Verificando...' : 'Tentar Novamente'}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Section */}
      <div className="hidden md:flex md:w-1/2 relative bg-gradient-to-br from-blue-600 to-cyan-600 text-white p-8 lg:p-12 flex-col justify-center overflow-hidden">
        <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxkZWZzPjxwYXR0ZXJuIGlkPSJncmlkIiB3aWR0aD0iNDAiIGhlaWdodD0iNDAiIHBhdHRlcm5Vbml0cz0idXNlclNwYWNlT25Vc2UiPjxwYXRoIGQ9Ik0gNDAgMCBMIDAgMCAwIDQwIiBmaWxsPSJub25lIiBzdHJva2U9InJnYmEoMjU1LDI1NSwyNTUsMC4xKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-10"></div>
        <div className="relative">
          <div className="flex items-center space-x-3 mb-12">
            <div className="relative">
              <div className="absolute -inset-1 bg-white/20 rounded-lg blur-sm"></div>
              <div className="relative bg-white/10 p-3 rounded-lg backdrop-blur-sm">
                <Building2 className="w-12 h-12" />
              </div>
            </div>
            <h1 className="text-4xl font-bold tracking-tight">HECC</h1>
          </div>
          <h2 className="text-5xl font-bold mb-6 leading-tight">
            Sistema de<br />Gestão de Insumos
          </h2>
          <p className="text-xl text-blue-50 mb-8 leading-relaxed max-w-lg">
            Controle eficiente e seguro do estoque hospitalar. Gerencie insumos, 
            medicamentos e equipamentos do Hospital Estadual Costa dos Coqueiros em um só lugar.
          </p>
          <div className="absolute bottom-0 right-0 transform translate-x-1/4 translate-y-1/4 w-96 h-96 bg-white/10 rounded-full blur-3xl"></div>
        </div>
      </div>

      {/* Right Section */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-6 sm:p-8 lg:p-12 bg-gray-50">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              Seja bem-vindo(a) ao SGI
            </h1>
            <p className="text-gray-600 text-lg">
              Sistema de Gestão de Insumos do HECC
            </p>
          </div>

          {/* Success Message */}
          {successMessage && (
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-green-500 mt-0.5" />
              <div>
                <p className="text-green-800 font-medium">{successMessage}</p>
                <p className="text-green-600 text-sm mt-1">
                  Por favor, faça login com suas credenciais.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="email" className="text-gray-700">
                  E-mail
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    className="pl-10 bg-white border-gray-300"
                    placeholder="Digite seu e-mail"
                  />
                  <Mail className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
                </div>
              </div>

              <div>
                <Label htmlFor="password" className="text-gray-700">
                  Senha
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete="current-password"
                    required
                    className="pl-10 bg-white border-gray-300"
                    placeholder="••••••••"
                  />
                  <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
                </div>
              </div>
            </div>

            {error && (
              <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">
                {error}
              </div>
            )}

            <div className="flex flex-col gap-4">
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white group shadow-lg hover:shadow-xl transition-all duration-300"
                disabled={loading}
              >
                {loading ? (
                  'Entrando...'
                ) : (
                  <span className="flex items-center justify-center">
                    Entrar
                    <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </span>
                )}
              </Button>

              <div className="flex justify-center">
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => navigate('/register')}
                >
                  Criar conta
                </Button>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}