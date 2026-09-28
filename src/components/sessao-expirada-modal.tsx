import { useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Lock, LogIn } from 'lucide-react'
import { useAuth } from '@/contexts/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Aparece quando a sessão cai com alguém logado (token vencido, saída em outra
// aba). Fica POR CIMA da tela: o que estava digitado continua lá. Entrando com
// o mesmo usuário, o modal fecha e é só clicar em salvar de novo.
export function SessaoExpiradaModal() {
  const { user, reentrar, signOut } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [login, setLogin] = useState(() => user?.cpf || (user?.email?.endsWith('@hecc.local') ? user.email.split('@')[0] : user?.email) || '')
  const [senha, setSenha] = useState('')
  const [erro, setErro] = useState('')
  const [entrando, setEntrando] = useState(false)
  const travaRef = useRef(false)

  async function entrar(e: React.FormEvent) {
    e.preventDefault()
    if (travaRef.current) return
    travaRef.current = true
    setEntrando(true)
    setErro('')
    try {
      await reentrar(login, senha)
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível entrar.')
    } finally {
      travaRef.current = false
      setEntrando(false)
    }
  }

  async function irParaLogin() {
    const volta = location.pathname + location.search
    await signOut()
    navigate('/login', { replace: true, state: { from: volta } })
  }

  return (
    <div className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
        <div className="flex items-center gap-3 mb-3">
          <div className="p-2 bg-amber-100 rounded-lg">
            <Lock className="w-6 h-6 text-amber-600" />
          </div>
          <h2 className="text-lg font-bold text-gray-900">Sua sessão expirou</h2>
        </div>
        <p className="text-sm text-gray-600 mb-4">
          Entre de novo para continuar. <strong>O que você estava fazendo nesta tela não foi perdido</strong>, mas
          a última ação pode não ter sido salva: confira e repita depois de entrar.
        </p>
        <form onSubmit={entrar} className="space-y-3">
          <div>
            <Label htmlFor="relogin-usuario">CPF ou e-mail</Label>
            <Input id="relogin-usuario" value={login} onChange={(e) => setLogin(e.target.value)} autoComplete="username" required />
          </div>
          <div>
            <Label htmlFor="relogin-senha">Senha</Label>
            <Input id="relogin-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" autoFocus required />
          </div>
          {erro && <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2">{erro}</div>}
          <div className="flex flex-col sm:flex-row gap-2 pt-1">
            <Button type="submit" className="flex-1" disabled={entrando}>
              <LogIn className="w-4 h-4 mr-2" />
              {entrando ? 'Entrando...' : 'Entrar e continuar'}
            </Button>
            <Button type="button" variant="outline" onClick={irParaLogin} disabled={entrando}>
              Ir para a tela de login
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
