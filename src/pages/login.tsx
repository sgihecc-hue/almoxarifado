import { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation, Navigate } from 'react-router-dom'
import { useAuth, loginParaEmail } from '@/contexts/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2, User, Lock, ArrowRight, CheckCircle2 } from 'lucide-react'
import hospitalImg from '@/assets/hospital-hecc.jpg.jpeg'

export function Login() {
  const navigate = useNavigate()
  const location = useLocation()
  const { signIn, user, loading: authLoading, error: authError, clearError } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMessage, setSuccessMessage] = useState('')
  const enviandoRef = useRef(false)

  // Para onde voltar depois do login (a ProtectedRoute guarda a tela pedida).
  const destino = (() => {
    const from = (location.state as { from?: unknown } | null)?.from
    if (typeof from === 'string' && from.startsWith('/') && !from.startsWith('/login') && !from.startsWith('//')) return from
    return '/'
  })()

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

  // Mensagem quando o usuário foi deslogado automaticamente por sessão expirada
  useEffect(() => {
    const params = new URLSearchParams(location.search)
    if (params.get('session_expired') === '1') {
      setError('Sua sessão expirou. Faça login novamente para continuar.')
      navigate(location.pathname, { replace: true, state: location.state })
    }
  }, [location.search, location.pathname, location.state, navigate])

  // Aviso vindo da abertura do app (usuário desativado, perfil não encontrado...)
  useEffect(() => {
    if (authError && !user) setError(authError)
  }, [authError, user])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (enviandoRef.current) return
    enviandoRef.current = true
    setError('')
    clearError()
    setLoading(true)

    try {
      const formData = new FormData(e.currentTarget)
      const login = ((formData.get('login') as string) || '').trim()
      const password = (formData.get('password') as string) || ''

      if (!login || !password) {
        setError('Por favor, preencha todos os campos')
        return
      }

      // CPF (com ou sem pontuação) vira CPF@hecc.local; e-mail vai como está
      const perfil = await signIn(loginParaEmail(login), password)

      if (perfil.must_change_password) {
        navigate('/change-password', { replace: true, state: { from: destino } })
      } else {
        navigate(destino, { replace: true })
      }
    } catch (error) {
      // signIn já devolve a mensagem certa: senha errada, usuário desativado,
      // sem conexão, muitas tentativas, perfil não encontrado...
      setError(error instanceof Error ? error.message : 'Não foi possível entrar.')
    } finally {
      enviandoRef.current = false
      setLoading(false)
    }
  }

  // Já logado (ex.: voltou para /login pelo histórico): segue para o destino.
  if (!authLoading && user && !loading) {
    return <Navigate to={user.must_change_password ? '/change-password' : destino} replace />
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Section - Hospital Image with Green Overlay */}
      <div className="hidden md:flex md:w-1/2 relative text-white p-8 lg:p-12 flex-col justify-between overflow-hidden">
        <img
          src={hospitalImg}
          alt="Hospital Estadual Costa dos Coqueiros"
          className="absolute inset-0 w-full h-full"
          style={{ objectFit: 'cover', objectPosition: 'center top' }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-emerald-900/80 via-emerald-800/40 to-emerald-700/30"></div>
        <div className="relative z-10">
          <div className="flex items-center space-x-3 mb-1">
            <div className="relative bg-white/15 p-3 rounded-lg backdrop-blur-sm">
              <Building2 className="w-10 h-10" />
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">HECC</h1>
              <p className="text-sm text-white/70">Hospital Estadual Costa dos Coqueiros</p>
            </div>
          </div>
          <h2 className="text-3xl font-bold mt-4 leading-tight">
            Sistema de Gestao de Insumos
          </h2>
        </div>
        <div className="relative z-10"></div>
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
                <Label htmlFor="login" className="text-gray-700">
                  Usuário
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="login"
                    name="login"
                    type="text"
                    autoComplete="username"
                    required
                    className="pl-10 bg-white border-gray-300"
                    placeholder="Digite seu CPF ou e-mail"
                  />
                  <User className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
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
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white group shadow-lg hover:shadow-xl transition-all duration-300"
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

              {/* Sem autocadastro (decisão de 16/09/2026): contas criadas pela
                  tela nasciam sem setor e duplicavam quem já tinha conta pelo
                  CPF. Usuário novo é criado pelo administrador. */}
              <p className="text-center text-sm text-gray-500">
                Não tem acesso ou esqueceu a senha? Procure o administrador do sistema.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}