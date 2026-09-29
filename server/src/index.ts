import { createAuth } from './auth'
import { loadConfig } from './config'
import { buildServer } from './server'
import { createSupabaseStores } from './supabaseStores'

const cfg = loadConfig()
const { app } = await buildServer({
  auth: createAuth({
    guestSecret: cfg.guestSecret,
    supabaseJwtSecret: cfg.supabaseJwtSecret,
    supabaseJwksUrl: cfg.supabaseJwksUrl,
  }),
  stores: createSupabaseStores(cfg.supabaseUrl, cfg.supabaseServiceKey),
  clientOrigin: cfg.clientOrigin,
  ipSecret: cfg.ipSecret,
  trustProxy: cfg.trustProxy,
  maxRooms: cfg.maxRooms,
  maxSockets: cfg.maxSockets,
  maxPerIp: cfg.maxPerIp,
})

await app.listen({ port: cfg.port, host: '0.0.0.0' })
console.log(`unison server listening on :${cfg.port}`)

const shutdown = () => void app.close().then(() => process.exit(0))
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

const short = (e: unknown) => (e instanceof Error ? `${e.name}: ${e.message}` : 'non-error thrown')
process.on('unhandledRejection', (e) => console.error(`unhandled rejection (${short(e)})`))
process.on('uncaughtException', (e) => {
  console.error(`uncaught exception (${short(e)})`)
  process.exit(1)
})
