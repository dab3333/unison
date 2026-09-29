import { supabase } from './supabase'

export const E2E = import.meta.env.VITE_E2E === '1'
const GUEST_KEY = 'unison.guest'

export interface StoredGuest { token: string; nickname: string }
export interface Identity { token: string; isGuest: boolean }

export function loadGuest(): StoredGuest | null {
  try {
    return JSON.parse(localStorage.getItem(GUEST_KEY) ?? 'null') as StoredGuest | null
  } catch {
    return null
  }
}
export function saveGuest(g: StoredGuest): void {
  try {
    localStorage.setItem(GUEST_KEY, JSON.stringify(g))
  } catch {
    /* private mode: the guest just re-registers next visit */
  }
}
export async function getAccessToken(): Promise<string | null> {
  if (E2E) return localStorage.getItem('e2e-token')
  const { data } = await supabase.auth.getSession()
  return data.session?.access_token ?? null
}
export async function getIdentity(): Promise<Identity | null> {
  const token = await getAccessToken()
  if (token) return { token, isGuest: false }
  const g = loadGuest()
  return g ? { token: g.token, isGuest: true } : null
}
