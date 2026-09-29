import { randomInt } from 'node:crypto'

const ADJ = ['quiet', 'brave', 'sunny', 'lucky', 'cosmic', 'gentle', 'swift', 'mellow', 'bright', 'cozy', 'daring', 'humble', 'jolly', 'noble', 'rapid', 'witty']
const NOUN = ['otter', 'fox', 'heron', 'panda', 'lynx', 'falcon', 'koala', 'badger', 'walrus', 'gecko', 'raven', 'bison', 'newt', 'ibis', 'moose', 'wren']
const pick = (a: string[]) => a[randomInt(a.length)]!

export function newSlug(): string {
  return `${pick(ADJ)}-${pick(NOUN)}-${String(randomInt(100)).padStart(2, '0')}`
}
