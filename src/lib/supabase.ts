import { createClient } from '@supabase/supabase-js'
import type { Database } from './types/database'

// Get environment variables
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!SUPABASE_URL) {
  throw new Error('Missing environment variable: VITE_SUPABASE_URL')
}

if (!SUPABASE_ANON_KEY) {
  throw new Error('Missing environment variable: VITE_SUPABASE_ANON_KEY')
}

let supabaseInstance: ReturnType<typeof createClient<Database>> | null = null

// =============================================================================
// Token vencido (401 do PostgREST/Edge Functions) — auditoria 28/09/2026, X-03
//
// Antes: qualquer 401 de JWT fazia signOut + window.location.href='/login' e o
// que a pessoa estava digitando se perdia; depois do login ela caía em '/'.
// Agora: tenta renovar o token UMA vez e repete a MESMA requisição. Se não der
// (refresh token vencido/revogado), avisa o AuthProvider, que abre um modal de
// login POR CIMA da tela (a página e o formulário continuam montados).
// Chamadas do próprio login (/auth/v1/) nunca passam por aqui.
// =============================================================================

let aoPerderSessao: (() => void) | null = null

/** O AuthProvider registra aqui o que fazer quando a sessão não puder ser renovada. */
export function definirAoPerderSessao(fn: (() => void) | null) {
  aoPerderSessao = fn
}

// Várias requisições podem receber 401 ao mesmo tempo: renova uma vez só.
// token: novo token (ou null); perdida: a sessão acabou mesmo (não foi só a rede).
type Renovacao = { token: string | null; perdida: boolean }
let renovacaoEmAndamento: Promise<Renovacao> | null = null

function renovarToken(): Promise<Renovacao> {
  if (!renovacaoEmAndamento) {
    renovacaoEmAndamento = (async (): Promise<Renovacao> => {
      try {
        if (!supabaseInstance) return { token: null, perdida: false }
        const { data, error } = await supabaseInstance.auth.refreshSession()
        if (error) return { token: null, perdida: error.name !== 'AuthRetryableFetchError' }
        if (!data.session) return { token: null, perdida: true }
        return { token: data.session.access_token, perdida: false }
      } catch {
        return { token: null, perdida: false }
      }
    })()
    renovacaoEmAndamento.finally(() => {
      // Solta depois que todos os que esperavam já pegaram o resultado.
      setTimeout(() => { renovacaoEmAndamento = null }, 0)
    })
  }
  return renovacaoEmAndamento
}

function urlDe(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

const interceptedFetch: typeof fetch = async (input, init) => {
  const response = await fetch(input, init)
  // Só nos importa 401. Outros erros (4xx/5xx) são tratados pelo chamador.
  if (response.status !== 401) return response
  if (urlDe(input).includes('/auth/v1/')) return response

  let ehJwt = false
  try {
    // Clona pra não consumir o body original
    const lower = (await response.clone().text()).toLowerCase()
    // PostgREST devolve { code: 'PGRST301' } / mensagens com 'jwt'/'expired'/'invalid token'
    ehJwt = lower.includes('jwt') || lower.includes('expired') || lower.includes('invalid token') ||
      lower.includes('pgrst301') || lower.includes('pgrst303')
  } catch {
    // Se não conseguir ler o body, não mexe
  }
  if (!ehJwt) return response

  const { token: novoToken, perdida } = await renovarToken()
  if (!novoToken) {
    // Falha de rede na renovação não é sessão perdida: devolve o erro e o
    // auth-js tenta renovar de novo sozinho.
    if (perdida) aoPerderSessao?.()
    return response
  }
  const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined))
  headers.set('Authorization', `Bearer ${novoToken}`)
  try {
    return await fetch(input, { ...init, headers })
  } catch {
    return response
  }
}

export const supabase = (() => {
  if (supabaseInstance) {
    return supabaseInstance
  }

  try {
    supabaseInstance = createClient<Database>(
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true,
      storage: localStorage,
      storageKey: 'supabase.auth.token',
      flowType: 'pkce'
    },
    db: {
      schema: 'public'
    },
    global: {
      headers: {
        'X-Client-Info': 'warehouse-management-system',
      },
      fetch: interceptedFetch,
    },
    realtime: {
      params: {
        eventsPerSecond: 10
      }
    }
  }
    )

    return supabaseInstance
  } catch (error) {
    console.error('Failed to create Supabase client:', error)
    throw error
  }
})()

// Add connection health check
export const checkSupabaseHealth = async (): Promise<boolean> => {
  try {
    // Add timeout to prevent hanging requests
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000) // 5 second timeout
    
    const { error } = await supabase.from('users').select('id').limit(1)
    clearTimeout(timeoutId)
    return !error
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.error('Supabase health check timed out')
      } else {
        console.error('Supabase health check failed:', error.message)
      }
    }
    return false
  }
}