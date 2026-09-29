import { randomInt } from 'node:crypto'

const ADJ = ['quiet', 'brave', 'sunny', 'lucky', 'cosmic', 'gentle', 'swift', 'mellow', 'bright', 'cozy', 'daring', 'humble', 'jolly', 'noble', 'rapid', 'witty']
const NOUN = ['otter', 'fox', 'heron', 'panda', 'lynx', 'falcon', 'koala', 'badger', 'walrus', 'gecko', 'raven', 'bison', 'newt', 'ibis', 'moose', 'wren']
// Crockford-style base32, lowercase: no i, l, o or u, so a slug read aloud or retyped is unambiguous.
const SUFFIX = '0123456789abcdefghjkmnpqrstvwxyz'
const SUFFIX_LEN = 6 // 32^6 = 2^30 on top of the 8 bits from the words: not enumerable, not exhaustible
const pick = (a: string[] | string) => a[randomInt(a.length)]!

export function newSlug(): string {
  let suffix = ''
  for (let i = 0; i < SUFFIX_LEN; i++) suffix += pick(SUFFIX)
  return `${pick(ADJ)}-${pick(NOUN)}-${suffix}`
}
