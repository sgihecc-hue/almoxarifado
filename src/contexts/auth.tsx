import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { sanitizeEmailForAuth, sanitizeForDisplay, validateEmail } from '@/lib/utils/sanitize'
import type { User } from '@/lib/types'
import type { Session } from '@supabase/supabase-js'
import { ErrorBoundary } from '@/components/ui/error-boundary'

interface AuthState {
  user: User | null
  loading: boolean
  error: string | null
  connectionError: boolean
}

interface AuthContextType extends AuthState {
  signIn: (email: string, password: string) => Promise<void>
  signUp: (email: string, password: string, fullName: string, role: string) => Promise<void>
  signOut: () => Promise<void>
  clearError: () => void
  checkConnection: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextType | null>(null)

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    loading: true,
    error: null,
    connectionError: false,
  })
  const [initializationAttempts, setInitializationAttempts] = useState(0)
  const [isInitialized, setIsInitialized] = useState(false)

  const clearError = () => {
    setState(prev => ({ ...prev, error: null, connectionError: false }))
  }

  const checkConnection = async (): Promise<boolean> => {
    try {
      const { error } = await supabase.from('users').select('id').limit(1)
      const isConnected = !error
      setState(prev => ({ ...prev, connectionError: !isConnected }))
      return isConnected
    } catch (error) {
      console.error('Connection check failed:', error)
      setState(prev => ({ ...prev, connectionError: true }))
      return false
    }
  }

  useEffect(() => {
    if (isInitialized) return
    
    let timeoutId: NodeJS.Timeout
    
    // Check current session
    async function initializeAuth() {
      // Prevent infinite loops
      if (initializationAttempts >= 3) {
        console.error('Too many initialization attempts, stopping')
        setState({ user: null, loading: false, error: 'Erro de inicialização', connectionError: true })
        return
      }
      
      try {
        setInitializationAttempts(prev => prev + 1)
        setState(prev => ({ ...prev, loading: true }))
        
        // Check connection first
        const isConnected = await checkConnection()
        if (!isConnected) {
          setState({ user: null, loading: false, error: 'Erro de conexão com o servidor', connectionError: true })
          return
        }
        
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          await loadUser(session)
        } else {
          setState({ user: null, loading: false, error: null, connectionError: false })
        }
        
        setIsInitialized(true)
      } catch (error) {
        console.error('Error getting session:', error)
        setState({ user: null, loading: false, error: 'Erro de conexão com o servidor', connectionError: true })
      }
    }
    
    // Add timeout to prevent hanging
    timeoutId = setTimeout(() => {
      console.warn('Auth initialization timeout')
      setState({ user: null, loading: false, error: 'Timeout na inicialização', connectionError: true })
    }, 10000) // 10 seconds timeout
    
    initializeAuth().finally(() => {
      clearTimeout(timeoutId)
      setState(prev => ({ ...prev, loading: false }))
    })

    // Listen for auth changes
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await loadUser(session)
      } else {
        setState({ user: null, loading: false, error: null, connectionError: false })
      }
    })

    return () => {
      try {
        subscription.unsubscribe()
      } catch (error) {
        console.error('Error unsubscribing from auth state changes:', error)
      }
      if (timeoutId) {
        clearTimeout(timeoutId)
      }
    }
  }, [isInitialized])

  async function loadUser(session: Session) {
    if (!session?.user?.id) {
      setState({ user: null, loading: false, error: 'Sessão inválida', connectionError: false })
      return
    }
    
    try {
      // Check if user profile exists with retry logic
      let retries = 3
      while (retries > 0) {
        try {
          const { data: existingProfile, error: checkError } = await supabase
            .from('users')
            .select('*')
            .eq('id', session.user.id)
            .maybeSingle()

          if (checkError) {
            if (checkError.code === 'PGRST301' && retries > 1) {
              // RLS policy issue, retry
              retries--
              await new Promise(resolve => setTimeout(resolve, 1000))
              continue
            }
            console.error('Error checking user profile:', checkError)
            setState({ user: null, loading: false, error: `Erro ao verificar perfil: ${checkError.message}`, connectionError: false })
            return
          }

          if (existingProfile) {
            setState({
              user: existingProfile,
              loading: false,
              error: null,
              connectionError: false,
            })
            return
          }

          // Profile not found
          console.warn('User profile not found')
          setState({ user: null, loading: false, error: 'Perfil de usuário não encontrado', connectionError: false })
          return
        } catch (fetchError) {
          if (retries === 1) {
            console.error('Network error in loadUser:', fetchError)
            if (fetchError instanceof TypeError && fetchError.message === 'Failed to fetch') {
              setState({ user: null, loading: false, error: 'Erro de rede: Não foi possível conectar ao servidor. Verifique sua conexão com a internet.', connectionError: true })
            } else {
              setState({ user: null, loading: false, error: 'Erro ao carregar usuário', connectionError: true })
            }
            return
          }
          retries--
          await new Promise(resolve => setTimeout(resolve, 1000))
        }
      }
    } catch (error) {
      console.error('Error in loadUser:', error)
      setState({ user: null, loading: false, error: 'Erro inesperado ao carregar usuário.', connectionError: true })
    }
  }

  async function handleSignIn(email: string, password: string) {
    try {
      setState(prev => ({ ...prev, error: null }))

      if (!email || !password) {
        throw new Error('Email e senha são obrigatórios')
      }

      const sanitizedEmail = sanitizeEmailForAuth(email.trim().toLowerCase())
      if (!validateEmail(sanitizedEmail)) {
        throw new Error('Formato de email inválido')
      }

      if (password.length > 128) {
        throw new Error('Senha muito longa')
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: sanitizedEmail,
        password: password,
      })

      if (error) {
        console.error('Sign in error:', error)
        if (error.message?.includes('Invalid login credentials')) {
          throw new Error('Email ou senha inválidos')
        } else if (error.message?.includes('Email not confirmed')) {
          throw new Error('Email não confirmado')
        } else if (error.message?.includes('Too many requests')) {
          throw new Error('Muitas tentativas. Tente novamente em alguns minutos')
        }
        throw error
      }

      // Wait for user profile to be loaded after successful auth
      if (data.session) {
        await loadUser(data.session)
      }

    } catch (error) {
      console.error('Sign in error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Erro ao fazer login'
      setState(prev => ({ ...prev, error: errorMessage }))
      throw error instanceof Error ? error : new Error('Erro ao fazer login')
    }
  }

  async function handleSignUp(email: string, password: string, fullName: string, role: string) {
    try {
      setState(prev => ({ ...prev, error: null }))
      
      // Validate inputs first
      if (!email || !password || !fullName || !role) {
        throw new Error('Todos os campos são obrigatórios')
      }
      
      if (password.length < 8) {
        throw new Error('A senha deve ter no mínimo 8 caracteres')
      }
      
      if (password.length > 128) {
        throw new Error('Senha muito longa')
      }
      
      // Validação básica de senha - removendo validações muito restritivas
      const hasUpperCase = /[A-Z]/.test(password)
      const hasLowerCase = /[a-z]/.test(password)
      const hasNumbers = /\d/.test(password)
      
      if (!hasUpperCase || !hasLowerCase || !hasNumbers) {
        throw new Error('A senha deve conter pelo menos uma letra maiúscula, uma minúscula e um número')
      }

      const sanitizedEmail = sanitizeEmailForAuth(email)
      const sanitizedFullName = sanitizeForDisplay(fullName.trim())

      // Create the user in auth
      const { data, error } = await supabase.auth.signUp({
        email: sanitizedEmail,
        password: password, // Don't trim passwords
        options: {
          data: {
            full_name: sanitizedFullName,
            role: role,
          },
          emailRedirectTo: `${window.location.origin}/login`
        },
      })

      if (error) {
        console.error('Sign up error:', error)
        if (error.message.includes('User already registered')) {
          throw new Error('Este e-mail já está cadastrado')
        } else if (error.message.includes('Password should be at least')) {
          throw new Error('Senha deve ter pelo menos 6 caracteres')
        } else if (error.message.includes('Signup is disabled')) {
          throw new Error('Cadastro está desabilitado')
        }
        throw error
      }

      if (!data.user) {
        throw new Error('No user returned from sign up')
      }

      // Check if profile already exists
      const { data: existingProfile } = await supabase
        .from('users')
        .select('*')
        .eq('id', data.user.id)
        .maybeSingle()

      if (!existingProfile) {
        // Create profile only if it doesn't exist
        const { error: profileError } = await supabase
          .from('users')
          .insert({
            id: data.user.id,
            email: sanitizedEmail,
            full_name: sanitizedFullName,
            role: role
          })

        if (profileError) {
          console.error('Error creating user profile:', profileError)
          throw new Error('Erro ao criar perfil de usuário')
        }
      }

      // Don't sign in automatically - redirect to login page
      return
    } catch (error) {
      console.error('Sign up error:', error)
      const errorMessage = error instanceof Error ? error.message : 'Erro ao criar conta'
      setState(prev => ({ ...prev, error: errorMessage }))
      if (error instanceof TypeError && error.message === 'Failed to fetch') {
        throw new Error('Erro de conexão ao criar usuário. Por favor, tente novamente.')
      }
      if (error instanceof Error) {
        throw error
      }
      throw new Error('Erro ao criar conta')
    }
  }

  async function handleSignOut() {
    try {
      setState(prev => ({ ...prev, error: null }))
      try {
        const { error } = await supabase.auth.signOut()
        if (error) throw error
      } catch (fetchError) {
        console.error('Network error during sign out:', fetchError)
        // Still set user to null even if signOut fails
      }
      setState({ user: null, loading: false, error: null, connectionError: false })
    } catch (error) {
      console.error('Sign out error:', error)
      // Set user to null even if there's an error
      setState({ user: null, loading: false, error: null, connectionError: false })
    }
  }

  const value = {
    ...state,
    checkConnection,
    signIn: handleSignIn,
    signUp: handleSignUp,
    signOut: handleSignOut,
    clearError,
  }

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={value}>
        {children}
      </AuthContext.Provider>
    </ErrorBoundary>
  )
}