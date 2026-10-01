import { z } from 'zod'

const schema = z.object({
  PORT: z.coerce.number().int().default(8080),
  CLIENT_ORIGIN: z.string().default('http://localhost:5173'),
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_SECRET: z.string().min(1).optional(),
  SUPABASE_JWKS_URL: z.string().url().optional(),
  GUEST_TOKEN_SECRET: z.string().min(24),
  IP_HASH_SECRET: z.string().min(24),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  MAX_ROOMS: z.coerce.number().int().positive().default(100),
  MAX_SOCKETS: z.coerce.number().int().positive().default(500),
  MAX_PER_IP: z.coerce.number().int().positive().default(10),
})

/** Loads a .env file into process.env if it exists (already-set variables win). Works on every Node 22. */
export function loadEnvFileIfExists(file: string): boolean {
  try {
    process.loadEnvFile(file)
    return true
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw e
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  // `KEY=` lines copied from .env.example mean "not set", not "set to an empty string".
  const e = schema.parse(Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '')))
  if (!e.SUPABASE_JWT_SECRET && !e.SUPABASE_JWKS_URL) {
    throw new Error('Set SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL so the server can verify JWTs')
  }
  const origins = e.CLIENT_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean)
  return {
    port: e.PORT,
    clientOrigin: origins.length === 1 ? origins[0]! : origins,
    supabaseUrl: e.SUPABASE_URL,
    supabaseServiceKey: e.SUPABASE_SERVICE_ROLE_KEY,
    supabaseJwtSecret: e.SUPABASE_JWT_SECRET,
    supabaseJwksUrl: e.SUPABASE_JWKS_URL,
    guestSecret: e.GUEST_TOKEN_SECRET,
    ipSecret: e.IP_HASH_SECRET,
    trustProxy: e.TRUST_PROXY === 'true',
    maxRooms: e.MAX_ROOMS,
    maxSockets: e.MAX_SOCKETS,
    maxPerIp: e.MAX_PER_IP,
  }
}
export type Config = ReturnType<typeof loadConfig>
