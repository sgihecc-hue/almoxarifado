import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Building2, Mail, Lock, User, ArrowRight, ArrowLeft, AlertCircle, ShieldAlert } from 'lucide-react'
import type { UserRole } from '@/lib/types'

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
      const role = formData.get('role') as UserRole

      // Basic validation
      if (!email || !password || !confirmPassword || !fullName || !role) {
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
          <div className="p-4 bg-blue-50 rounded-lg border border-blue-200 mb-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-5 h-5 text-blue-600" />
              <h3 className="font-medium text-blue-900">Requisitos de Senha</h3>
            </div>
            <ul className="space-y-1 text-sm text-blue-700">
              <li>• Mínimo de 8 caracteres</li>
              <li>• Pelo menos uma letra maiúscula</li>
              <li>• Pelo menos uma letra minúscula</li>
              <li>• Pelo menos um número</li>
            </ul>
            <p className="text-xs text-blue-600 mt-2">
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

              <div>
                <Label htmlFor="role" className="text-gray-700">
                  Função
                </Label>
                <select
                  id="role"
                  name="role"
                  className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-primary-500 focus:border-primary-500 sm:text-sm rounded-md bg-white"
                  required
                >
                  <option value="">Selecione sua função</option>
                  <option value="solicitante">Solicitante</option>
                  <option value="gestor">Gestor</option>
                  <option value="administrador">Administrador</option>
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Button
                type="submit"
                className="w-full bg-gradient-to-r from-blue-600 to-cyan-600 hover:from-blue-700 hover:to-cyan-700 text-white group shadow-lg hover:shadow-xl transition-all duration-300"
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