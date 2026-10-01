// In-memory Unison server with a known signing secret, for local development and Playwright.
// It imports the real server code; only the secrets and stores are fake. NEVER deploy this file.
import { SignJWT } from 'jose'
import { createAuth } from '../server/src/auth'
import { createMemoryStores } from '../server/src/memoryStores'
import { buildServer } from '../server/src/server'

export const E2E_JWT_SECRET = 'e2e-jwt-secret-0123456789abcdef'
export const E2E_OWNER_ID = '00000000-0000-4000-8000-0000000000aa'

const auth = createAuth({ guestSecret: 'e2e-guest-secret-0123456789abcdef', supabaseJwtSecret: E2E_JWT_SECRET })
const { app } = await buildServer({
  auth,
  stores: createMemoryStores(),
  clientOrigin: ['http://localhost:5173', 'http://127.0.0.1:4173', 'http://localhost:4173'],
  ipSecret: 'e2e-ip-secret-0123456789abcdef',
  trustProxy: false,
  maxRooms: 100,
  maxSockets: 500,
  maxPerIp: 200,
})
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '127.0.0.1' })

const token = await new SignJWT({ user_metadata: { full_name: 'Dev Host' } })
  .setProtectedHeader({ alg: 'HS256' })
  .setSubject(E2E_OWNER_ID)
  .setAudience('authenticated')
  .setExpirationTime('12h')
  .sign(new TextEncoder().encode(E2E_JWT_SECRET))
console.log('Unison e2e harness listening on http://127.0.0.1:8080')
console.log('Dev host token (run the client with VITE_E2E=1, then in the browser console:')
console.log(`  localStorage.setItem('e2e-token', '${token}')`)
