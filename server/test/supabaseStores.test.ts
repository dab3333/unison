import { describe } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { runStoreContract, OWNER } from './storeContract'
import { createSupabaseStores } from '../src/supabaseStores'

const url = process.env.SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

// Runs only when pointed at a real (throwaway) Supabase project with the migration applied.
describe.skipIf(!url || !key)('supabase', () => {
  runStoreContract('supabase', async () => {
    const admin = createClient(url!, key!, { auth: { persistSession: false } })
    const { error } = await admin.auth.admin.createUser({ id: OWNER, email: 'owner@test.local', email_confirm: true })
    if (error && !/already/i.test(error.message)) throw error
    await admin.from('rooms').delete().eq('owner_id', OWNER)
    return createSupabaseStores(url!, key!)
  })
})
