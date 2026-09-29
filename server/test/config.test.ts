import { describe, it, expect } from 'vitest'
import { loadConfig } from '../src/config'

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
