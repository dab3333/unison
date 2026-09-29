import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { E2E } from './identity'
import { supabase } from './supabase'

export interface AuthUser { id: string; name: string }
interface Ctx {
  user: AuthUser | null
  loading: boolean
  signInWith(p: 'google' | 'discord'): Promise<void>
  signInWithEmail(email: string): Promise<void>
  signOut(): Promise<void>
}
const AuthContext = createContext<Ctx>(null as never)

function toUser(s: Session | null): AuthUser | null {
  if (!s) return null
  const m = (s.user.user_metadata ?? {}) as Record<string, string | undefined>
  return { id: s.user.id, name: m.full_name ?? m.name ?? s.user.email?.split('@')[0] ?? 'Host' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!E2E)

  useEffect(() => {
    if (E2E) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const redirectTo = `${window.location.origin}/dashboard`
  const user: AuthUser | null = E2E
    ? localStorage.getItem('e2e-token') ? { id: 'e2e-host', name: 'E2E Host' } : null
    : toUser(session)

  const value: Ctx = {
    user,
    loading,
    signInWith: async (provider) => {
      await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
    },
    signInWithEmail: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
      if (error) throw error
    },
    signOut: async () => {
      await supabase.auth.signOut()
      if (E2E) localStorage.removeItem('e2e-token')
      window.location.assign('/')
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
