import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

const HASH_BYTES = 32
const HEX = /^(?:[0-9a-f]{2})+$/i

export function hashPassword(pw: string): string {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(pw, salt, HASH_BYTES).toString('hex')}`
}

export function checkPassword(pw: string | undefined, stored: string | null): boolean {
  if (!stored) return true
  if (!pw) return false
  const [saltHex, hashHex] = stored.split(':')
  // A corrupt value must never verify: non-hex decodes to an empty buffer, and empty equals empty.
  if (!saltHex || !hashHex || !HEX.test(saltHex) || !HEX.test(hashHex)) return false
  const expected = Buffer.from(hashHex, 'hex')
  if (expected.length !== HASH_BYTES) return false
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), HASH_BYTES)
  return timingSafeEqual(actual, expected)
}
