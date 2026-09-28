import { createContext, useContext, useEffect, useRef, useState } from 'react'
import { supabase, definirAoPerderSessao } from '@/lib/supabase'
import { sanitizeEmailForAuth, validateEmail } from '@/lib/utils/sanitize'
import type { User } from '@/lib/types'
import type { AuthError, Session } from '@supabase/supabase-js'
import { SessaoExpiradaModal } from '@/components/sessao-expirada-modal'

// =============================================================================
// Sessão do usuário (auditoria 28/09/2026 — X-02, X-03, X-09, X-18, X-20)
//
// - O ouvinte onAuthStateChange é inscrito UMA vez (efeito com []). Antes o
//   efeito dependia de isInitialized e a limpeza cancelava o ouvinte sem
//   recriar: quando a sessão caía o app continuava "logado", consultando como
//   anônimo (listas vazias, "sem permissão" ao salvar).
// - Sessão perdida com alguém logado NÃO derruba a página: abre um modal de
//   login por cima (SessaoExpiradaModal) e o formulário continua lá.
// - Perfil desativado (is_active=false ou deleted_at) é recusado no login e
//   na abertura do app.
// - Banco lento: tenta de novo sozinho (com mensagem) antes de declarar erro.
// =============================================================================

interface AuthState {
  user: User | null
  loading: boolean
  /** Mensagem para a tela de login (desativado, sessão expirada...) ou de erro. */
  error: string | null
  connectionError: boolean
  /** Texto mostrado enquanto carrega ("Tentando de novo (2 de 5)..."). */
  statusMsg: string | null
}

interface AuthContextType extends AuthState {
  /** Entra e devolve o perfil carregado. Lança Error com mensagem pronta para a tela. */
  signIn: (email: string, password: string) => Promise<User>
  signUp: (email: string, password: string, fullName: string, role: string, departmentId?: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
  /** Tenta de novo carregar sessão e perfil (botão "Tentar de novo"). */
  checkConnection: () => Promise<boolean>
  /** Relê o perfil do banco (ex.: depois de trocar a senha). */
  refreshUser: () => Promise<void>
  /** true quando a sessão caiu com alguém logado (modal de login aberto). */
  sessaoPerdida: boolean
  /** Login pelo modal de sessão expirada (mesmo usuário continua na página). */
  reentrar: (login: string, password: string) => Promise<void>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

// ---------------------------------------------------------------------------
// Mensagens
// ---------------------------------------------------------------------------

const MSG_DESATIVADO = 'Seu usuário está desativado. Procure o administrador do sistema.'
const MSG_SEM_PERFIL = 'Sua senha foi aceita, mas seu cadastro no sistema não foi encontrado. Procure o administrador do sistema.'
const MSG_REDE = 'Não foi possível conectar ao servidor. Verifique sua internet e tente de novo.'

/** CPF (com ou sem pontuação) ou e-mail -> e-mail de login. */
export function loginParaEmail(login: string): string {
  const l = login.trim()
  if (l.includes('@')) return l.toLowerCase()
  return `${l.replace(/[.\-\s]/g, '')}@hecc.local`
}

function traduzirErroLogin(error: AuthError | Error): string {
  const e = error as AuthError & { code?: string }
  const msg = (e.message || '').toLowerCase()
  const code = (e.code || '').toLowerCase()
  const status = typeof e.status === 'number' ? e.status : undefined
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'CPF/e-mail ou senha incorretos.'
  }
  if (code === 'user_banned' || msg.includes('banned')) return MSG_DESATIVADO
  if (code === 'email_not_confirmed' || msg.includes('email not confirmed')) {
    return 'Seu e-mail ainda não foi confirmado. Procure o administrador do sistema.'
  }
  if (status === 429 || code.includes('rate_limit') || msg.includes('too many') || msg.includes('rate limit')) {
    return 'Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.'
  }
  if (code === 'email_provider_disabled' || msg.includes('provider is disabled')) {
    return 'O login está temporariamente indisponível no servidor. Avise o administrador do sistema.'
  }
  if (e.name === 'AuthRetryableFetchError' || msg.includes('failed to fetch') || msg.includes('network') || status === 0) {
    return MSG_REDE
  }
  if (status !== undefined && status >= 500) {
    return 'O servidor de login está com problema no momento. Tente de novo em instantes.'
  }
  return `Não foi possível entrar: ${e.message || 'erro desconhecido'}`
}

// ---------------------------------------------------------------------------
// Perfil (public.users) com novas tentativas para falha de rede/banco lento
// ---------------------------------------------------------------------------

type ResultadoPerfil =
  | { ok: true; user: User }
  | { ok: false; tipo: 'rede' | 'sem-perfil' | 'inativo' | 'jwt' | 'outro'; mensagem: string }

interface ErroPg { message?: string; code?: string }

function ehErroTransitorio(err: ErroPg): boolean {
  const code = err.code ?? ''
  const msg = (err.message ?? '').toLowerCase()
  if (!code) return true // falha de fetch, timeout, 502/503/504 do proxy
  if (/^PGRST00[0-3]$/.test(code)) return true // PostgREST sem conexão com o banco
  if (code === '57014' || code === '53300') return true // statement timeout / muitas conexões
  return msg.includes('fetch') || msg.includes('network') || msg.includes('timeout') || msg.includes('abort')
}

function ehErroJwt(err: ErroPg): boolean {
  const msg = (err.message ?? '').toLowerCase()
  return err.code === 'PGRST301' || err.code === 'PGRST303' || msg.includes('jwt')
}

async function buscarPerfilUmaVez(userId: string): Promise<ResultadoPerfil> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const { data, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', userId)
      .abortSignal(ctrl.signal)
      .maybeSingle()
    if (error) {
      if (ehErroJwt(error)) return { ok: false, tipo: 'jwt', mensagem: 'Sua sessão expirou. Entre novamente.' }
      if (ehErroTransitorio(error)) return { ok: false, tipo: 'rede', mensagem: MSG_REDE }
      return { ok: false, tipo: 'outro', mensagem: `Erro ao carregar seu perfil: ${error.message}` }
    }
    if (!data) return { ok: false, tipo: 'sem-perfil', mensagem: MSG_SEM_PERFIL }
    const perfil = data as User
    if (perfil.deleted_at || perfil.is_active === false) {
      return { ok: false, tipo: 'inativo', mensagem: MSG_DESATIVADO }
    }
    return { ok: true, user: perfil }
  } catch {
    return { ok: false, tipo: 'rede', mensagem: MSG_REDE }
  } finally {
    clearTimeout(timer)
  }
}

const ESPERAS_MS = [1000, 2000, 4000, 8000] // 5 tentativas no total (~15 s + tempo das consultas)

async function buscarPerfil(userId: string, aoRepetir?: (tentativa: number, total: number) => void): Promise<ResultadoPerfil> {
  const total = ESPERAS_MS.length + 1
  let res = await buscarPerfilUmaVez(userId)
  for (let i = 0; i < ESPERAS_MS.length && !res.ok && res.tipo === 'rede'; i++) {
    aoRepetir?.(i + 2, total)
    await new Promise((r) => setTimeout(r, ESPERAS_MS[i]))
    res = await buscarPerfilUmaVez(userId)
  }
  return res
}

// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    connectionError: false,
    statusMsg: null,
  })
  const [sessaoPerdida, setSessaoPerdida] = useState(false)

  // Refs para o ouvinte (inscrito uma vez) enxergar o valor ATUAL.
  const userRef = useRef<User | null>(null)
  const iniciadoRef = useRef(false)
  const entrandoRef = useRef(false)
  const execucaoRef = useRef(0)

  function definirUsuario(user: User | null, extra: Partial<AuthState> = {}) {
    userRef.current = user
    setState({ user, loading: false, error: null, connectionError: false, statusMsg: null, ...extra })
  }

  /** Sai sem passar pelo modal de sessão perdida (userRef zerado antes). */
  async function sairSilencioso() {
    userRef.current = null
    try { await supabase.auth.signOut() } catch { /* sessão local some de qualquer jeito */ }
  }

  async function iniciar() {
    const execucao = ++execucaoRef.current
    setState((prev) => ({ ...prev, loading: true, connectionError: false, statusMsg: 'Verificando sua sessão...' }))

    // getSession pode precisar renovar o token (rede). Falha de rede aqui não
    // pode mandar para o login quem tem sessão válida: tenta de novo.
    let session: Session | null = null
    for (let i = 0; ; i++) {
      const { data, error } = await supabase.auth.getSession()
      if (execucao !== execucaoRef.current) return
      const transitorio = error?.name === 'AuthRetryableFetchError'
      if (!transitorio) {
        session = data.session
        break
      }
      if (i >= ESPERAS_MS.length) {
        iniciadoRef.current = true
        userRef.current = null
        setState({ user: null, loading: false, error: MSG_REDE, connectionError: true, statusMsg: null })
        return
      }
      setState((prev) => ({ ...prev, statusMsg: `O servidor está demorando para responder. Tentando de novo (${i + 2} de ${ESPERAS_MS.length + 1})...` }))
      await new Promise((r) => setTimeout(r, ESPERAS_MS[i]))
    }

    if (!session?.user?.id) {
      iniciadoRef.current = true
      definirUsuario(null)
      return
    }

    const res = await buscarPerfil(session.user.id, (t, total) => {
      if (execucao === execucaoRef.current) {
        setState((prev) => ({ ...prev, statusMsg: `O servidor está demorando para responder. Tentando de novo (${t} de ${total})...` }))
      }
    })
    if (execucao !== execucaoRef.current) return
    iniciadoRef.current = true

    if (res.ok) {
      definirUsuario(res.user)
      return
    }
    if (res.tipo === 'rede' || res.tipo === 'outro') {
      userRef.current = null
      setState({ user: null, loading: false, error: res.mensagem, connectionError: true, statusMsg: null })
      return
    }
    // inativo, sem perfil ou token inválido: encerra a sessão e explica no login
    await sairSilencioso()
    definirUsuario(null, { error: res.mensagem })
  }

  async function tratarEvento(event: string, session: Session | null) {
    if (!iniciadoRef.current) return // a inicialização cuida do estado inicial
    switch (event) {
      case 'TOKEN_REFRESHED':
        setSessaoPerdida(false)
        return
      case 'SIGNED_IN': {
        if (!session?.user) return
        if (userRef.current && session.user.id === userRef.current.id) {
          setSessaoPerdida(false)
          return
        }
        if (entrandoRef.current) return // signIn/reentrar cuidam disso
        // Outro login feito em outra aba: carrega o perfil do novo usuário.
        const res = await buscarPerfil(session.user.id)
        if (res.ok) {
          setSessaoPerdida(false)
          definirUsuario(res.user)
        } else if (res.tipo === 'inativo' || res.tipo === 'sem-perfil') {
          await sairSilencioso()
          definirUsuario(null, { error: res.mensagem })
        }
        return
      }
      case 'USER_UPDATED': {
        if (!session?.user || !userRef.current) return
        const res = await buscarPerfilUmaVez(session.user.id)
        if (res.ok) definirUsuario(res.user)
        return
      }
      case 'SIGNED_OUT':
        // Saída pelo botão "Sair" zera userRef antes; se ainda há usuário aqui,
        // a sessão CAIU (token vencido, saída em outra aba...). Não derruba a
        // tela: abre o modal para entrar de novo sem perder o que foi digitado.
        if (userRef.current) setSessaoPerdida(true)
        return
      default:
        return
    }
  }

  useEffect(() => {
    // O ouvinte é inscrito UMA vez e vive enquanto o app estiver aberto.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      // Não chamar o supabase direto aqui dentro: o auth-js segura uma trava
      // durante o aviso e uma consulta com await pode travar. Adia um tique.
      setTimeout(() => { void tratarEvento(event, session) }, 0)
    })
    // Resposta 401 de token vencido que não deu para renovar (lib/supabase.ts).
    definirAoPerderSessao(() => { if (userRef.current) setSessaoPerdida(true) })
    void iniciar()
    return () => {
      subscription.unsubscribe()
      definirAoPerderSessao(null)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const clearError = () => {
    setState((prev) => ({ ...prev, error: null, connectionError: false }))
  }

  const checkConnection = async (): Promise<boolean> => {
    await iniciar()
    return !!userRef.current
  }

  async function refreshUser() {
    if (!userRef.current) return
    const res = await buscarPerfil(userRef.current.id)
    if (res.ok) definirUsuario(res.user)
  }

  async function handleSignIn(email: string, password: string): Promise<User> {
    setState((prev) => ({ ...prev, error: null, connectionError: false }))
    if (!email || !password) throw new Error('Preencha o CPF/e-mail e a senha.')
    const sanitizedEmail = sanitizeEmailForAuth(email.trim().toLowerCase())
    if (!validateEmail(sanitizedEmail)) throw new Error('CPF ou e-mail em formato inválido.')
    if (password.length > 128) throw new Error('Senha muito longa.')

    entrandoRef.current = true
    try {
      let data: { session: Session | null; user: { id: string } | null }
      try {
        const r = await supabase.auth.signInWithPassword({ email: sanitizedEmail, password })
        if (r.error) throw r.error
        data = r.data
      } catch (e) {
        throw new Error(traduzirErroLogin(e as AuthError))
      }
      if (!data.user) throw new Error('Não foi possível entrar: resposta vazia do servidor.')

      const res = await buscarPerfil(data.user.id)
      if (!res.ok) {
        // Sem perfil válido não fica sessão aberta pela metade.
        await sairSilencioso()
        definirUsuario(null)
        throw new Error(res.tipo === 'rede'
          ? 'Sua senha foi aceita, mas não foi possível carregar seu perfil (falha de conexão). Tente de novo.'
          : res.mensagem)
      }
      setSessaoPerdida(false)
      definirUsuario(res.user)
      return res.user
    } finally {
      entrandoRef.current = false
    }
  }

  async function reentrar(login: string, password: string) {
    const email = sanitizeEmailForAuth(loginParaEmail(login))
    if (!login.trim() || !password) throw new Error('Preencha o CPF/e-mail e a senha.')
    const anterior = userRef.current
    entrandoRef.current = true
    try {
      const r = await supabase.auth.signInWithPassword({ email, password })
      if (r.error) throw new Error(traduzirErroLogin(r.error))
      if (!r.data.user) throw new Error('Não foi possível entrar: resposta vazia do servidor.')
      if (!anterior || r.data.user.id !== anterior.id) {
        // Entrou OUTRA pessoa: a tela aberta era de outro usuário; recomeça do início.
        window.location.assign('/')
        return
      }
      const res = await buscarPerfil(r.data.user.id)
      if (!res.ok && (res.tipo === 'inativo' || res.tipo === 'sem-perfil')) {
        await sairSilencioso()
        setSessaoPerdida(false)
        definirUsuario(null, { error: res.mensagem })
        return
      }
      if (res.ok) definirUsuario(res.user)
      setSessaoPerdida(false)
    } finally {
      entrandoRef.current = false
    }
  }

  // Autocadastro desligado em 16/09/2026 (DISABLE_SIGNUP no servidor): conta
  // nova só pelo administrador (Edge Function admin-create-user).
  async function handleSignUp(): Promise<void> {
    throw new Error('O autocadastro está desativado. Procure o administrador do sistema.')
  }

  async function handleSignOut() {
    // Limpa o módulo ativo para que o próximo login force escolha explícita
    try { localStorage.removeItem('sgi-active-module') } catch { /* navegador sem storage */ }
    setSessaoPerdida(false)
    definirUsuario(null)
    await sairSilencioso()
  }

  const value: AuthContextType = {
    ...state,
    checkConnection,
    refreshUser,
    signIn: handleSignIn,
    signUp: handleSignUp,
    signOut: handleSignOut,
    clearError,
    sessaoPerdida,
    reentrar,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
      {sessaoPerdida && state.user && <SessaoExpiradaModal />}
    </AuthContext.Provider>
  )
}
