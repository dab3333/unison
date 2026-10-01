import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { loadConfig, loadEnvFileIfExists } from '../src/config'

const base = {
  SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'k', SUPABASE_JWT_SECRET: 's'.repeat(32),
  GUEST_TOKEN_SECRET: 'g'.repeat(32), IP_HASH_SECRET: 'i'.repeat(32),
}
describe('loadConfig', () => {
  it('applies defaults', () => {
    expect(loadConfig(base)).toMatchObject({ port: 8080, trustProxy: false, maxRooms: 100, maxSockets: 500, maxPerIp: 10 })
  })
  it('parses TRUST_PROXY=false as false (not truthy string)', () => {
    expect(loadConfig({ ...base, TRUST_PROXY: 'false' }).trustProxy).toBe(false)
    expect(loadConfig({ ...base, TRUST_PROXY: 'true' }).trustProxy).toBe(true)
  })
  it('requires secrets and a JWT verification method', () => {
    expect(() => loadConfig({ ...base, GUEST_TOKEN_SECRET: 'short' })).toThrow()
    const { SUPABASE_JWT_SECRET: _omit, ...noJwt } = base
    expect(() => loadConfig(noJwt)).toThrow(/JWT/)
  })
  it('splits CLIENT_ORIGIN on commas', () => {
    expect(loadConfig({ ...base, CLIENT_ORIGIN: 'https://a.com, https://b.com' }).clientOrigin).toEqual(['https://a.com', 'https://b.com'])
  })
})

describe('empty env values (I9)', () => {
  it('treats empty strings from a copied .env.example as unset', () => {
    const cfg = loadConfig({ ...base, SUPABASE_JWKS_URL: '', PORT: '', TRUST_PROXY: '', MAX_ROOMS: '' })
    expect(cfg).toMatchObject({ supabaseJwksUrl: undefined, port: 8080, trustProxy: false, maxRooms: 100 })
    const { SUPABASE_JWT_SECRET: _omit, ...noJwt } = base
    expect(loadConfig({ ...noJwt, SUPABASE_JWT_SECRET: '', SUPABASE_JWKS_URL: 'https://x.supabase.co/auth/v1/.well-known/jwks.json' }))
      .toMatchObject({ supabaseJwtSecret: undefined })
    expect(() => loadConfig({ ...noJwt, SUPABASE_JWT_SECRET: '', SUPABASE_JWKS_URL: '' })).toThrow(/JWT/)
  })
})

describe('loadEnvFileIfExists (I9)', () => {
  it('loads a .env file without overriding variables that are already set, and ignores a missing file', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'unison-env-'))
    const file = path.join(dir, '.env')
    writeFileSync(file, ['UNISON_T_A=fromfile', 'UNISON_T_B=fromfile', ''].join('\n'))
    process.env.UNISON_T_A = 'preset'
    try {
      expect(loadEnvFileIfExists(file)).toBe(true)
      expect(process.env.UNISON_T_A).toBe('preset')
      expect(process.env.UNISON_T_B).toBe('fromfile')
      expect(loadEnvFileIfExists(path.join(dir, 'missing.env'))).toBe(false)
    } finally {
      delete process.env.UNISON_T_A; delete process.env.UNISON_T_B
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
