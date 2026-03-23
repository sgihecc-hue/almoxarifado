import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2, Mail, Lock, User, ArrowRight, ArrowLeft, AlertCircle, ShieldAlert } from 'lucide-react'
import hospitalImg from '@/assets/hospital-hecc.jpg.jpeg'

export function Register() {
  const navigate = useNavigate()
  const { signUp } = useAuth()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const formData = new FormData(e.currentTarget)
      const email = formData.get('email') as string
      const password = formData.get('password') as string
      const confirmPassword = formData.get('confirmPassword') as string
      const fullName = formData.get('fullName') as string
      const role = 'solicitante'

      // Basic validation
      if (!email || !password || !confirmPassword || !fullName) {
        throw new Error('Por favor, preencha todos os campos')
      }

      // Password validation
      if (password.length < 8) {
        setError('A senha deve ter no mínimo 8 caracteres')
        setLoading(false)
        return
      }

      if (password !== confirmPassword) {
        setError('As senhas não coincidem')
        setLoading(false)
        return
      }

      await signUp(email, password, fullName, role)
      
      // Navigate to login page with success message
      navigate('/login', { 
        state: { 
          message: 'Conta criada com sucesso! Por favor, faça login.',
          type: 'success'
        }
      })
    } catch (error) {
      console.error('Registration error:', error)
      if (error instanceof Error) {
        setError(error.message)
      } else {
        setError('Erro ao criar conta')
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex">
      {/* Left Section - Hospital Image with Green Overlay */}
      <div className="hidden md:flex md:w-1/2 relative text-white p-8 lg:p-12 flex-col justify-end overflow-hidden">
        <img
          src={hospitalImg}
          alt="Hospital Estadual Costa dos Coqueiros"
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-emerald-900/90 via-emerald-800/60 to-emerald-700/30"></div>
        <div className="relative z-10">
          <div className="flex items-center space-x-3 mb-6">
            <div className="relative bg-white/15 p-3 rounded-lg backdrop-blur-sm">
              <Building2 className="w-10 h-10" />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">HECC</h1>
          </div>
          <h2 className="text-4xl font-bold mb-3 leading-tight">
            Sistema de Gestao<br />de Insumos
          </h2>
          <p className="text-lg text-white/80 max-w-lg">
            Hospital Estadual Costa dos Coqueiros
          </p>
        </div>
      </div>

      {/* Right Section */}
      <div className="w-full md:w-1/2 flex items-center justify-center p-6 sm:p-8 lg:p-12 bg-gray-50">
        <div className="w-full max-w-md space-y-8">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900 mb-3">
              Criar nova conta
            </h1>
            <p className="text-gray-600 text-lg">
              Sistema de Gestão de Insumos do HECC
            </p>
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-red-500 mt-0.5" />
              <div>
                <p className="text-red-800 font-medium">Erro ao criar conta</p>
                <p className="text-red-600 text-sm mt-1">
                  {error}
                </p>
              </div>
            </div>
          )}

          {/* Password Requirements */}
          <div className="p-4 bg-emerald-50 rounded-lg border border-emerald-200 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-5 h-5 text-emerald-600" />
              <h3 className="font-medium text-emerald-900">Requisitos de Senha</h3>
            </div>
            <ul className="space-y-1 text-sm text-emerald-700">
              <li>• Mínimo de 8 caracteres</li>
              <li>• Pelo menos uma letra maiúscula</li>
              <li>• Pelo menos uma letra minúscula</li>
              <li>• Pelo menos um número</li>
            </ul>
            <p className="text-xs text-emerald-600 mt-2">
              Exemplo de senha válida: MinhaSenh@123
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-4">
              <div>
                <Label htmlFor="fullName" className="text-gray-700">
                  Nome completo
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="fullName"
                    name="fullName"
                    type="text"
                    autoComplete="name"
                    required
                    className="pl-10 bg-white border-gray-300"
                    placeholder="Seu nome completo"
                  />
                  <User className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
                </div>
              </div>

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
                    autoComplete="new-password"
                    required
                    className="pl-10 bg-white border-gray-300"
                    placeholder="••••••••"
                  />
                  <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
                </div>
              </div>

              <div>
                <Label htmlFor="confirmPassword" className="text-gray-700">
                  Confirmar senha
                </Label>
                <div className="relative mt-1">
                  <Input
                    id="confirmPassword"
                    name="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    className="pl-10 bg-white border-gray-300"
                    placeholder="••••••••"
                  />
                  <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
                </div>
              </div>

              {/* Role é definido automaticamente como 'solicitante' — somente ADM pode alterar */}
            </div>

            <div className="flex flex-col gap-4">
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white group shadow-lg hover:shadow-xl transition-all duration-300"
                disabled={loading}
              >
                {loading ? (
                  'Criando conta...'
                ) : (
                  <span className="flex items-center justify-center">
                    Criar conta
                    <ArrowRight className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" />
                  </span>
                )}
              </Button>

              <Button
                type="button"
                variant="outline"
                className="w-full"
                onClick={() => navigate('/login')}
              >
                <ArrowLeft className="w-5 h-5 mr-2" />
                Voltar para login
              </Button>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}