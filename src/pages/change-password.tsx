import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { supabase } from '@/lib/supabase'
import { exigirLinhas } from '@/lib/utils/seguro'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Lock, ShieldCheck } from 'lucide-react'

export function ChangePassword() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, refreshUser, signOut } = useAuth()
  const [loading, setLoading] = useState(false)
  const salvandoRef = useRef(false)
  // A senha já foi trocada no login, só faltou desligar a flag no cadastro:
  // no "salvar de novo" não troca a senha outra vez (daria "senha igual").
  const senhaJaTrocadaRef = useRef(false)
  const destino = (() => {
    const from = (location.state as { from?: unknown } | null)?.from
    return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/change-password' ? from : '/'
  })()
  const [error, setError] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    if (newPassword.length < 8) {
      setError('A senha deve ter no minimo 8 caracteres')
      return
    }

    if (newPassword !== confirmPassword) {
      setError('As senhas nao coincidem')
      return
    }

    if (salvandoRef.current || !user?.id) return
    salvandoRef.current = true
    setLoading(true)
    let senhaTrocada = senhaJaTrocadaRef.current
    try {
      if (!senhaJaTrocadaRef.current) {
        // Update password in Supabase Auth
        const { error: authError } = await supabase.auth.updateUser({
          password: newPassword,
        })

        if (authError) throw authError
        senhaTrocada = true
        senhaJaTrocadaRef.current = true
      }

      // Desliga a exigência. Antes o resultado era ignorado: se falhasse, a
      // pessoa seguia e caía de novo na troca no próximo login.
      exigirLinhas(await supabase
        .from('users')
        .update({ must_change_password: false })
        .eq('id', user.id)
        .select('id'))

      await refreshUser()
      navigate(destino, { replace: true })
    } catch (err) {
      console.error('Error changing password:', err)
      const msg = err instanceof Error ? err.message : ''
      if (senhaTrocada) {
        setError('A nova senha foi salva, mas não foi possível registrar a troca no seu cadastro. Clique em salvar de novo.')
      } else if (/same|different from the old/i.test(msg)) {
        setError('A nova senha precisa ser diferente da senha atual.')
      } else if (/weak|at least/i.test(msg)) {
        setError('Senha fraca: use pelo menos 8 caracteres.')
      } else if (/fetch|network/i.test(msg)) {
        setError('Sem conexão com o servidor. Tente de novo.')
      } else {
        setError(`Erro ao alterar senha: ${msg || 'tente novamente.'}`)
      }
    } finally {
      salvandoRef.current = false
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-emerald-600 to-teal-500 p-6">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="text-center mb-6">
          <div className="mx-auto w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mb-4">
            <ShieldCheck className="w-8 h-8 text-emerald-600" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Alterar Senha</h1>
          <p className="text-gray-600 mt-2">
            Por seguranca, voce precisa criar uma nova senha para acessar o sistema.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <Label htmlFor="newPassword" className="text-gray-700">Nova Senha</Label>
            <div className="relative mt-1">
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                required
                minLength={8}
                className="pl-10 bg-white border-gray-300"
                placeholder="Minimo 8 caracteres"
              />
              <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
            </div>
          </div>

          <div>
            <Label htmlFor="confirmPassword" className="text-gray-700">Confirmar Nova Senha</Label>
            <div className="relative mt-1">
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                minLength={8}
                className="pl-10 bg-white border-gray-300"
                placeholder="Repita a nova senha"
              />
              <Lock className="w-5 h-5 text-gray-400 absolute left-3 top-2" />
            </div>
          </div>

          {error && (
            <div className="text-red-500 text-sm text-center bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          <Button
            type="submit"
            className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-700 hover:to-teal-600 text-white shadow-lg"
            disabled={loading}
          >
            {loading ? 'Salvando...' : 'Salvar Nova Senha'}
          </Button>
          <button
            type="button"
            onClick={async () => { await signOut(); navigate('/login', { replace: true }) }}
            className="w-full text-sm text-gray-500 hover:text-gray-700"
          >
            Sair
          </button>
        </form>
      </div>
    </div>
  )
}
