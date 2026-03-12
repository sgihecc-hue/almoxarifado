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