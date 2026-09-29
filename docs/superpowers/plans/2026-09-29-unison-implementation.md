# Unison Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Unison, a free, mobile-first web app where friends watch video together in a room with live chat, kept in sync by a server-authoritative WebSocket protocol.

**Architecture:** An npm-workspaces TypeScript monorepo: `shared` (protocol, zod schemas, pure sync math, input validation), `server` (Fastify REST + `ws` gateway, in-memory rooms, Supabase for auth and persistence), and `client` (React + Vite, `Player` adapters, `SyncClient`). Server logic is built from small pure units (`SyncEngine`, `ChatService`, `RateLimiter`, permissions) composed by `Room`, so nearly everything is unit-testable with a fake clock and fake connections.

**Tech Stack:** Node >= 20 (dev machine has 24), TypeScript 5, Vitest, Fastify 5, `ws` 8, `zod` 3, `jose` 5, `@supabase/supabase-js` 2, React 18, Vite 5, `react-router-dom` 6, `hls.js`, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-29-unison-design.md`. Visual reference: `docs/design/prototype/`.

## Global Constraints

Copied from the spec; every task's requirements include these.

- Sync: server-authoritative state `{source, isPlaying, position, rate:1, updatedAt, version}`; position derived as `isPlaying ? position + (serverNow - updatedAt)/1000 : position`.
- Heartbeat every 5s. Clock offset: 5 pings at join, keep the lowest-RTT sample, refresh every 60s.
- Drift: under 0.3s do nothing; 0.3 to 2s nudge `playbackRate` to 0.95 or 1.05; over 2s hard seek.
- Buffering: a buffering member pauses the room; resume when all ready or after 10s. Host can disable (`pauseOnBuffering`).
- Local-file mismatch: warn if a client's file duration differs from `source.duration` by more than 1s; offer a per-client offset slider.
- Control: host only by default; `controlMode: 'host' | 'everyone'`. Everyone in `everyone` mode: last write wins.
- Roles: Host, Moderator (kick, mute, remove chat messages), Member, Guest. Accounts required only to host; guests join with a nickname.
- Room settings: `controlMode`, `allowGuests`, `maxViewers` (default 15, hard cap 30), `chatEnabled`, `pauseOnBuffering`, optional `password`.
- Limits: chat 5 msgs/10s members and 3/10s guests; message max 500 chars with control chars stripped; control events 10/10s per client; rooms per host 3 active and 20 created per day; connections per IP 10; empty room destroyed after 10 min; global cap on total live rooms and sockets.
- Rate-limit escalation: repeated breaches lead to a 60s mute, then disconnect.
- Safety: chat and nicknames render as text only (never HTML). Source URLs must be `https`, private IP ranges rejected, and the server never fetches user URLs.
- Privacy: store only profiles, rooms, bans, reports. Do not log chat contents or raw IPs. Hash IPs with a rotating salt.
- Mobile-first: design for about 360px first; touch targets at least 44x44 px; no hover-only interactions; `100dvh` not `100vh`; respect safe-area insets; inputs at least 16px font; installable PWA; "Tap to join playback" overlay when autoplay is blocked.
- Visual: dark theme only; flat color only (no gradients, glows, glass); solid SVG icons, no emoji in the UI; Sora (headings, wordmark) and Inter (body); palette Night `#0F0B1E`, Surface `#1A1530`, Surface-2 `#241D42`, Line `#332A5C`, Violet `#7C6CFF` (single action color), Coral `#FF7A59`, Amber `#FFC857`, Green `#4ADE99`, Rose `#FF5C7A`, Text `#F4F1FF`, Muted `#A79FCB`.
- Out of scope: screen share, voice chat, permanent chat history, friend lists, playlists, reactions/emotes, native apps, multi-server scaling, streaming-service extension.

### Plan-level clarifications (the spec was silent or ambiguous; these are decisions)

1. The `Player` interface is a superset of the spec's: it adds `getDuration()`, `isPlaying()`, `destroy()`, and a `'blocked'` event (needed for the mismatch warning, reconcile logic, and the tap-to-play overlay).
2. A room password can only be set at creation (no password editing). It is stored as an scrypt hash, never in settings JSON.
3. "Active rooms" (limit 3) means room records that are not closed. A room's *in-memory* state is destroyed 10 minutes after it empties; the record and link persist until the host closes it. The dashboard copy says "Empty rooms reset after 10 minutes."
4. Bans and kicks target connected members. Banning offline users is out of scope.
5. Reports go through `POST /rooms/:slug/report` (REST), not the WebSocket.
6. Defaults: global caps `MAX_ROOMS=100`, `MAX_SOCKETS=500`.
7. WebSocket close codes: `4000` protocol/hello timeout, `4001` replaced by newer connection, `4002` unauthorized, `4003` kicked, `4004` banned, `4005` room closed, `4006` join refused (full, guests off, bad password, not found), `4008` rate limit. The client does not auto-reconnect on 4002 through 4008.

## Review Focus

Failure modes the spec implies but no requirement names; each has a test in the owning task.

1. Malformed input on the socket (invalid JSON, unknown `type`, oversized payload): the server answers `bad_request` or closes cleanly, never crashes, other clients unaffected. (Task 12)
2. The same person opening a second tab: the old connection is replaced (close code 4001) and is not double-counted toward `maxViewers`. (Task 9)
3. The host disconnecting mid-play: the room keeps its state, chat keeps working for viewers, and the host regains the host role on rejoin. (Task 9)
4. Seek or play with `-1`, `NaN`-like, `Infinity`, or a position past the video duration: rejected with `bad_request`, state unchanged. (Tasks 1 and 5)
5. Hostile URLs and names: `https://localhost`, `https://127.0.0.1`, `https://[::1]`, URLs with credentials, single-label hosts, bidi-override characters in nicknames, nicknames that are only whitespace or control characters. (Task 3)

---

## File Structure

```
package.json                     root workspaces + scripts
tsconfig.base.json
.gitignore
shared/
  package.json  tsconfig.json
  src/index.ts                   re-exports
  src/protocol.ts                types + zod schemas (client messages)
  src/sync.ts                    derivePosition, decideDrift, pickClockOffset
  src/validation.ts              sanitizeText, sanitizeNickname, validateSourceUrl, validateSource
  test/*.test.ts
server/
  package.json  tsconfig.json
  src/rateLimiter.ts             sliding-window limiter
  src/permissions.ts             role x action matrix
  src/syncEngine.ts              authoritative playback state
  src/chatService.ts             history + validation + rate limit
  src/privacy.ts                 hashIp
  src/password.ts                scrypt hash/check
  src/auth.ts                    guest tokens + Supabase JWT verification
  src/stores.ts                  store interfaces
  src/memoryStores.ts            in-memory implementations
  src/supabaseStores.ts          Postgres implementations
  src/room.ts                    Room: members, moderation, buffering, dispatch
  src/roomManager.ts             live rooms, caps, idle sweep
  src/slug.ts                    room slug generator
  src/app.ts                     Fastify REST API
  src/gateway.ts                 WebSocket gateway
  src/config.ts  src/index.ts    env config + entrypoint
  supabase/migrations/0001_init.sql
  test/*.test.ts  test/helpers.ts
client/
  package.json  tsconfig.json  vite.config.ts  index.html
  public/manifest.webmanifest, icons, _redirects
  src/main.tsx  src/App.tsx  src/styles.css
  src/lib/{config,api,supabase,auth,identity,sourceInput}.ts(x)
  src/net/roomSocket.ts
  src/sync/syncClient.ts
  src/player/{Player.ts,HtmlVideoAdapter.ts,YouTubeAdapter.ts,contract.ts}
  src/room/useRoom.ts
  src/pages/{Landing,SignIn,Dashboard,Join,Room,Terms}.tsx
  src/components/{Brand,PlayerStage,SourcePicker,Chat,Members,SettingsPanel}.tsx
  test/*.test.ts
e2e/                             Playwright + harness server
Dockerfile  fly.toml  README.md
```

---

### Task 1: Monorepo skeleton and shared protocol

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `shared/package.json`, `shared/tsconfig.json`, `shared/src/protocol.ts`, `shared/src/index.ts`
- Test: `shared/test/protocol.test.ts`

**Interfaces:**
- Produces (used by every later task): `Source`, `RoomState`, `Role`, `Member`, `RoomSettings`, `PublicSettings`, `ChatMessage`, `ErrorCode`, `ClientMessage`, `ServerMessage`, `clientMessageSchema`, `sourceSchema`, `settingsPatchSchema` exported from `@unison/shared`.

- [ ] **Step 1: Commit the existing spec, prototype, and plan**

```bash
cd /c/Users/mreyes2/unison
git add docs
git commit -m "docs: add Unison spec, design prototype, and implementation plan"
```

- [ ] **Step 2: Create the workspace files**

`package.json`:
```json
{
  "name": "unison",
  "private": true,
  "type": "module",
  "workspaces": ["shared", "server", "client", "e2e"],
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "npm test --workspaces --if-present",
    "typecheck": "npm run typecheck --workspaces --if-present"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "noEmit": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "lib": ["ES2022"]
  }
}
```

`.gitignore`:
```
node_modules
dist
.env
.env.local
*.log
test-results
playwright-report
```

`shared/package.json`:
```json
{
  "name": "@unison/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": { "test": "vitest run", "typecheck": "tsc -p ." },
  "dependencies": { "zod": "^3.23.8" },
  "devDependencies": { "typescript": "^5.6.0", "vitest": "^2.1.0" }
}
```

`shared/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "include": ["src", "test"] }
```

Create empty placeholder workspaces so `npm install` succeeds (they get real contents in later tasks):
```bash
mkdir -p server client e2e
printf '{ "name": "@unison/server", "private": true, "version": "0.0.0" }\n' > server/package.json
printf '{ "name": "@unison/client", "private": true, "version": "0.0.0" }\n' > client/package.json
printf '{ "name": "@unison/e2e", "private": true, "version": "0.0.0" }\n' > e2e/package.json
```

- [ ] **Step 3: Write the failing test** `shared/test/protocol.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { clientMessageSchema } from '../src'

const parse = (m: unknown) => clientMessageSchema.safeParse(m)

describe('clientMessageSchema', () => {
  it('accepts a valid control message', () => {
    expect(parse({ type: 'control', version: 3, action: 'seek', position: 12.5 }).success).toBe(true)
  })
  it('accepts hello, ping, chat, buffering, mod, settings', () => {
    expect(parse({ type: 'hello', token: 't' }).success).toBe(true)
    expect(parse({ type: 'ping', t0: 1 }).success).toBe(true)
    expect(parse({ type: 'chat', text: 'hi' }).success).toBe(true)
    expect(parse({ type: 'buffering', value: true }).success).toBe(true)
    expect(parse({ type: 'mod', op: 'kick', target: 'u1' }).success).toBe(true)
    expect(parse({ type: 'settings', patch: { maxViewers: 20 } }).success).toBe(true)
  })
  it('rejects unknown message types', () => {
    expect(parse({ type: 'eval', code: 'x' }).success).toBe(false)
  })
  it('rejects negative and non-finite positions', () => {
    expect(parse({ type: 'control', version: 0, action: 'seek', position: -1 }).success).toBe(false)
    expect(parse({ type: 'control', version: 0, action: 'seek', position: Infinity }).success).toBe(false)
  })
  it('rejects a settings patch that tries to change the password or unknown keys', () => {
    expect(parse({ type: 'settings', patch: { password: 'x' } }).success).toBe(false)
  })
  it('rejects maxViewers above the hard cap of 30', () => {
    expect(parse({ type: 'settings', patch: { maxViewers: 31 } }).success).toBe(false)
  })
  it('rejects an oversized token', () => {
    expect(parse({ type: 'hello', token: 'x'.repeat(5000) }).success).toBe(false)
  })
})
```

- [ ] **Step 4: Install and run the test to verify it fails**

Run: `npm install && npm test -w shared`
Expected: FAIL (cannot resolve `../src`).

- [ ] **Step 5: Implement** `shared/src/protocol.ts`

```ts
import { z } from 'zod'

export const sourceSchema = z
  .object({
    type: z.enum(['youtube', 'file', 'url', 'hls']),
    id: z.string().max(64).optional(),
    url: z.string().max(2048).optional(),
    name: z.string().max(200).optional(),
    size: z.number().finite().nonnegative().optional(),
    duration: z.number().finite().nonnegative().optional(),
  })
  .strict()
export type Source = z.infer<typeof sourceSchema>

export interface RoomState {
  source: Source | null
  isPlaying: boolean
  position: number
  rate: 1
  updatedAt: number
  version: number
}

export type Role = 'host' | 'moderator' | 'member' | 'guest'

export interface Member {
  id: string
  nickname: string
  role: Role
  muted: boolean
  buffering: boolean
}

export interface RoomSettings {
  controlMode: 'host' | 'everyone'
  allowGuests: boolean
  maxViewers: number
  chatEnabled: boolean
  pauseOnBuffering: boolean
}
export type PublicSettings = RoomSettings & { hasPassword: boolean }

export interface ChatMessage {
  id: string
  from: string
  nickname: string
  text: string
  at: number
}

export type ErrorCode =
  | 'forbidden'
  | 'rate_limited'
  | 'banned'
  | 'room_full'
  | 'bad_request'
  | 'not_found'
  | 'bad_password'
  | 'unauthorized'
  | 'stale'

export const settingsPatchSchema = z
  .object({
    controlMode: z.enum(['host', 'everyone']),
    allowGuests: z.boolean(),
    maxViewers: z.number().int().min(1).max(30),
    chatEnabled: z.boolean(),
    pauseOnBuffering: z.boolean(),
  })
  .partial()
  .strict()

export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello'), token: z.string().min(1).max(4096), password: z.string().max(128).optional() }),
  z.object({ type: z.literal('ping'), t0: z.number().finite() }),
  z.object({
    type: z.literal('control'),
    version: z.number().int().nonnegative(),
    action: z.enum(['play', 'pause', 'seek', 'setSource']),
    position: z.number().finite().min(0).optional(),
    source: sourceSchema.optional(),
  }),
  z.object({ type: z.literal('chat'), text: z.string().max(2000) }),
  z.object({ type: z.literal('buffering'), value: z.boolean() }),
  z.object({
    type: z.literal('mod'),
    op: z.enum(['kick', 'mute', 'unmute', 'ban', 'promote', 'demote', 'deleteMessage']),
    target: z.string().min(1).max(64),
  }),
  z.object({ type: z.literal('settings'), patch: settingsPatchSchema }),
])
export type ClientMessage = z.infer<typeof clientMessageSchema>

export type ServerMessage =
  | {
      type: 'welcome'
      you: string
      role: Role
      state: RoomState
      settings: PublicSettings
      members: Member[]
      chat: ChatMessage[]
      serverTime: number
    }
  | { type: 'pong'; t0: number; serverTime: number }
  | { type: 'state'; state: RoomState; holdingUp?: string[] }
  | { type: 'heartbeat'; state: RoomState; serverTime: number }
  | { type: 'chat'; message: ChatMessage }
  | { type: 'chatRemoved'; id: string }
  | { type: 'members'; members: Member[] }
  | { type: 'settings'; settings: PublicSettings }
  | { type: 'error'; code: ErrorCode; message: string }
```

`shared/src/index.ts`:
```ts
export * from './protocol'
export * from './sync'
export * from './validation'
```
(`sync` and `validation` are created in Tasks 2 and 3. Until then create both as `export {}` so the barrel compiles:)
```bash
printf 'export {}\n' > shared/src/sync.ts
printf 'export {}\n' > shared/src/validation.ts
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm test -w shared`
Expected: PASS (7 tests).

- [ ] **Step 7: Commit**

```bash
git add package.json tsconfig.base.json .gitignore shared server client e2e package-lock.json
git commit -m "feat: monorepo skeleton and shared protocol schemas"
```

---

### Task 2: Sync math (position, drift, clock offset)

**Files:**
- Modify: `shared/src/sync.ts`
- Test: `shared/test/sync.test.ts`

**Interfaces:**
- Produces: `derivePosition(state: Pick<RoomState,'isPlaying'|'position'|'updatedAt'>, serverNow: number): number`; `decideDrift(localPos: number, expectedPos: number): DriftAction`; `type DriftAction = {kind:'none'} | {kind:'rate'; rate: number} | {kind:'seek'; to: number}`; `pickClockOffset(samples: ClockSample[]): number`; `type ClockSample = {t0:number; t1:number; serverTime:number}`. Semantics: `serverNow = clientNow + offset`. `{kind:'none'}` means "playbackRate should be 1".

- [ ] **Step 1: Write the failing test** `shared/test/sync.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { derivePosition, decideDrift, pickClockOffset } from '../src'

describe('derivePosition', () => {
  it('returns the stored position when paused', () => {
    expect(derivePosition({ isPlaying: false, position: 10, updatedAt: 1000 }, 9000)).toBe(10)
  })
  it('advances with server time when playing', () => {
    expect(derivePosition({ isPlaying: true, position: 10, updatedAt: 1000 }, 3500)).toBeCloseTo(12.5)
  })
  it('never goes backwards if serverNow is before updatedAt', () => {
    expect(derivePosition({ isPlaying: true, position: 10, updatedAt: 5000 }, 4000)).toBe(10)
  })
})

describe('decideDrift', () => {
  it('does nothing under 0.3s', () => {
    expect(decideDrift(10.2, 10)).toEqual({ kind: 'none' })
    expect(decideDrift(9.8, 10)).toEqual({ kind: 'none' })
  })
  it('slows down when ahead by 0.3 to 2s', () => {
    expect(decideDrift(10.5, 10)).toEqual({ kind: 'rate', rate: 0.95 })
    expect(decideDrift(12, 10)).toEqual({ kind: 'rate', rate: 0.95 })
  })
  it('speeds up when behind by 0.3 to 2s', () => {
    expect(decideDrift(9.5, 10)).toEqual({ kind: 'rate', rate: 1.05 })
  })
  it('hard seeks over 2s', () => {
    expect(decideDrift(13, 10)).toEqual({ kind: 'seek', to: 10 })
    expect(decideDrift(5, 10)).toEqual({ kind: 'seek', to: 10 })
  })
})

describe('pickClockOffset', () => {
  it('uses the lowest round-trip sample', () => {
    const offset = pickClockOffset([
      { t0: 1000, t1: 1200, serverTime: 5100 },
      { t0: 2000, t1: 2040, serverTime: 6120 },
    ])
    expect(offset).toBe(4100) // 6120 - (2000 + 20)
  })
  it('returns 0 with no samples', () => {
    expect(pickClockOffset([])).toBe(0)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w shared -- sync`
Expected: FAIL (`derivePosition` is not exported).

- [ ] **Step 3: Implement** `shared/src/sync.ts`

```ts
import type { RoomState } from './protocol'

export function derivePosition(
  state: Pick<RoomState, 'isPlaying' | 'position' | 'updatedAt'>,
  serverNow: number,
): number {
  if (!state.isPlaying) return state.position
  return state.position + Math.max(0, serverNow - state.updatedAt) / 1000
}

export type DriftAction = { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek'; to: number }

export function decideDrift(localPos: number, expectedPos: number): DriftAction {
  const drift = localPos - expectedPos
  const abs = Math.abs(drift)
  if (abs < 0.3) return { kind: 'none' }
  if (abs > 2) return { kind: 'seek', to: expectedPos }
  return { kind: 'rate', rate: drift > 0 ? 0.95 : 1.05 }
}

export interface ClockSample {
  t0: number
  t1: number
  serverTime: number
}

/** Returns offset such that serverNow = clientNow + offset. */
export function pickClockOffset(samples: ClockSample[]): number {
  if (samples.length === 0) return 0
  const best = samples.reduce((a, b) => (b.t1 - b.t0 < a.t1 - a.t0 ? b : a))
  return best.serverTime - (best.t0 + (best.t1 - best.t0) / 2)
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): position derivation, drift decision, clock offset"
```

---

### Task 3: Input validation (text, nicknames, URLs, sources)

**Files:**
- Modify: `shared/src/validation.ts`
- Test: `shared/test/validation.test.ts`

**Interfaces:**
- Produces: `sanitizeText(input: unknown, max: number): string`; `sanitizeNickname(input: unknown): string | null` (max 24); `validateSourceUrl(raw: string): {ok:true; url:string} | {ok:false; reason:string}`; `validateSource(raw: unknown): Source | null`.

- [ ] **Step 1: Write the failing test** `shared/test/validation.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { sanitizeText, sanitizeNickname, validateSourceUrl, validateSource } from '../src'

describe('sanitizeText', () => {
  it('strips control characters and collapses whitespace', () => {
    expect(sanitizeText('  hi\u0000 there\n\nfriend\t ', 100)).toBe('hi there friend')
  })
  it('strips bidi override characters', () => {
    expect(sanitizeText('abc‮def', 100)).toBe('abc def')
  })
  it('truncates by code points, not UTF-16 units', () => {
    expect(sanitizeText('a😀b😀c', 3)).toBe('a😀b')
  })
  it('returns empty for non-strings', () => {
    expect(sanitizeText(42, 10)).toBe('')
    expect(sanitizeText(undefined, 10)).toBe('')
  })
})

describe('sanitizeNickname', () => {
  it('rejects whitespace-only and control-only names', () => {
    expect(sanitizeNickname('   ')).toBeNull()
    expect(sanitizeNickname('\u0000\u0007')).toBeNull()
  })
  it('caps at 24 characters', () => {
    expect(sanitizeNickname('x'.repeat(40))).toBe('x'.repeat(24))
  })
  it('keeps normal names', () => {
    expect(sanitizeNickname(' PopcornPat ')).toBe('PopcornPat')
  })
})

describe('validateSourceUrl', () => {
  const bad = [
    'http://example.com/a.mp4',
    'https://localhost/a.mp4',
    'https://foo.localhost/a.mp4',
    'https://127.0.0.1/a.mp4',
    'https://2130706433/a.mp4',
    'https://10.0.0.5/a.mp4',
    'https://172.16.0.1/a.mp4',
    'https://172.31.255.1/a.mp4',
    'https://192.168.1.1/a.mp4',
    'https://169.254.169.254/latest',
    'https://100.64.0.1/a.mp4',
    'https://0.0.0.0/a.mp4',
    'https://[::1]/a.mp4',
    'https://[fd00::1]/a.mp4',
    'https://[fe80::1]/a.mp4',
    'https://[::ffff:127.0.0.1]/a.mp4',
    'https://user:pass@example.com/a.mp4',
    'https://intranet/a.mp4',
    'https://printer.local/a.mp4',
    'https://db.internal/a.mp4',
    'javascript:alert(1)',
    'not a url',
  ]
  for (const url of bad) {
    it(`rejects ${url}`, () => expect(validateSourceUrl(url).ok).toBe(false))
  }
  it('accepts a public https URL', () => {
    expect(validateSourceUrl('https://cdn.example.com/movie.mp4?x=1')).toEqual({
      ok: true,
      url: 'https://cdn.example.com/movie.mp4?x=1',
    })
  })
  it('accepts 172.32.x (outside the private /12)', () => {
    expect(validateSourceUrl('https://172.32.0.1/a.mp4').ok).toBe(true)
  })
})

describe('validateSource', () => {
  it('accepts a valid YouTube id and drops extra fields', () => {
    expect(validateSource({ type: 'youtube', id: 'dQw4w9WgXcQ' })).toEqual({ type: 'youtube', id: 'dQw4w9WgXcQ' })
  })
  it('rejects a malformed YouTube id', () => {
    expect(validateSource({ type: 'youtube', id: 'short' })).toBeNull()
    expect(validateSource({ type: 'youtube', id: '"><script>alert(1)' })).toBeNull()
  })
  it('requires a safe url for url and hls', () => {
    expect(validateSource({ type: 'url', url: 'https://cdn.example.com/a.mp4' })).not.toBeNull()
    expect(validateSource({ type: 'hls', url: 'https://cdn.example.com/a.m3u8' })).not.toBeNull()
    expect(validateSource({ type: 'url', url: 'https://127.0.0.1/a.mp4' })).toBeNull()
    expect(validateSource({ type: 'url' })).toBeNull()
  })
  it('requires name, size and positive duration for files, and sanitizes the name', () => {
    expect(validateSource({ type: 'file', name: 'movie\u0000.mp4', size: 100, duration: 60 })).toEqual({
      type: 'file',
      name: 'movie .mp4',
      size: 100,
      duration: 60,
    })
    expect(validateSource({ type: 'file', name: 'a.mp4', size: 100 })).toBeNull()
    expect(validateSource({ type: 'file', name: 'a.mp4', size: 100, duration: 0 })).toBeNull()
  })
  it('rejects garbage', () => {
    expect(validateSource(null)).toBeNull()
    expect(validateSource({ type: 'nope' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w shared -- validation`
Expected: FAIL (functions not exported).

- [ ] **Step 3: Implement** `shared/src/validation.ts`

```ts
import { sourceSchema, type Source } from './protocol'

// C0/C1 controls, zero-width and bidi format characters, BOM.
const UNSAFE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g

export function sanitizeText(input: unknown, max: number): string {
  if (typeof input !== 'string') return ''
  const cleaned = input.replace(UNSAFE, ' ').replace(/\s+/g, ' ').trim()
  return Array.from(cleaned).slice(0, max).join('')
}

export function sanitizeNickname(input: unknown): string | null {
  return sanitizeText(input, 24) || null
}

function isPrivateIPv4(host: string): boolean {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host)
  if (!m) return false
  const [a, b] = [Number(m[1]), Number(m[2])]
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  )
}

function isPrivateIPv6(host: string): boolean {
  const h = host.toLowerCase()
  return h === '::' || h === '::1' || h.startsWith('::ffff:') || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80')
}

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string }

export function validateSourceUrl(raw: string): UrlCheck {
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false, reason: 'invalid url' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'https required' }
  if (u.username || u.password) return { ok: false, reason: 'credentials not allowed' }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host.includes(':')) {
    if (isPrivateIPv6(host)) return { ok: false, reason: 'private address' }
  } else {
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
      return { ok: false, reason: 'private host' }
    }
    if (isPrivateIPv4(host)) return { ok: false, reason: 'private address' }
    if (!host.includes('.')) return { ok: false, reason: 'single-label host' }
  }
  return { ok: true, url: u.toString() }
}

export function validateSource(raw: unknown): Source | null {
  const parsed = sourceSchema.safeParse(raw)
  if (!parsed.success) return null
  const s = parsed.data
  switch (s.type) {
    case 'youtube':
      return s.id && /^[A-Za-z0-9_-]{11}$/.test(s.id) ? { type: 'youtube', id: s.id } : null
    case 'url':
    case 'hls': {
      if (!s.url) return null
      const check = validateSourceUrl(s.url)
      return check.ok ? { type: s.type, url: check.url } : null
    }
    case 'file': {
      const name = sanitizeText(s.name, 200)
      if (!name || s.size === undefined || s.duration === undefined || s.duration <= 0) return null
      return { type: 'file', name, size: s.size, duration: s.duration }
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w shared`
Expected: PASS. If `https://2130706433/a.mp4` fails, Node's WHATWG URL should normalize it to `127.0.0.1`; verify with `node -e "console.log(new URL('https://2130706433/').hostname)"`.

- [ ] **Step 5: Commit**

```bash
git add shared
git commit -m "feat(shared): input validation for text, nicknames, URLs and sources"
```

---

### Task 4: Server package, RateLimiter, permissions

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/src/rateLimiter.ts`, `server/src/permissions.ts`
- Test: `server/test/rateLimiter.test.ts`, `server/test/permissions.test.ts`

**Interfaces:**
- Produces: `class RateLimiter { constructor(limit: number, windowMs: number, now?: () => number); allow(key: string): boolean; reset(key: string): void }`; `type Action = 'control'|'chat'|'kick'|'mute'|'ban'|'promote'|'settings'|'deleteMessage'`; `can(role: Role, action: Action, s: {controlMode: 'host'|'everyone'}): boolean`; `canTarget(actor: Role, target: Role): boolean`.

- [ ] **Step 1: Create the package**

`server/package.json`:
```json
{
  "name": "@unison/server",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@fastify/cors": "^10.0.0",
    "@supabase/supabase-js": "^2.45.0",
    "@unison/shared": "*",
    "fastify": "^5.0.0",
    "jose": "^5.9.0",
    "tsx": "^4.19.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/node": "^20.14.0",
    "@types/ws": "^8.5.12",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```
`server/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["src", "test"] }
```
Run: `npm install`

- [ ] **Step 2: Write the failing tests**

`server/test/rateLimiter.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { RateLimiter } from '../src/rateLimiter'

describe('RateLimiter', () => {
  it('allows up to the limit inside the window, then blocks', () => {
    let t = 0
    const rl = new RateLimiter(3, 10_000, () => t)
    expect([rl.allow('a'), rl.allow('a'), rl.allow('a'), rl.allow('a')]).toEqual([true, true, true, false])
  })
  it('allows again after the window slides', () => {
    let t = 0
    const rl = new RateLimiter(2, 10_000, () => t)
    rl.allow('a'); rl.allow('a')
    expect(rl.allow('a')).toBe(false)
    t = 10_001
    expect(rl.allow('a')).toBe(true)
  })
  it('tracks keys independently and supports reset', () => {
    const rl = new RateLimiter(1, 10_000, () => 0)
    expect(rl.allow('a')).toBe(true)
    expect(rl.allow('b')).toBe(true)
    expect(rl.allow('a')).toBe(false)
    rl.reset('a')
    expect(rl.allow('a')).toBe(true)
  })
})
```
`server/test/permissions.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { can, canTarget } from '../src/permissions'

const host = { controlMode: 'host' as const }
const everyone = { controlMode: 'everyone' as const }

describe('can', () => {
  it('lets only the host control playback in host mode', () => {
    expect(can('host', 'control', host)).toBe(true)
    expect(can('moderator', 'control', host)).toBe(false)
    expect(can('member', 'control', host)).toBe(false)
    expect(can('guest', 'control', host)).toBe(false)
  })
  it('lets everyone control in everyone mode', () => {
    for (const r of ['host', 'moderator', 'member', 'guest'] as const) expect(can(r, 'control', everyone)).toBe(true)
  })
  it('lets moderators kick, mute and delete messages but not ban, promote or change settings', () => {
    for (const a of ['kick', 'mute', 'deleteMessage'] as const) expect(can('moderator', a, host)).toBe(true)
    for (const a of ['ban', 'promote', 'settings'] as const) expect(can('moderator', a, host)).toBe(false)
  })
  it('denies members and guests every moderation action', () => {
    for (const a of ['kick', 'mute', 'ban', 'promote', 'settings', 'deleteMessage'] as const) {
      expect(can('member', a, host)).toBe(false)
      expect(can('guest', a, host)).toBe(false)
    }
  })
  it('lets everyone chat', () => {
    for (const r of ['host', 'moderator', 'member', 'guest'] as const) expect(can(r, 'chat', host)).toBe(true)
  })
})

describe('canTarget', () => {
  it('only allows acting on strictly lower roles', () => {
    expect(canTarget('host', 'moderator')).toBe(true)
    expect(canTarget('moderator', 'guest')).toBe(true)
    expect(canTarget('moderator', 'moderator')).toBe(false)
    expect(canTarget('moderator', 'host')).toBe(false)
    expect(canTarget('host', 'host')).toBe(false)
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -w server`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

`server/src/rateLimiter.ts`:
```ts
export class RateLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs)
    if (recent.length >= this.limit) {
      this.hits.set(key, recent)
      return false
    }
    recent.push(t)
    this.hits.set(key, recent)
    return true
  }

  reset(key: string): void {
    this.hits.delete(key)
  }
}
```
`server/src/permissions.ts`:
```ts
import type { Role } from '@unison/shared'

export type Action = 'control' | 'chat' | 'kick' | 'mute' | 'ban' | 'promote' | 'settings' | 'deleteMessage'

const RANK: Record<Role, number> = { guest: 0, member: 0, moderator: 1, host: 2 }

export function can(role: Role, action: Action, s: { controlMode: 'host' | 'everyone' }): boolean {
  switch (action) {
    case 'chat':
      return true
    case 'control':
      return role === 'host' || s.controlMode === 'everyone'
    case 'kick':
    case 'mute':
    case 'deleteMessage':
      return role === 'host' || role === 'moderator'
    case 'ban':
    case 'promote':
    case 'settings':
      return role === 'host'
  }
}

export function canTarget(actor: Role, target: Role): boolean {
  return RANK[actor] > RANK[target]
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add server package-lock.json
git commit -m "feat(server): rate limiter and role permissions"
```

---

### Task 5: SyncEngine

**Files:**
- Create: `server/src/syncEngine.ts`
- Test: `server/test/syncEngine.test.ts`

**Interfaces:**
- Consumes: `RoomState`, `Source`, `derivePosition` from `@unison/shared`.
- Produces: `class SyncEngine { constructor(now: () => number); get state(): RoomState; currentPosition(): number; apply(input: ControlInput, clientVersion: number, allowStale: boolean): ApplyResult; setPlaying(isPlaying: boolean): RoomState }`; `type ControlInput = {action:'play'|'pause'|'seek'|'setSource'; position?: number; source?: Source}`; `type ApplyResult = {ok:true; state: RoomState} | {ok:false; code:'stale'|'bad_request'}`.

- [ ] **Step 1: Write the failing test** `server/test/syncEngine.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { SyncEngine } from '../src/syncEngine'
import type { Source } from '@unison/shared'

const file: Source = { type: 'file', name: 'a.mp4', size: 1, duration: 100 }

function setup() {
  let t = 1_000
  const engine = new SyncEngine(() => t)
  return { engine, advance: (ms: number) => (t += ms) }
}
function withSource() {
  const s = setup()
  s.engine.apply({ action: 'setSource', source: file }, 0, false)
  return s
}

describe('SyncEngine', () => {
  it('starts empty and paused at version 0', () => {
    const { engine } = setup()
    expect(engine.state).toMatchObject({ source: null, isPlaying: false, position: 0, version: 0 })
  })

  it('setSource resets position and pauses, bumping version', () => {
    const { engine } = setup()
    const r = engine.apply({ action: 'setSource', source: file }, 0, false)
    expect(r.ok && r.state).toMatchObject({ source: file, isPlaying: false, position: 0, version: 1 })
  })

  it('play, seek and pause update state and version', () => {
    const { engine, advance } = withSource()
    engine.apply({ action: 'play', position: 5 }, 1, false)
    advance(2000)
    expect(engine.currentPosition()).toBeCloseTo(7)
    engine.apply({ action: 'seek', position: 50 }, 2, false)
    expect(engine.state).toMatchObject({ isPlaying: true, position: 50, version: 3 })
    engine.apply({ action: 'pause', position: 51 }, 3, false)
    expect(engine.state).toMatchObject({ isPlaying: false, position: 51, version: 4 })
  })

  it('rejects stale versions unless stale writes are allowed', () => {
    const { engine } = withSource()
    engine.apply({ action: 'play', position: 1 }, 1, false)
    expect(engine.apply({ action: 'pause', position: 2 }, 0, false)).toEqual({ ok: false, code: 'stale' })
    expect(engine.apply({ action: 'pause', position: 2 }, 0, true).ok).toBe(true)
  })

  it('rejects play/seek/pause with no source loaded', () => {
    const { engine } = setup()
    expect(engine.apply({ action: 'play', position: 0 }, 0, false)).toEqual({ ok: false, code: 'bad_request' })
  })

  it('rejects invalid positions and leaves state untouched (review focus 4)', () => {
    const { engine } = withSource()
    const before = engine.state
    for (const position of [-1, Infinity, NaN, undefined, 101.5]) {
      expect(engine.apply({ action: 'seek', position: position as number }, 1, false)).toEqual({
        ok: false,
        code: 'bad_request',
      })
    }
    expect(engine.state).toBe(before)
  })

  it('accepts a position up to 1s past the duration (end-of-video jitter)', () => {
    const { engine } = withSource()
    expect(engine.apply({ action: 'seek', position: 100.9 }, 1, false).ok).toBe(true)
  })

  it('rejects setSource without a source', () => {
    const { engine } = setup()
    expect(engine.apply({ action: 'setSource' }, 0, false)).toEqual({ ok: false, code: 'bad_request' })
  })

  it('setPlaying(false) captures the derived position; no-op when unchanged', () => {
    const { engine, advance } = withSource()
    engine.apply({ action: 'play', position: 10 }, 1, false)
    advance(3000)
    const paused = engine.setPlaying(false)
    expect(paused).toMatchObject({ isPlaying: false, version: 3 })
    expect(paused.position).toBeCloseTo(13)
    expect(engine.setPlaying(false).version).toBe(3)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- syncEngine`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `server/src/syncEngine.ts`

```ts
import { derivePosition, type RoomState, type Source } from '@unison/shared'

export type ControlInput = {
  action: 'play' | 'pause' | 'seek' | 'setSource'
  position?: number
  source?: Source
}
export type ApplyResult = { ok: true; state: RoomState } | { ok: false; code: 'stale' | 'bad_request' }

const BAD: ApplyResult = { ok: false, code: 'bad_request' }

export class SyncEngine {
  private s: RoomState

  constructor(private now: () => number) {
    this.s = { source: null, isPlaying: false, position: 0, rate: 1, updatedAt: now(), version: 0 }
  }

  get state(): RoomState {
    return this.s
  }

  currentPosition(): number {
    return derivePosition(this.s, this.now())
  }

  apply(input: ControlInput, clientVersion: number, allowStale: boolean): ApplyResult {
    if (!allowStale && clientVersion < this.s.version) return { ok: false, code: 'stale' }
    if (input.action === 'setSource') {
      if (!input.source) return BAD
      return this.commit({ source: input.source, isPlaying: false, position: 0 })
    }
    const p = input.position
    if (typeof p !== 'number' || !Number.isFinite(p) || p < 0) return BAD
    if (!this.s.source) return BAD
    const duration = this.s.source.duration
    if (duration !== undefined && p > duration + 1) return BAD
    if (input.action === 'play') return this.commit({ isPlaying: true, position: p })
    if (input.action === 'pause') return this.commit({ isPlaying: false, position: p })
    return this.commit({ position: p })
  }

  setPlaying(isPlaying: boolean): RoomState {
    if (this.s.isPlaying === isPlaying) return this.s
    return (this.commit({ isPlaying, position: this.currentPosition() }) as { ok: true; state: RoomState }).state
  }

  private commit(patch: Partial<RoomState>): ApplyResult {
    this.s = { ...this.s, ...patch, updatedAt: this.now(), version: this.s.version + 1 }
    return { ok: true, state: this.s }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server -- syncEngine`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): authoritative SyncEngine"
```

---

### Task 6: ChatService

**Files:**
- Create: `server/src/chatService.ts`
- Test: `server/test/chatService.test.ts`

**Interfaces:**
- Consumes: `RateLimiter` (Task 4), `sanitizeText`, `ChatMessage` (shared).
- Produces: `class ChatService { constructor(now: () => number, nextId: () => string, max?: number); post(from: {id: string; nickname: string; isGuest: boolean}, raw: unknown): {ok:true; message: ChatMessage} | {ok:false; code:'rate_limited'|'bad_request'}; remove(id: string): boolean; recent(): ChatMessage[]; forget(memberId: string): void }`.

- [ ] **Step 1: Write the failing test** `server/test/chatService.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { ChatService } from '../src/chatService'

function setup(max?: number) {
  let t = 0
  let n = 0
  const chat = new ChatService(() => t, () => `m${++n}`, max)
  return { chat, advance: (ms: number) => (t += ms) }
}
const member = { id: 'u1', nickname: 'Leo', isGuest: false }
const guest = { id: 'g1', nickname: 'Pat', isGuest: true }

describe('ChatService', () => {
  it('stores sanitized messages with sender and timestamp', () => {
    const { chat } = setup()
    const r = chat.post(member, '  hello\u0000 world  ')
    expect(r).toEqual({ ok: true, message: { id: 'm1', from: 'u1', nickname: 'Leo', text: 'hello world', at: 0 } })
    expect(chat.recent()).toHaveLength(1)
  })
  it('rejects empty, whitespace-only and non-string text', () => {
    const { chat } = setup()
    expect(chat.post(member, '   ')).toEqual({ ok: false, code: 'bad_request' })
    expect(chat.post(member, 5)).toEqual({ ok: false, code: 'bad_request' })
  })
  it('truncates to 500 characters', () => {
    const { chat } = setup()
    const r = chat.post(member, 'x'.repeat(900))
    expect(r.ok && r.message.text.length).toBe(500)
  })
  it('limits members to 5 messages per 10s and guests to 3', () => {
    const { chat } = setup()
    const m = Array.from({ length: 6 }, () => chat.post(member, 'hi').ok)
    const g = Array.from({ length: 4 }, () => chat.post(guest, 'hi').ok)
    expect(m).toEqual([true, true, true, true, true, false])
    expect(g).toEqual([true, true, true, false])
    expect(chat.post(member, 'again')).toEqual({ ok: false, code: 'rate_limited' })
  })
  it('recovers after the window', () => {
    const { chat, advance } = setup()
    for (let i = 0; i < 3; i++) chat.post(guest, 'hi')
    advance(10_001)
    expect(chat.post(guest, 'hi').ok).toBe(true)
  })
  it('keeps only the most recent messages', () => {
    const { chat, advance } = setup(3)
    for (let i = 0; i < 5; i++) { chat.post(member, `msg${i}`); advance(3000) }
    expect(chat.recent().map((m) => m.text)).toEqual(['msg2', 'msg3', 'msg4'])
  })
  it('removes a message by id', () => {
    const { chat } = setup()
    chat.post(member, 'bad')
    expect(chat.remove('m1')).toBe(true)
    expect(chat.remove('m1')).toBe(false)
    expect(chat.recent()).toEqual([])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- chatService`
Expected: FAIL.

- [ ] **Step 3: Implement** `server/src/chatService.ts`

```ts
import { sanitizeText, type ChatMessage } from '@unison/shared'
import { RateLimiter } from './rateLimiter'

export type PostResult = { ok: true; message: ChatMessage } | { ok: false; code: 'rate_limited' | 'bad_request' }

export class ChatService {
  private history: ChatMessage[] = []
  private memberLimiter: RateLimiter
  private guestLimiter: RateLimiter

  constructor(
    private now: () => number,
    private nextId: () => string,
    private max = 100,
  ) {
    this.memberLimiter = new RateLimiter(5, 10_000, now)
    this.guestLimiter = new RateLimiter(3, 10_000, now)
  }

  post(from: { id: string; nickname: string; isGuest: boolean }, raw: unknown): PostResult {
    const text = sanitizeText(raw, 500)
    if (!text) return { ok: false, code: 'bad_request' }
    const limiter = from.isGuest ? this.guestLimiter : this.memberLimiter
    if (!limiter.allow(from.id)) return { ok: false, code: 'rate_limited' }
    const message: ChatMessage = { id: this.nextId(), from: from.id, nickname: from.nickname, text, at: this.now() }
    this.history.push(message)
    if (this.history.length > this.max) this.history.shift()
    return { ok: true, message }
  }

  remove(id: string): boolean {
    const i = this.history.findIndex((m) => m.id === id)
    if (i < 0) return false
    this.history.splice(i, 1)
    return true
  }

  recent(): ChatMessage[] {
    return [...this.history]
  }

  forget(memberId: string): void {
    this.memberLimiter.reset(memberId)
    this.guestLimiter.reset(memberId)
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server -- chatService`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): ChatService with sanitizing, history and rate limits"
```

---

### Task 7: Privacy, passwords, and auth

**Files:**
- Create: `server/src/privacy.ts`, `server/src/password.ts`, `server/src/auth.ts`
- Test: `server/test/privacy.test.ts`, `server/test/password.test.ts`, `server/test/auth.test.ts`

**Interfaces:**
- Produces: `hashIp(ip: string, secret: string, nowMs: number): string`; `hashPassword(pw: string): string`; `checkPassword(pw: string | undefined, stored: string | null): boolean` (true when `stored` is null); `interface AuthIdentity {id: string; nickname: string; isGuest: boolean}`; `interface Auth { verify(token: string): Promise<AuthIdentity | null>; issueGuest(nickname: string, id: string): Promise<string> }`; `createAuth(cfg: {guestSecret: string; supabaseJwtSecret?: string; supabaseJwksUrl?: string}): Auth`.

- [ ] **Step 1: Write the failing tests**

`server/test/privacy.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashIp } from '../src/privacy'

const DAY = 86_400_000
describe('hashIp', () => {
  it('is stable within a day and never contains the raw IP', () => {
    const a = hashIp('203.0.113.9', 'salt', 5 * DAY + 1000)
    expect(hashIp('203.0.113.9', 'salt', 5 * DAY + 90_000)).toBe(a)
    expect(a).not.toContain('203')
    expect(a).toHaveLength(32)
  })
  it('rotates each day and differs by IP and secret', () => {
    const a = hashIp('203.0.113.9', 'salt', 5 * DAY)
    expect(hashIp('203.0.113.9', 'salt', 6 * DAY)).not.toBe(a)
    expect(hashIp('203.0.113.10', 'salt', 5 * DAY)).not.toBe(a)
    expect(hashIp('203.0.113.9', 'other', 5 * DAY)).not.toBe(a)
  })
})
```
`server/test/password.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { hashPassword, checkPassword } from '../src/password'

describe('password', () => {
  it('verifies the right password and rejects the wrong one', () => {
    const h = hashPassword('hunter2')
    expect(h).not.toContain('hunter2')
    expect(checkPassword('hunter2', h)).toBe(true)
    expect(checkPassword('nope', h)).toBe(false)
    expect(checkPassword(undefined, h)).toBe(false)
  })
  it('uses a fresh salt each time', () => {
    expect(hashPassword('x')).not.toBe(hashPassword('x'))
  })
  it('accepts anything when no password is set', () => {
    expect(checkPassword(undefined, null)).toBe(true)
    expect(checkPassword('whatever', null)).toBe(true)
  })
  it('rejects a corrupt stored value', () => {
    expect(checkPassword('x', 'garbage')).toBe(false)
  })
})
```
`server/test/auth.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SignJWT } from 'jose'
import { createAuth } from '../src/auth'

const enc = (s: string) => new TextEncoder().encode(s)
const auth = createAuth({ guestSecret: 'guest-secret-1234567890', supabaseJwtSecret: 'sb-secret-1234567890' })

async function supabaseToken(claims: Record<string, unknown>, opts: { exp?: string | number; secret?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-1')
    .setAudience('authenticated')
    .setExpirationTime(opts.exp ?? '1h')
    .sign(enc(opts.secret ?? 'sb-secret-1234567890'))
}

describe('guest tokens', () => {
  it('round-trips a guest identity', async () => {
    const token = await auth.issueGuest('PopcornPat', 'guest-1')
    expect(await auth.verify(token)).toEqual({ id: 'guest-1', nickname: 'PopcornPat', isGuest: true })
  })
  it('rejects a tampered token', async () => {
    const token = await auth.issueGuest('Pat', 'guest-1')
    expect(await auth.verify(token.slice(0, -3) + 'abc')).toBeNull()
  })
  it('rejects garbage', async () => {
    expect(await auth.verify('not-a-jwt')).toBeNull()
  })
})

describe('supabase tokens', () => {
  it('maps user_metadata name to a non-guest identity', async () => {
    const t = await supabaseToken({ user_metadata: { full_name: 'Maya Q' }, email: 'maya@x.com' })
    expect(await auth.verify(t)).toEqual({ id: 'user-1', nickname: 'Maya Q', isGuest: false })
  })
  it('falls back to the email prefix', async () => {
    const t = await supabaseToken({ email: 'leo@x.com' })
    expect((await auth.verify(t))?.nickname).toBe('leo')
  })
  it('rejects expired tokens, wrong secrets and wrong audience', async () => {
    expect(await auth.verify(await supabaseToken({}, { exp: Math.floor(Date.now() / 1000) - 10 }))).toBeNull()
    expect(await auth.verify(await supabaseToken({}, { secret: 'other-secret-1234567890' }))).toBeNull()
    const wrongAud = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject('u').setAudience('anon')
      .setExpirationTime('1h').sign(enc('sb-secret-1234567890'))
    expect(await auth.verify(wrongAud)).toBeNull()
  })
  it('does not accept a guest token as a Supabase token or the reverse', async () => {
    const onlySb = createAuth({ guestSecret: 'another-guest-secret-123', supabaseJwtSecret: 'sb-secret-1234567890' })
    const guestToken = await auth.issueGuest('Pat', 'g1')
    expect(await onlySb.verify(guestToken)).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w server`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`server/src/privacy.ts`:
```ts
import { createHash } from 'node:crypto'

const DAY_MS = 86_400_000

/** Salted, daily-rotating hash so raw IPs are never stored and hashes cannot be linked across days. */
export function hashIp(ip: string, secret: string, nowMs: number): string {
  const day = Math.floor(nowMs / DAY_MS)
  return createHash('sha256').update(`${secret}:${day}:${ip}`).digest('hex').slice(0, 32)
}
```
`server/src/password.ts`:
```ts
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

export function hashPassword(pw: string): string {
  const salt = randomBytes(16)
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 32).toString('hex')}`
}

export function checkPassword(pw: string | undefined, stored: string | null): boolean {
  if (!stored) return true
  if (!pw) return false
  const [saltHex, hashHex] = stored.split(':')
  if (!saltHex || !hashHex) return false
  const expected = Buffer.from(hashHex, 'hex')
  const actual = scryptSync(pw, Buffer.from(saltHex, 'hex'), expected.length)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}
```
`server/src/auth.ts`:
```ts
import { SignJWT, jwtVerify, createRemoteJWKSet } from 'jose'
import { sanitizeNickname } from '@unison/shared'

export interface AuthIdentity {
  id: string
  nickname: string
  isGuest: boolean
}
export interface Auth {
  verify(token: string): Promise<AuthIdentity | null>
  issueGuest(nickname: string, id: string): Promise<string>
}
export interface AuthConfig {
  guestSecret: string
  supabaseJwtSecret?: string
  supabaseJwksUrl?: string
}

export function createAuth(cfg: AuthConfig): Auth {
  const guestKey = new TextEncoder().encode(cfg.guestSecret)
  const jwks = cfg.supabaseJwksUrl ? createRemoteJWKSet(new URL(cfg.supabaseJwksUrl)) : null
  const sbSecret = cfg.supabaseJwtSecret ? new TextEncoder().encode(cfg.supabaseJwtSecret) : null

  async function verifyGuest(token: string): Promise<AuthIdentity | null> {
    try {
      const { payload } = await jwtVerify(token, guestKey, { algorithms: ['HS256'] })
      const nickname = sanitizeNickname(payload.nick)
      if (payload.kind !== 'guest' || typeof payload.sub !== 'string' || !nickname) return null
      return { id: payload.sub, nickname, isGuest: true }
    } catch {
      return null
    }
  }

  async function verifySupabase(token: string): Promise<AuthIdentity | null> {
    try {
      const { payload } = jwks
        ? await jwtVerify(token, jwks, { audience: 'authenticated' })
        : sbSecret
          ? await jwtVerify(token, sbSecret, { algorithms: ['HS256'], audience: 'authenticated' })
          : (null as never)
      if (typeof payload.sub !== 'string') return null
      const meta = (payload.user_metadata ?? {}) as Record<string, unknown>
      const email = typeof payload.email === 'string' ? payload.email : ''
      const nickname =
        sanitizeNickname(meta.full_name) ??
        sanitizeNickname(meta.name) ??
        sanitizeNickname(meta.user_name) ??
        sanitizeNickname(email.split('@')[0]) ??
        'Host'
      return { id: payload.sub, nickname, isGuest: false }
    } catch {
      return null
    }
  }

  return {
    async verify(token) {
      return (await verifyGuest(token)) ?? (await verifySupabase(token))
    },
    issueGuest(nickname, id) {
      return new SignJWT({ kind: 'guest', nick: nickname })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(id)
        .setIssuedAt()
        .setExpirationTime('30d')
        .sign(guestKey)
    },
  }
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm test -w server`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): IP hashing, password hashing, guest and Supabase auth"
```

---

### Task 8: Stores (interfaces, in-memory, Supabase) and SQL migration

**Files:**
- Create: `server/src/stores.ts`, `server/src/memoryStores.ts`, `server/src/supabaseStores.ts`, `server/supabase/migrations/0001_init.sql`
- Test: `server/test/storeContract.ts` (shared suite), `server/test/memoryStores.test.ts`, `server/test/supabaseStores.test.ts` (skipped without env)

**Interfaces:**
- Produces: `RoomRecord`, `RoomStore`, `BanStore`, `Report`, `ReportStore`, `Stores` (see code); `createMemoryStores(): Stores`; `createSupabaseStores(url: string, serviceKey: string): Stores`.

- [ ] **Step 1: Write the shared store contract suite** `server/test/storeContract.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import type { RoomRecord, Stores } from '../src/stores'

const settings = { controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true } as const

export function record(over: Partial<RoomRecord> = {}): RoomRecord {
  return {
    id: crypto.randomUUID(),
    slug: `slug-${Math.random().toString(36).slice(2, 10)}`,
    ownerId: OWNER,
    ownerName: 'Maya',
    name: 'Movie night',
    settings: { ...settings },
    passwordHash: null,
    createdAt: Date.now(),
    closedAt: null,
    ...over,
  }
}
export const OWNER = '00000000-0000-4000-8000-000000000001'

/** Run against every Stores implementation. `make` must return empty stores whose owner rows already exist. */
export function runStoreContract(name: string, make: () => Promise<Stores> | Stores) {
  describe(`${name} stores`, () => {
    let s: Stores
    beforeEach(async () => { s = await make() })

    it('creates and fetches a room by slug and id', async () => {
      const r = record({ passwordHash: 'a:b' })
      await s.rooms.create(r)
      expect(await s.rooms.getBySlug(r.slug)).toEqual(r)
      expect(await s.rooms.getById(r.id)).toEqual(r)
      expect(await s.rooms.getBySlug('nope')).toBeNull()
    })
    it('lists only open rooms for an owner and closes rooms', async () => {
      const a = record(); const b = record()
      await s.rooms.create(a); await s.rooms.create(b)
      await s.rooms.close(a.id, 5000)
      const open = await s.rooms.listOpenByOwner(OWNER)
      expect(open.map((r) => r.id)).toEqual([b.id])
      expect((await s.rooms.getById(a.id))?.closedAt).toBe(5000)
    })
    it('counts rooms created since a time', async () => {
      await s.rooms.create(record({ createdAt: 1000 }))
      await s.rooms.create(record({ createdAt: 9000 }))
      expect(await s.rooms.countCreatedSince(OWNER, 5000)).toBe(1)
    })
    it('saves settings', async () => {
      const r = record(); await s.rooms.create(r)
      await s.rooms.saveSettings(r.id, { ...r.settings, maxViewers: 7 })
      expect((await s.rooms.getById(r.id))?.settings.maxViewers).toBe(7)
    })
    it('stores bans idempotently', async () => {
      const r = record(); await s.rooms.create(r)
      await s.bans.add(r.id, 'guest:g1'); await s.bans.add(r.id, 'guest:g1'); await s.bans.add(r.id, 'ip:abc')
      expect((await s.bans.list(r.id)).sort()).toEqual(['guest:g1', 'ip:abc'])
    })
    it('stores reports', async () => {
      const r = record(); await s.rooms.create(r)
      await expect(s.reports.add({ roomId: r.id, reporterId: null, reason: 'spam', at: Date.now() })).resolves.toBeUndefined()
    })
  })
}
```
`server/test/memoryStores.test.ts`:
```ts
import { runStoreContract } from './storeContract'
import { createMemoryStores } from '../src/memoryStores'

runStoreContract('memory', () => createMemoryStores())
```
`server/test/supabaseStores.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- memoryStores`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the interfaces and in-memory stores**

`server/src/stores.ts`:
```ts
import type { RoomSettings } from '@unison/shared'

export interface RoomRecord {
  id: string
  slug: string
  ownerId: string
  ownerName: string
  name: string
  settings: RoomSettings
  passwordHash: string | null
  createdAt: number
  closedAt: number | null
}

export interface RoomStore {
  create(r: RoomRecord): Promise<void>
  getBySlug(slug: string): Promise<RoomRecord | null>
  getById(id: string): Promise<RoomRecord | null>
  listOpenByOwner(ownerId: string): Promise<RoomRecord[]>
  countCreatedSince(ownerId: string, sinceMs: number): Promise<number>
  close(id: string, at: number): Promise<void>
  saveSettings(id: string, settings: RoomSettings): Promise<void>
}
export interface BanStore {
  add(roomId: string, key: string): Promise<void>
  list(roomId: string): Promise<string[]>
}
export interface Report {
  roomId: string | null
  reporterId: string | null
  reason: string
  at: number
}
export interface ReportStore {
  add(r: Report): Promise<void>
}
export interface Stores {
  rooms: RoomStore
  bans: BanStore
  reports: ReportStore
}
```
`server/src/memoryStores.ts`:
```ts
import type { RoomRecord, Stores, Report } from './stores'

export function createMemoryStores(): Stores {
  const rooms = new Map<string, RoomRecord>()
  const bans = new Map<string, Set<string>>()
  const reports: Report[] = []
  const clone = (r: RoomRecord): RoomRecord => ({ ...r, settings: { ...r.settings } })
  return {
    rooms: {
      async create(r) { rooms.set(r.id, clone(r)) },
      async getBySlug(slug) {
        const r = [...rooms.values()].find((x) => x.slug === slug)
        return r ? clone(r) : null
      },
      async getById(id) { const r = rooms.get(id); return r ? clone(r) : null },
      async listOpenByOwner(ownerId) {
        return [...rooms.values()].filter((r) => r.ownerId === ownerId && r.closedAt === null).map(clone)
      },
      async countCreatedSince(ownerId, sinceMs) {
        return [...rooms.values()].filter((r) => r.ownerId === ownerId && r.createdAt >= sinceMs).length
      },
      async close(id, at) { const r = rooms.get(id); if (r) r.closedAt = at },
      async saveSettings(id, settings) { const r = rooms.get(id); if (r) r.settings = { ...settings } },
    },
    bans: {
      async add(roomId, key) {
        if (!bans.has(roomId)) bans.set(roomId, new Set())
        bans.get(roomId)!.add(key)
      },
      async list(roomId) { return [...(bans.get(roomId) ?? [])] },
    },
    reports: { async add(r) { reports.push(r) } },
  }
}
```

- [ ] **Step 4: Run to verify the memory contract passes**

Run: `npm test -w server -- memoryStores`
Expected: PASS (6 tests). The Supabase suite shows as skipped.

- [ ] **Step 5: Write the migration** `server/supabase/migrations/0001_init.sql`

```sql
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null,
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key,
  slug text not null unique,
  owner_id uuid not null references auth.users on delete cascade,
  owner_name text not null,
  name text not null,
  settings jsonb not null,
  password_hash text,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);
create index rooms_owner_idx on public.rooms (owner_id);

create table public.bans (
  room_id uuid not null references public.rooms on delete cascade,
  key text not null,
  created_at timestamptz not null default now(),
  primary key (room_id, key)
);

create table public.reports (
  id bigserial primary key,
  room_id uuid references public.rooms on delete set null,
  reporter_id uuid,
  reason text not null,
  created_at timestamptz not null default now()
);

-- Only the server (service role) touches these tables; no policies means no client access.
alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.bans enable row level security;
alter table public.reports enable row level security;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1), 'Host'),
    new.raw_user_meta_data->>'avatar_url'
  );
  return new;
end $$;

create trigger on_auth_user_created after insert on auth.users
for each row execute function public.handle_new_user();
```

- [ ] **Step 6: Implement** `server/src/supabaseStores.ts`

```ts
import { createClient } from '@supabase/supabase-js'
import type { RoomSettings } from '@unison/shared'
import type { RoomRecord, Stores } from './stores'

interface Row {
  id: string
  slug: string
  owner_id: string
  owner_name: string
  name: string
  settings: RoomSettings
  password_hash: string | null
  created_at: string
  closed_at: string | null
}

const toRecord = (r: Row): RoomRecord => ({
  id: r.id,
  slug: r.slug,
  ownerId: r.owner_id,
  ownerName: r.owner_name,
  name: r.name,
  settings: r.settings,
  passwordHash: r.password_hash,
  createdAt: new Date(r.created_at).getTime(),
  closedAt: r.closed_at ? new Date(r.closed_at).getTime() : null,
})
const iso = (ms: number) => new Date(ms).toISOString()

export function createSupabaseStores(url: string, serviceKey: string): Stores {
  const db = createClient(url, serviceKey, { auth: { persistSession: false } })
  const check = (error: { message: string } | null) => {
    if (error) throw new Error(error.message)
  }
  return {
    rooms: {
      async create(r) {
        const { error } = await db.from('rooms').insert({
          id: r.id, slug: r.slug, owner_id: r.ownerId, owner_name: r.ownerName, name: r.name,
          settings: r.settings, password_hash: r.passwordHash, created_at: iso(r.createdAt),
          closed_at: r.closedAt === null ? null : iso(r.closedAt),
        })
        check(error)
      },
      async getBySlug(slug) {
        const { data, error } = await db.from('rooms').select('*').eq('slug', slug).maybeSingle()
        check(error)
        return data ? toRecord(data as Row) : null
      },
      async getById(id) {
        const { data, error } = await db.from('rooms').select('*').eq('id', id).maybeSingle()
        check(error)
        return data ? toRecord(data as Row) : null
      },
      async listOpenByOwner(ownerId) {
        const { data, error } = await db.from('rooms').select('*').eq('owner_id', ownerId).is('closed_at', null)
          .order('created_at', { ascending: false })
        check(error)
        return (data as Row[]).map(toRecord)
      },
      async countCreatedSince(ownerId, sinceMs) {
        const { count, error } = await db.from('rooms').select('id', { count: 'exact', head: true })
          .eq('owner_id', ownerId).gte('created_at', iso(sinceMs))
        check(error)
        return count ?? 0
      },
      async close(id, at) {
        check((await db.from('rooms').update({ closed_at: iso(at) }).eq('id', id)).error)
      },
      async saveSettings(id, settings) {
        check((await db.from('rooms').update({ settings }).eq('id', id)).error)
      },
    },
    bans: {
      async add(roomId, key) {
        check((await db.from('bans').upsert({ room_id: roomId, key }, { onConflict: 'room_id,key', ignoreDuplicates: true })).error)
      },
      async list(roomId) {
        const { data, error } = await db.from('bans').select('key').eq('room_id', roomId)
        check(error)
        return (data as { key: string }[]).map((b) => b.key)
      },
    },
    reports: {
      async add(r) {
        check((await db.from('reports').insert({ room_id: r.roomId, reporter_id: r.reporterId, reason: r.reason,
          created_at: iso(r.at) })).error)
      },
    },
  }
}
```

- [ ] **Step 7: Verify types and (optionally) the real database**

Run: `npm run typecheck -w server`
Expected: no errors.

Optional, needs a throwaway Supabase project: paste the migration into the Supabase SQL editor and run it, then `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test -w server -- supabaseStores`. Expected: 6 tests pass. Skip if no project exists yet; Task 21 lists this as a launch check.

- [ ] **Step 8: Commit**

```bash
git add server
git commit -m "feat(server): store interfaces, in-memory and Supabase stores, SQL migration"
```

---

### Task 9: Room (members, moderation, buffering, dispatch)

**Files:**
- Create: `server/src/room.ts`, `server/test/helpers.ts`
- Test: `server/test/room.test.ts`

**Interfaces:**
- Consumes: `SyncEngine` (T5), `ChatService` (T6), `RateLimiter`/`can`/`canTarget` (T4), `validateSource` (T3), shared types.
- Produces:
  - `interface Conn { id: string; ipHash: string; send(m: ServerMessage): void; close(code: number, reason: string): void }`
  - `interface Identity { id: string; nickname: string; isGuest: boolean }`
  - `interface RoomDeps { now: () => number; nextId: () => string; hasPassword: boolean; verifyPassword(pw: string | undefined): boolean; persist: { ban(key: string): void; saveSettings(s: RoomSettings): void } }`
  - `class Room { constructor(id: string, slug: string, hostId: string, settings: RoomSettings, bans: Iterable<string>, deps: RoomDeps); emptySince: number | null; get size(): number; publicSettings(): PublicSettings; members(): Member[]; roleOf(id: string): Role; join(conn: Conn, identity: Identity, password?: string): {ok:true} | {ok:false; code: ErrorCode}; leave(connId: string): void; handle(connId: string, msg: ClientMessage): void; tick(): void; destroy(): void }`

- [ ] **Step 1: Write the test helpers** `server/test/helpers.ts`

```ts
import type { RoomSettings, ServerMessage } from '@unison/shared'
import { Room, type Conn, type Identity } from '../src/room'

export class FakeConn implements Conn {
  sent: ServerMessage[] = []
  closed: { code: number; reason: string } | null = null
  constructor(public id: string, public ipHash = `ip-${id}`) {}
  send(m: ServerMessage) { this.sent.push(m) }
  close(code: number, reason: string) { this.closed = { code, reason } }
  all<T extends ServerMessage['type']>(type: T) {
    return this.sent.filter((m) => m.type === type) as Extract<ServerMessage, { type: T }>[]
  }
  last<T extends ServerMessage['type']>(type: T) {
    return this.all(type).at(-1)
  }
}

export const defaultSettings: RoomSettings = {
  controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true,
}

export const host = (): Identity => ({ id: 'host-1', nickname: 'Maya', isGuest: false })
export const user = (id = 'u2', nickname = 'Leo'): Identity => ({ id, nickname, isGuest: false })
export const guest = (id = 'g1', nickname = 'Pat'): Identity => ({ id, nickname, isGuest: true })

export function makeRoom(over: { settings?: Partial<RoomSettings>; bans?: string[]; password?: string } = {}) {
  let t = 1_000_000
  let n = 0
  const persisted = { bans: [] as string[], settings: [] as RoomSettings[] }
  const room = new Room('room-1', 'quiet-otter-42', 'host-1', { ...defaultSettings, ...over.settings }, over.bans ?? [], {
    now: () => t,
    nextId: () => `id-${++n}`,
    hasPassword: !!over.password,
    verifyPassword: (pw) => !over.password || pw === over.password,
    persist: { ban: (k) => persisted.bans.push(k), saveSettings: (s) => persisted.settings.push(s) },
  })
  return { room, persisted, advance: (ms: number) => (t += ms), now: () => t }
}

/** Join an identity with a fresh FakeConn and return it. */
export function joinAs(room: Room, identity: Identity, connId = `c-${identity.id}`, password?: string) {
  const conn = new FakeConn(connId)
  const result = room.join(conn, identity, password)
  return { conn, result }
}

export const source = { type: 'file', name: 'a.mp4', size: 1, duration: 600 } as const
```

- [ ] **Step 2: Write the failing tests** `server/test/room.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { makeRoom, joinAs, host, user, guest, source, FakeConn } from './helpers'
import type { Room } from '../src/room'

const ctl = (room: Room, connId: string, msg: { action: 'play' | 'pause' | 'seek' | 'setSource'; position?: number; source?: unknown }) =>
  room.handle(connId, { type: 'control', version: room.engine.state.version, ...msg } as never)

function loaded(over: Parameters<typeof makeRoom>[0] = {}) {
  const ctx = makeRoom(over)
  const h = joinAs(ctx.room, host())
  const g = joinAs(ctx.room, guest())
  ctl(ctx.room, h.conn.id, { action: 'setSource', source })
  return { ...ctx, h, g }
}

describe('join and welcome', () => {
  it('sends welcome with state, members and settings, and announces members', () => {
    const { room } = makeRoom()
    const h = joinAs(room, host())
    const g = joinAs(room, guest())
    expect(h.result).toEqual({ ok: true })
    const w = g.conn.last('welcome')!
    expect(w.you).toBe('g1')
    expect(w.role).toBe('guest')
    expect(w.members.map((m) => m.nickname).sort()).toEqual(['Maya', 'Pat'])
    expect(w.settings).toMatchObject({ controlMode: 'host', hasPassword: false })
    expect(h.conn.last('members')!.members).toHaveLength(2)
    expect(room.size).toBe(2)
  })

  it('refuses guests when guests are off', () => {
    const { room } = makeRoom({ settings: { allowGuests: false } })
    expect(joinAs(room, guest()).result).toEqual({ ok: false, code: 'forbidden' })
    expect(joinAs(room, user()).result).toEqual({ ok: true })
  })

  it('enforces maxViewers but never blocks the host', () => {
    const { room } = makeRoom({ settings: { maxViewers: 2 } })
    expect(joinAs(room, user('u2')).result.ok).toBe(true)
    expect(joinAs(room, user('u3')).result.ok).toBe(true)
    expect(joinAs(room, guest()).result).toEqual({ ok: false, code: 'room_full' })
    expect(joinAs(room, host()).result.ok).toBe(true)
  })

  it('checks the password for everyone except the host', () => {
    const { room } = makeRoom({ password: 'pw' })
    expect(joinAs(room, guest('g1'), 'c1').result).toEqual({ ok: false, code: 'bad_password' })
    expect(joinAs(room, guest('g2'), 'c2', 'pw').result.ok).toBe(true)
    expect(joinAs(room, host()).result.ok).toBe(true)
  })

  it('replaces a second connection from the same identity instead of double counting (review focus 2)', () => {
    const { room } = makeRoom({ settings: { maxViewers: 2 } })
    const a = joinAs(room, user('u2'), 'c-a')
    const b = joinAs(room, user('u2'), 'c-b')
    expect(b.result).toEqual({ ok: true })
    expect(a.conn.closed?.code).toBe(4001)
    expect(room.size).toBe(1)
    room.leave('c-a') // the old socket's late close must not evict the new one
    expect(room.members().map((m) => m.id)).toEqual(['u2'])
    expect(joinAs(room, user('u3')).result.ok).toBe(true)
  })

  it('answers ping with pong and rejects a second hello', () => {
    const { room, now } = makeRoom()
    const h = joinAs(room, host())
    room.handle(h.conn.id, { type: 'ping', t0: 7 })
    expect(h.conn.last('pong')).toEqual({ type: 'pong', t0: 7, serverTime: now() })
    room.handle(h.conn.id, { type: 'hello', token: 'x' })
    expect(h.conn.last('error')?.code).toBe('bad_request')
  })
})

describe('playback control', () => {
  it('lets only the host control playback in host mode', () => {
    const { room, h, g } = loaded()
    expect(g.conn.last('state')!.state.source).toEqual(source)
    ctl(room, g.conn.id, { action: 'play', position: 0 })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    expect(room.engine.state.isPlaying).toBe(false)
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    expect(room.engine.state.isPlaying).toBe(true)
    expect(g.conn.last('state')!.state.isPlaying).toBe(true)
  })

  it('lets guests control in everyone mode, last write wins even with a stale version', () => {
    const { room, g } = loaded({ settings: { controlMode: 'everyone' } })
    room.handle(g.conn.id, { type: 'control', version: 0, action: 'play', position: 3 })
    expect(room.engine.state).toMatchObject({ isPlaying: true, position: 3 })
  })

  it('rejects stale versions from the host in host mode', () => {
    const { room, h } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(h.conn.id, { type: 'control', version: 0, action: 'pause', position: 1 })
    expect(h.conn.last('error')?.code).toBe('stale')
  })

  it('rejects invalid sources and positions with bad_request', () => {
    const { room, h } = loaded()
    ctl(room, h.conn.id, { action: 'setSource', source: { type: 'url', url: 'http://example.com/a.mp4' } })
    expect(h.conn.last('error')?.code).toBe('bad_request')
    ctl(room, h.conn.id, { action: 'seek', position: -1 })
    expect(h.conn.all('error').at(-1)?.code).toBe('bad_request')
    expect(room.engine.state.source).toEqual(source)
  })

  it('rate limits control events at 10 per 10s', () => {
    const { room, h } = loaded() // setSource was event 1
    for (let i = 0; i < 9; i++) ctl(room, h.conn.id, { action: 'seek', position: i })
    expect(h.conn.all('error')).toHaveLength(0)
    ctl(room, h.conn.id, { action: 'seek', position: 50 })
    expect(h.conn.last('error')?.code).toBe('rate_limited')
  })

  it('keeps state and chat working when the host disconnects, and restores the host role on rejoin (review focus 3)', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.leave(h.conn.id)
    expect(room.size).toBe(1)
    room.handle(g.conn.id, { type: 'chat', text: 'still here' })
    expect(g.conn.last('chat')?.message.text).toBe('still here')
    advance(5000)
    room.tick()
    expect(g.conn.last('heartbeat')?.state.isPlaying).toBe(true)
    const back = joinAs(room, host(), 'c-back')
    expect(back.conn.last('welcome')).toMatchObject({ role: 'host', state: { isPlaying: true } })
  })
})

describe('buffering', () => {
  it('auto-pauses when a member buffers and resumes when everyone is ready', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    advance(2000)
    room.handle(g.conn.id, { type: 'buffering', value: true })
    const paused = h.conn.last('state')!
    expect(paused.state.isPlaying).toBe(false)
    expect(paused.state.position).toBeCloseTo(2)
    expect(paused.holdingUp).toEqual(['g1'])
    room.handle(g.conn.id, { type: 'buffering', value: false })
    expect(h.conn.last('state')!.state.isPlaying).toBe(true)
  })

  it('resumes after 10s even if a member is still buffering', () => {
    const { room, advance, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    advance(9_999); room.tick()
    expect(room.engine.state.isPlaying).toBe(false)
    advance(1); room.tick()
    expect(room.engine.state.isPlaying).toBe(true)
  })

  it('resumes if the buffering member leaves', () => {
    const { room, h, g } = loaded()
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    room.leave(g.conn.id)
    expect(room.engine.state.isPlaying).toBe(true)
  })

  it('does nothing when pauseOnBuffering is off', () => {
    const { room, h, g } = loaded({ settings: { pauseOnBuffering: false } })
    ctl(room, h.conn.id, { action: 'play', position: 0 })
    room.handle(g.conn.id, { type: 'buffering', value: true })
    expect(room.engine.state.isPlaying).toBe(true)
  })
})

describe('chat', () => {
  it('broadcasts sanitized chat to everyone', () => {
    const { room, h, g } = loaded()
    room.handle(g.conn.id, { type: 'chat', text: '  hi\u0000 all ' })
    expect(h.conn.last('chat')?.message).toMatchObject({ nickname: 'Pat', text: 'hi all' })
  })

  it('blocks chat for non-hosts when chat is disabled', () => {
    const { room, h, g } = loaded({ settings: { chatEnabled: false } })
    room.handle(g.conn.id, { type: 'chat', text: 'hi' })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'chat', text: 'announcement' })
    expect(g.conn.last('chat')?.message.text).toBe('announcement')
  })

  it('escalates repeated rate-limit breaches: auto-mute, then disconnect', () => {
    const { room, g, h } = loaded()
    for (let i = 0; i < 8; i++) room.handle(g.conn.id, { type: 'chat', text: `m${i}` })
    expect(h.conn.last('members')!.members.find((m) => m.id === 'g1')?.muted).toBe(true)
    expect(g.conn.closed).toBeNull()
    for (let i = 0; i < 5; i++) room.handle(g.conn.id, { type: 'chat', text: 'spam' })
    expect(g.conn.closed?.code).toBe(4008)
    expect(room.size).toBe(1)
  })
})

describe('moderation', () => {
  it('lets a promoted moderator kick a guest but not the host, and not ban', () => {
    const { room, h } = loaded()
    const mod = joinAs(room, user('u2', 'Leo'))
    const victim = joinAs(room, guest('g2', 'Sam'))
    room.handle(h.conn.id, { type: 'mod', op: 'promote', target: 'u2' })
    expect(mod.conn.last('members')!.members.find((m) => m.id === 'u2')?.role).toBe('moderator')
    room.handle(mod.conn.id, { type: 'mod', op: 'ban', target: 'g2' })
    expect(mod.conn.last('error')?.code).toBe('forbidden')
    room.handle(mod.conn.id, { type: 'mod', op: 'kick', target: 'host-1' })
    expect(mod.conn.last('error')?.code).toBe('forbidden')
    room.handle(mod.conn.id, { type: 'mod', op: 'kick', target: 'g2' })
    expect(victim.conn.closed?.code).toBe(4003)
    expect(room.members().map((m) => m.id)).not.toContain('g2')
  })

  it('bans persist, disconnect, and block rejoin by id and by IP for guests', () => {
    const { room, persisted, h, g } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'ban', target: 'g1' })
    expect(persisted.bans.sort()).toEqual(['guest:g1', 'ip:ip-c-g1'])
    expect(g.conn.closed?.code).toBe(4004)
    expect(joinAs(room, guest('g1'), 'c-new').result).toEqual({ ok: false, code: 'banned' })
    const sameIp = new FakeConn('other', 'ip-c-g1')
    expect(room.join(sameIp, guest('g9'))).toEqual({ ok: false, code: 'banned' })
  })

  it('bans a signed-in user by user id only, not by IP', () => {
    const { room, persisted, h } = loaded()
    joinAs(room, user('u2'))
    room.handle(h.conn.id, { type: 'mod', op: 'ban', target: 'u2' })
    expect(persisted.bans).toEqual(['user:u2'])
    expect(joinAs(room, guest('g5'), 'c-u2').result.ok).toBe(true)
  })

  it('applies bans loaded at construction', () => {
    const { room } = makeRoom({ bans: ['user:u2'] })
    expect(joinAs(room, user('u2')).result).toEqual({ ok: false, code: 'banned' })
  })

  it('mute blocks chat and unmute restores it', () => {
    const { room, h, g } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'mute', target: 'g1' })
    room.handle(g.conn.id, { type: 'chat', text: 'hello' })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'mod', op: 'unmute', target: 'g1' })
    room.handle(g.conn.id, { type: 'chat', text: 'hello' })
    expect(h.conn.last('chat')?.message.text).toBe('hello')
  })

  it('lets moderators delete a chat message and tells everyone', () => {
    const { room, h, g } = loaded()
    room.handle(g.conn.id, { type: 'chat', text: 'rude' })
    const id = h.conn.last('chat')!.message.id
    room.handle(g.conn.id, { type: 'mod', op: 'deleteMessage', target: id })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'mod', op: 'deleteMessage', target: id })
    expect(g.conn.last('chatRemoved')?.id).toBe(id)
  })

  it('does not allow promoting guests', () => {
    const { room, h } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'promote', target: 'g1' })
    expect(h.conn.last('error')?.code).toBe('forbidden')
  })

  it('returns not_found for a target who is not in the room', () => {
    const { room, h } = loaded()
    room.handle(h.conn.id, { type: 'mod', op: 'kick', target: 'ghost' })
    expect(h.conn.last('error')?.code).toBe('not_found')
  })
})

describe('settings, heartbeat, lifecycle', () => {
  it('lets only the host change settings, persists them, and clamps maxViewers to 30', () => {
    const { room, persisted, h, g } = loaded()
    room.handle(g.conn.id, { type: 'settings', patch: { chatEnabled: false } })
    expect(g.conn.last('error')?.code).toBe('forbidden')
    room.handle(h.conn.id, { type: 'settings', patch: { maxViewers: 99, controlMode: 'everyone' } })
    expect(g.conn.last('settings')?.settings).toMatchObject({ maxViewers: 30, controlMode: 'everyone' })
    expect(persisted.settings.at(-1)).toMatchObject({ maxViewers: 30, controlMode: 'everyone' })
  })

  it('broadcasts a heartbeat every 5s and not before', () => {
    const { room, advance, g } = loaded()
    advance(4_999); room.tick()
    expect(g.conn.all('heartbeat')).toHaveLength(0)
    advance(1); room.tick()
    expect(g.conn.all('heartbeat')).toHaveLength(1)
  })

  it('tracks emptiness and closes everyone on destroy', () => {
    const { room, advance, now, h, g } = loaded()
    expect(room.emptySince).toBeNull()
    room.leave(h.conn.id); room.leave(g.conn.id)
    expect(room.emptySince).toBe(now())
    advance(1)
    const late = joinAs(room, host(), 'late')
    expect(room.emptySince).toBeNull()
    room.destroy()
    expect(late.conn.closed?.code).toBe(4005)
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `npm test -w server -- room`
Expected: FAIL (`../src/room` not found).

- [ ] **Step 4: Implement** `server/src/room.ts`

```ts
import {
  validateSource,
  type ClientMessage,
  type ErrorCode,
  type Member,
  type PublicSettings,
  type Role,
  type RoomSettings,
  type ServerMessage,
} from '@unison/shared'
import { ChatService } from './chatService'
import { can, canTarget, type Action } from './permissions'
import { RateLimiter } from './rateLimiter'
import { SyncEngine } from './syncEngine'

export interface Conn {
  id: string
  ipHash: string
  send(m: ServerMessage): void
  close(code: number, reason: string): void
}
export interface Identity {
  id: string
  nickname: string
  isGuest: boolean
}
export interface RoomDeps {
  now: () => number
  nextId: () => string
  hasPassword: boolean
  verifyPassword(pw: string | undefined): boolean
  persist: { ban(key: string): void; saveSettings(s: RoomSettings): void }
}

interface Entry {
  conn: Conn
  identity: Identity
  buffering: boolean
  muted: boolean
  mutedUntil: number
  strikes: number[]
}

type ModMsg = Extract<ClientMessage, { type: 'mod' }>
const MOD_ACTION: Record<ModMsg['op'], Action> = {
  kick: 'kick', mute: 'mute', unmute: 'mute', ban: 'ban', promote: 'promote', demote: 'promote', deleteMessage: 'deleteMessage',
}

const HEARTBEAT_MS = 5_000
const BUFFER_TIMEOUT_MS = 10_000
const STRIKE_WINDOW_MS = 60_000
const AUTO_MUTE_MS = 60_000

export function banKeys(identity: Identity, ipHash: string): string[] {
  return identity.isGuest ? [`guest:${identity.id}`, `ip:${ipHash}`] : [`user:${identity.id}`]
}

export class Room {
  readonly engine: SyncEngine
  readonly chat: ChatService
  emptySince: number | null
  private entries = new Map<string, Entry>()
  private mods = new Set<string>()
  private bans: Set<string>
  private settings: RoomSettings
  private controlLimiter: RateLimiter
  private autoPausedAt: number | null = null
  private lastHeartbeat: number

  constructor(
    readonly id: string,
    readonly slug: string,
    readonly hostId: string,
    settings: RoomSettings,
    bans: Iterable<string>,
    private deps: RoomDeps,
  ) {
    this.settings = { ...settings }
    this.bans = new Set(bans)
    this.engine = new SyncEngine(deps.now)
    this.chat = new ChatService(deps.now, deps.nextId)
    this.controlLimiter = new RateLimiter(10, 10_000, deps.now)
    this.emptySince = deps.now()
    this.lastHeartbeat = deps.now()
  }

  get size(): number {
    return this.entries.size
  }

  publicSettings(): PublicSettings {
    return { ...this.settings, hasPassword: this.deps.hasPassword }
  }

  roleOf(id: string): Role {
    if (id === this.hostId) return 'host'
    if (this.mods.has(id)) return 'moderator'
    return this.entries.get(id)?.identity.isGuest ? 'guest' : 'member'
  }

  members(): Member[] {
    const t = this.deps.now()
    return [...this.entries.values()].map((e) => ({
      id: e.identity.id,
      nickname: e.identity.nickname,
      role: this.roleOf(e.identity.id),
      muted: e.muted || e.mutedUntil > t,
      buffering: e.buffering,
    }))
  }

  join(conn: Conn, identity: Identity, password?: string): { ok: true } | { ok: false; code: ErrorCode } {
    const isHost = identity.id === this.hostId
    if (banKeys(identity, conn.ipHash).some((k) => this.bans.has(k))) return { ok: false, code: 'banned' }
    if (identity.isGuest && !this.settings.allowGuests) return { ok: false, code: 'forbidden' }
    if (!isHost && this.deps.hasPassword && !this.deps.verifyPassword(password)) return { ok: false, code: 'bad_password' }
    const existing = this.entries.get(identity.id)
    if (!existing && !isHost && this.entries.size >= this.settings.maxViewers) return { ok: false, code: 'room_full' }
    if (existing) existing.conn.close(4001, 'replaced by a newer connection')
    this.entries.set(identity.id, { conn, identity, buffering: false, muted: false, mutedUntil: 0, strikes: [] })
    this.emptySince = null
    conn.send({
      type: 'welcome',
      you: identity.id,
      role: this.roleOf(identity.id),
      state: this.engine.state,
      settings: this.publicSettings(),
      members: this.members(),
      chat: this.chat.recent(),
      serverTime: this.deps.now(),
    })
    this.broadcastMembers()
    return { ok: true }
  }

  leave(connId: string): void {
    const entry = [...this.entries.values()].find((e) => e.conn.id === connId)
    if (!entry) return // stale close from a replaced connection
    const id = entry.identity.id
    this.entries.delete(id)
    this.chat.forget(id)
    this.controlLimiter.reset(id)
    if (this.entries.size === 0) this.emptySince = this.deps.now()
    this.reevaluateBuffering()
  }

  handle(connId: string, msg: ClientMessage): void {
    const entry = [...this.entries.values()].find((e) => e.conn.id === connId)
    if (!entry) return
    switch (msg.type) {
      case 'hello':
        return this.err(entry, 'bad_request', 'already joined')
      case 'ping':
        return entry.conn.send({ type: 'pong', t0: msg.t0, serverTime: this.deps.now() })
      case 'control':
        return this.onControl(entry, msg)
      case 'chat':
        return this.onChat(entry, msg.text)
      case 'buffering':
        entry.buffering = msg.value
        return this.reevaluateBuffering()
      case 'mod':
        return this.onMod(entry, msg)
      case 'settings':
        return this.onSettings(entry, msg.patch)
    }
  }

  /** Call about once a second: buffering timeout and heartbeat. */
  tick(): void {
    const t = this.deps.now()
    if (this.autoPausedAt !== null && t - this.autoPausedAt >= BUFFER_TIMEOUT_MS) {
      this.autoPausedAt = null
      for (const e of this.entries.values()) e.buffering = false
      this.engine.setPlaying(true)
      this.broadcastState()
      this.broadcastMembers()
    }
    if (t - this.lastHeartbeat >= HEARTBEAT_MS) {
      this.lastHeartbeat = t
      this.broadcast({ type: 'heartbeat', state: this.engine.state, serverTime: t })
    }
  }

  destroy(): void {
    for (const e of this.entries.values()) e.conn.close(4005, 'room closed')
    this.entries.clear()
  }

  private onControl(entry: Entry, msg: Extract<ClientMessage, { type: 'control' }>): void {
    const id = entry.identity.id
    if (!can(this.roleOf(id), 'control', this.settings)) return this.err(entry, 'forbidden')
    if (!this.controlLimiter.allow(id)) return this.strike(entry)
    let src
    if (msg.action === 'setSource') {
      src = validateSource(msg.source) ?? undefined
      if (!src) return this.err(entry, 'bad_request', 'invalid source')
    }
    const res = this.engine.apply(
      { action: msg.action, position: msg.position, source: src },
      msg.version,
      this.settings.controlMode === 'everyone',
    )
    if (!res.ok) return this.err(entry, res.code)
    this.autoPausedAt = null
    this.broadcastState()
  }

  private onChat(entry: Entry, text: string): void {
    const id = entry.identity.id
    if (this.roleOf(id) !== 'host' && !this.settings.chatEnabled) return this.err(entry, 'forbidden')
    if (entry.muted) return this.err(entry, 'forbidden')
    if (entry.mutedUntil > this.deps.now()) return this.strike(entry)
    const res = this.chat.post(entry.identity, text)
    if (!res.ok) return res.code === 'rate_limited' ? this.strike(entry) : this.err(entry, res.code)
    this.broadcast({ type: 'chat', message: res.message })
  }

  private onMod(actor: Entry, msg: ModMsg): void {
    const actorRole = this.roleOf(actor.identity.id)
    if (!can(actorRole, MOD_ACTION[msg.op], this.settings)) return this.err(actor, 'forbidden')
    if (msg.op === 'deleteMessage') {
      if (this.chat.remove(msg.target)) this.broadcast({ type: 'chatRemoved', id: msg.target })
      return
    }
    const target = this.entries.get(msg.target)
    if (!target) return this.err(actor, 'not_found')
    if (!canTarget(actorRole, this.roleOf(msg.target))) return this.err(actor, 'forbidden')
    switch (msg.op) {
      case 'kick':
        return this.evict(target, 4003, 'kicked')
      case 'ban':
        for (const key of banKeys(target.identity, target.conn.ipHash)) {
          this.bans.add(key)
          this.deps.persist.ban(key)
        }
        return this.evict(target, 4004, 'banned')
      case 'mute':
        target.muted = true
        break
      case 'unmute':
        target.muted = false
        target.mutedUntil = 0
        break
      case 'promote':
        if (target.identity.isGuest) return this.err(actor, 'forbidden', 'guests cannot be moderators')
        this.mods.add(msg.target)
        break
      case 'demote':
        this.mods.delete(msg.target)
        break
    }
    this.broadcastMembers()
  }

  private onSettings(entry: Entry, patch: Partial<RoomSettings>): void {
    if (!can(this.roleOf(entry.identity.id), 'settings', this.settings)) return this.err(entry, 'forbidden')
    const defined = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined))
    const next = { ...this.settings, ...defined } as RoomSettings
    next.maxViewers = Math.min(30, Math.max(1, Math.floor(next.maxViewers)))
    this.settings = next
    this.deps.persist.saveSettings({ ...next })
    this.broadcast({ type: 'settings', settings: this.publicSettings() })
  }

  private evict(entry: Entry, code: number, reason: string): void {
    entry.conn.close(code, reason)
    this.leave(entry.conn.id)
  }

  private reevaluateBuffering(): void {
    if (this.settings.pauseOnBuffering) {
      const holding = [...this.entries.values()].filter((e) => e.buffering).map((e) => e.identity.id)
      if (holding.length > 0 && this.engine.state.isPlaying) {
        this.engine.setPlaying(false)
        this.autoPausedAt = this.deps.now()
        this.broadcastState(holding)
      } else if (holding.length === 0 && this.autoPausedAt !== null) {
        this.autoPausedAt = null
        this.engine.setPlaying(true)
        this.broadcastState()
      }
    }
    this.broadcastMembers()
  }

  private strike(entry: Entry): void {
    const t = this.deps.now()
    entry.strikes = entry.strikes.filter((s) => t - s < STRIKE_WINDOW_MS)
    entry.strikes.push(t)
    this.err(entry, 'rate_limited')
    if (entry.strikes.length >= 10) {
      this.evict(entry, 4008, 'rate limit exceeded')
    } else if (entry.strikes.length === 5) {
      entry.mutedUntil = t + AUTO_MUTE_MS
      this.broadcastMembers()
    }
  }

  private err(entry: Entry, code: ErrorCode, message = code): void {
    entry.conn.send({ type: 'error', code, message })
  }

  private broadcast(m: ServerMessage): void {
    for (const e of this.entries.values()) e.conn.send(m)
  }
  private broadcastState(holdingUp?: string[]): void {
    this.broadcast({ type: 'state', state: this.engine.state, ...(holdingUp ? { holdingUp } : {}) })
  }
  private broadcastMembers(): void {
    this.broadcast({ type: 'members', members: this.members() })
  }
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npm test -w server -- room`
Expected: PASS. If the escalation test fails, recount: guests get 3 chats/10s, so messages 4 to 8 are strikes 1 to 5 (auto-mute on the 5th), and messages 9 to 13 are strikes 6 to 10 (disconnect on the 10th).

- [ ] **Step 6: Commit**

```bash
git add server
git commit -m "feat(server): Room with roles, moderation, buffering pause, strikes"
```

---

### Task 10: RoomManager

**Files:**
- Create: `server/src/roomManager.ts`
- Test: `server/test/roomManager.test.ts`

**Interfaces:**
- Consumes: `Room`, `RoomDeps` (T9), `Stores` (T8), `checkPassword` (T7).
- Produces: `class RoomManager { constructor(d: {stores: Stores; now: () => number; nextId: () => string; maxRooms: number; idleMs: number}); get(slug: string): Promise<GetResult>; peek(slug: string): Room | undefined; closeRoom(roomId: string): void; tickAll(): void; stats(): {rooms: number; sockets: number} }`; `type GetResult = {ok:true; room: Room} | {ok:false; code:'not_found'|'busy'}`.

- [ ] **Step 1: Write the failing test** `server/test/roomManager.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { RoomManager } from '../src/roomManager'
import { createMemoryStores } from '../src/memoryStores'
import { record, OWNER } from './storeContract'
import { FakeConn } from './helpers'

function setup(over: { maxRooms?: number; idleMs?: number } = {}) {
  let t = 1_000_000
  const stores = createMemoryStores()
  const manager = new RoomManager({
    stores, now: () => t, nextId: () => crypto.randomUUID(), maxRooms: over.maxRooms ?? 100, idleMs: over.idleMs ?? 600_000,
  })
  return { stores, manager, advance: (ms: number) => (t += ms) }
}

describe('RoomManager', () => {
  it('creates one live Room per slug even for concurrent first joins', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec)
    const [a, b] = await Promise.all([manager.get(rec.slug), manager.get(rec.slug)])
    expect(a.ok && b.ok && a.room === b.room).toBe(true)
    expect(manager.peek(rec.slug)).toBeDefined()
  })

  it('returns not_found for unknown and closed rooms', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec); await stores.rooms.close(rec.id, 1)
    expect(await manager.get('nope')).toEqual({ ok: false, code: 'not_found' })
    expect(await manager.get(rec.slug)).toEqual({ ok: false, code: 'not_found' })
  })

  it('returns busy at the global room cap but still serves existing rooms', async () => {
    const { stores, manager } = setup({ maxRooms: 1 })
    const a = record(); const b = record()
    await stores.rooms.create(a); await stores.rooms.create(b)
    expect((await manager.get(a.slug)).ok).toBe(true)
    expect(await manager.get(b.slug)).toEqual({ ok: false, code: 'busy' })
    expect((await manager.get(a.slug)).ok).toBe(true)
  })

  it('applies persisted bans and the owner as host', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec); await stores.bans.add(rec.id, 'user:u2')
    const got = await manager.get(rec.slug)
    if (!got.ok) throw new Error('expected room')
    expect(got.room.hostId).toBe(OWNER)
    expect(got.room.join(new FakeConn('c1'), { id: 'u2', nickname: 'Leo', isGuest: false })).toEqual({ ok: false, code: 'banned' })
  })

  it('destroys rooms after they sit empty past idleMs, and recreates them fresh', async () => {
    const { stores, manager, advance } = setup({ idleMs: 600_000 })
    const rec = record(); await stores.rooms.create(rec)
    const first = await manager.get(rec.slug)
    if (!first.ok) throw new Error('expected room')
    const occupied = new FakeConn('c1')
    first.room.join(occupied, { id: 'u2', nickname: 'Leo', isGuest: false })
    advance(700_000); manager.tickAll()
    expect(manager.peek(rec.slug)).toBe(first.room) // occupied rooms are kept
    first.room.leave('c1')
    advance(599_999); manager.tickAll()
    expect(manager.peek(rec.slug)).toBeDefined()
    advance(1); manager.tickAll()
    expect(manager.peek(rec.slug)).toBeUndefined()
    const second = await manager.get(rec.slug)
    expect(second.ok && second.room !== first.room).toBe(true)
  })

  it('reports stats and closes a room by id', async () => {
    const { stores, manager } = setup()
    const rec = record(); await stores.rooms.create(rec)
    const got = await manager.get(rec.slug)
    if (!got.ok) throw new Error('expected room')
    const c = new FakeConn('c1')
    got.room.join(c, { id: 'u2', nickname: 'Leo', isGuest: false })
    expect(manager.stats()).toEqual({ rooms: 1, sockets: 1 })
    manager.closeRoom(rec.id)
    expect(c.closed?.code).toBe(4005)
    expect(manager.stats()).toEqual({ rooms: 0, sockets: 0 })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- roomManager`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `server/src/roomManager.ts`

```ts
import { checkPassword } from './password'
import { Room } from './room'
import type { Stores } from './stores'

export interface ManagerDeps {
  stores: Stores
  now: () => number
  nextId: () => string
  maxRooms: number
  idleMs: number
}
export type GetResult = { ok: true; room: Room } | { ok: false; code: 'not_found' | 'busy' }

export class RoomManager {
  private live = new Map<string, Room>()
  private pending = new Map<string, Promise<GetResult>>()

  constructor(private d: ManagerDeps) {}

  get(slug: string): Promise<GetResult> {
    const existing = this.live.get(slug)
    if (existing) return Promise.resolve({ ok: true, room: existing })
    let p = this.pending.get(slug)
    if (!p) {
      p = this.create(slug).finally(() => this.pending.delete(slug))
      this.pending.set(slug, p)
    }
    return p
  }

  peek(slug: string): Room | undefined {
    return this.live.get(slug)
  }

  closeRoom(roomId: string): void {
    for (const [slug, room] of this.live) {
      if (room.id === roomId) {
        room.destroy()
        this.live.delete(slug)
      }
    }
  }

  tickAll(): void {
    const t = this.d.now()
    for (const [slug, room] of this.live) {
      room.tick()
      if (room.emptySince !== null && t - room.emptySince >= this.d.idleMs) {
        room.destroy()
        this.live.delete(slug)
      }
    }
  }

  stats(): { rooms: number; sockets: number } {
    let sockets = 0
    for (const room of this.live.values()) sockets += room.size
    return { rooms: this.live.size, sockets }
  }

  private async create(slug: string): Promise<GetResult> {
    const rec = await this.d.stores.rooms.getBySlug(slug)
    if (!rec || rec.closedAt !== null) return { ok: false, code: 'not_found' }
    if (this.live.size >= this.d.maxRooms) return { ok: false, code: 'busy' }
    const bans = await this.d.stores.bans.list(rec.id)
    const room = new Room(rec.id, rec.slug, rec.ownerId, rec.settings, bans, {
      now: this.d.now,
      nextId: this.d.nextId,
      hasPassword: rec.passwordHash !== null,
      verifyPassword: (pw) => checkPassword(pw, rec.passwordHash),
      persist: {
        ban: (key) => void this.d.stores.bans.add(rec.id, key).catch(() => {}),
        saveSettings: (s) => void this.d.stores.rooms.saveSettings(rec.id, s).catch(() => {}),
      },
    })
    this.live.set(slug, room)
    return { ok: true, room }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server -- roomManager`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): RoomManager with caps, idle sweep and ban loading"
```

---

### Task 11: HTTP API

**Files:**
- Create: `server/src/slug.ts`, `server/src/app.ts`
- Test: `server/test/app.test.ts`

**Interfaces:**
- Consumes: `Auth` (T7), `Stores` (T8), `RoomManager` (T10), `RateLimiter` (T4), `hashPassword`, `hashIp`.
- Produces: `createApp(d: AppDeps): Promise<FastifyInstance>`; `interface AppDeps { auth: Auth; stores: Stores; manager: RoomManager; ipSecret: string; clientOrigin: string | string[]; now: () => number; nextId: () => string; trustProxy?: boolean; makeSlug?: () => string }`; `DEFAULT_SETTINGS: RoomSettings`; `newSlug(): string`.
- REST contract (client Task 13 relies on this):
  - `GET /health` returns `{ok:true}`; `GET /stats` returns `{rooms, sockets}`
  - `POST /guest` body `{nickname}` returns `{token, id, nickname}`
  - `GET /rooms/:slug` returns `{slug, name, ownerName, live: number, settings: PublicSettings}` or 404 `{error:'not_found'}`
  - `POST /rooms` (Bearer, non-guest) body `{name, password?, settings?}` returns 201 `{id, slug}`; errors `too_many_rooms`, `daily_limit` (429), `bad_request` (400), `unauthorized` (401)
  - `GET /rooms` (Bearer) returns `[{id, slug, name, live, settings, createdAt}]`
  - `DELETE /rooms/:id` (Bearer, owner) returns 204
  - `POST /rooms/:slug/report` body `{reason}` (optional Bearer) returns 202
  - All errors are `{error: string}`.

- [ ] **Step 1: Write the failing test** `server/test/app.test.ts`

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { SignJWT } from 'jose'
import type { FastifyInstance } from 'fastify'
import { createApp } from '../src/app'
import { createAuth } from '../src/auth'
import { createMemoryStores } from '../src/memoryStores'
import { RoomManager } from '../src/roomManager'
import type { Stores } from '../src/stores'
import { record, OWNER } from './storeContract'

const SB = 'sb-secret-1234567890'
const auth = createAuth({ guestSecret: 'guest-secret-1234567890', supabaseJwtSecret: SB })
const signUser = (id: string, name = 'Maya') =>
  new SignJWT({ user_metadata: { full_name: name } }).setProtectedHeader({ alg: 'HS256' }).setSubject(id)
    .setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(SB))

let app: FastifyInstance
let stores: Stores
let manager: RoomManager
let n = 0

beforeEach(async () => {
  stores = createMemoryStores()
  n = 0
  manager = new RoomManager({ stores, now: Date.now, nextId: () => `id-${++n}`, maxRooms: 100, idleMs: 600_000 })
  app = await createApp({
    auth, stores, manager, ipSecret: 'ip-secret-1234567890123456', clientOrigin: 'http://localhost:5173',
    now: Date.now, nextId: () => `id-${++n}`,
  })
})

const bearer = async (id = OWNER) => ({ authorization: `Bearer ${await signUser(id)}` })
const create = async (body: unknown = { name: 'Movie night' }, id = OWNER) =>
  app.inject({ method: 'POST', url: '/rooms', headers: await bearer(id), payload: body as object })

describe('health and stats', () => {
  it('reports health and live stats', async () => {
    expect((await app.inject('/health')).json()).toEqual({ ok: true })
    expect((await app.inject('/stats')).json()).toEqual({ rooms: 0, sockets: 0 })
  })
})

describe('POST /guest', () => {
  it('issues a verifiable guest token with a sanitized nickname', async () => {
    const res = await app.inject({ method: 'POST', url: '/guest', payload: { nickname: '  Pat\u0000  ' } })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.nickname).toBe('Pat')
    expect(await auth.verify(body.token)).toEqual({ id: body.id, nickname: 'Pat', isGuest: true })
  })
  it('rejects empty nicknames', async () => {
    const res = await app.inject({ method: 'POST', url: '/guest', payload: { nickname: '   ' } })
    expect(res.statusCode).toBe(400)
  })
  it('rate limits per IP at 20 per minute', async () => {
    let last = 0
    for (let i = 0; i < 21; i++) {
      last = (await app.inject({ method: 'POST', url: '/guest', payload: { nickname: 'x' }, remoteAddress: '198.51.100.7' })).statusCode
    }
    expect(last).toBe(429)
  })
})

describe('POST /rooms', () => {
  it('requires a signed-in (non-guest) user', async () => {
    expect((await app.inject({ method: 'POST', url: '/rooms', payload: { name: 'x' } })).statusCode).toBe(401)
    const g = await (await app.inject({ method: 'POST', url: '/guest', payload: { nickname: 'Pat' } })).json()
    const res = await app.inject({ method: 'POST', url: '/rooms', headers: { authorization: `Bearer ${g.token}` }, payload: { name: 'x' } })
    expect(res.statusCode).toBe(401)
  })
  it('creates a room with defaults and hashes the password', async () => {
    const res = await create({ name: 'Movie night', password: 'secret' })
    expect(res.statusCode).toBe(201)
    const { id, slug } = res.json()
    const rec = await stores.rooms.getById(id)
    expect(rec).toMatchObject({ slug, ownerId: OWNER, ownerName: 'Maya', name: 'Movie night' })
    expect(rec?.settings).toMatchObject({ controlMode: 'host', allowGuests: true, maxViewers: 15 })
    expect(rec?.passwordHash).not.toBeNull()
    expect(rec?.passwordHash).not.toContain('secret')
  })
  it('validates the body', async () => {
    expect((await create({ name: '' })).statusCode).toBe(400)
    expect((await create({ name: 'x', settings: { maxViewers: 31 } })).statusCode).toBe(400)
    expect((await create({ name: 'x', password: '' })).statusCode).toBe(400)
  })
  it('limits open rooms per host to 3 and frees a slot when one is closed', async () => {
    const ids: string[] = []
    for (let i = 0; i < 3; i++) ids.push((await create()).json().id)
    const blocked = await create()
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json()).toEqual({ error: 'too_many_rooms' })
    await app.inject({ method: 'DELETE', url: `/rooms/${ids[0]}`, headers: await bearer() })
    expect((await create()).statusCode).toBe(201)
  })
  it('limits creation to 20 per day', async () => {
    for (let i = 0; i < 20; i++) await stores.rooms.create(record({ closedAt: 1 }))
    const res = await create()
    expect(res.statusCode).toBe(429)
    expect(res.json()).toEqual({ error: 'daily_limit' })
  })
})

describe('room info, listing, closing', () => {
  it('serves public info without the password hash, 404 when unknown or closed', async () => {
    const { slug, id } = (await create({ name: 'Movie night', password: 'pw' })).json()
    const info = (await app.inject(`/rooms/${slug}`)).json()
    expect(info).toMatchObject({ slug, name: 'Movie night', ownerName: 'Maya', live: 0, settings: { hasPassword: true } })
    expect(JSON.stringify(info)).not.toContain('passwordHash')
    expect((await app.inject('/rooms/nope')).statusCode).toBe(404)
    await app.inject({ method: 'DELETE', url: `/rooms/${id}`, headers: await bearer() })
    expect((await app.inject(`/rooms/${slug}`)).statusCode).toBe(404)
  })
  it('lists only the caller’s open rooms', async () => {
    await create({ name: 'mine' })
    await create({ name: 'theirs' }, '00000000-0000-4000-8000-000000000002')
    const list = (await app.inject({ method: 'GET', url: '/rooms', headers: await bearer() })).json()
    expect(list.map((r: { name: string }) => r.name)).toEqual(['mine'])
  })
  it('only lets the owner close a room; others get 404', async () => {
    const { id } = (await create()).json()
    const other = await app.inject({ method: 'DELETE', url: `/rooms/${id}`, headers: await bearer('00000000-0000-4000-8000-000000000002') })
    expect(other.statusCode).toBe(404)
    const own = await app.inject({ method: 'DELETE', url: `/rooms/${id}`, headers: await bearer() })
    expect(own.statusCode).toBe(204)
    expect((await stores.rooms.getById(id))?.closedAt).not.toBeNull()
  })
})

describe('POST /rooms/:slug/report', () => {
  it('accepts a report, validates it, and rate limits', async () => {
    const { slug } = (await create()).json()
    const url = `/rooms/${slug}/report`
    expect((await app.inject({ method: 'POST', url, payload: { reason: '' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: '/rooms/nope/report', payload: { reason: 'spam' } })).statusCode).toBe(404)
    let last = 0
    for (let i = 0; i < 6; i++) last = (await app.inject({ method: 'POST', url, payload: { reason: 'spam' }, remoteAddress: '198.51.100.9' })).statusCode
    expect(last).toBe(429)
    expect((await app.inject({ method: 'POST', url, payload: { reason: 'spam' }, remoteAddress: '198.51.100.10' })).statusCode).toBe(202)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w server -- app`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`server/src/slug.ts`:
```ts
import { randomInt } from 'node:crypto'

const ADJ = ['quiet', 'brave', 'sunny', 'lucky', 'cosmic', 'gentle', 'swift', 'mellow', 'bright', 'cozy', 'daring', 'humble', 'jolly', 'noble', 'rapid', 'witty']
const NOUN = ['otter', 'fox', 'heron', 'panda', 'lynx', 'falcon', 'koala', 'badger', 'walrus', 'gecko', 'raven', 'bison', 'newt', 'ibis', 'moose', 'wren']
const pick = (a: string[]) => a[randomInt(a.length)]!

export function newSlug(): string {
  return `${pick(ADJ)}-${pick(NOUN)}-${String(randomInt(100)).padStart(2, '0')}`
}
```
`server/src/app.ts`:
```ts
import cors from '@fastify/cors'
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify'
import { z } from 'zod'
import { sanitizeNickname, sanitizeText, type PublicSettings, type RoomSettings } from '@unison/shared'
import type { Auth, AuthIdentity } from './auth'
import { hashPassword } from './password'
import { hashIp } from './privacy'
import { RateLimiter } from './rateLimiter'
import type { RoomManager } from './roomManager'
import { newSlug } from './slug'
import type { RoomRecord, Stores } from './stores'

export interface AppDeps {
  auth: Auth
  stores: Stores
  manager: RoomManager
  ipSecret: string
  clientOrigin: string | string[]
  now: () => number
  nextId: () => string
  trustProxy?: boolean
  makeSlug?: () => string
}

export const DEFAULT_SETTINGS: RoomSettings = {
  controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true,
}
const DAY_MS = 86_400_000
const MAX_OPEN_ROOMS = 3
const MAX_ROOMS_PER_DAY = 20

const createBody = z.object({
  name: z.string().min(1).max(60),
  password: z.string().min(1).max(64).optional(),
  settings: z
    .object({
      controlMode: z.enum(['host', 'everyone']),
      allowGuests: z.boolean(),
      maxViewers: z.number().int().min(1).max(30),
      chatEnabled: z.boolean(),
      pauseOnBuffering: z.boolean(),
    })
    .partial()
    .optional(),
})
const reportBody = z.object({ reason: z.string().min(1).max(500) })

export async function createApp(d: AppDeps) {
  const app = Fastify({ trustProxy: d.trustProxy ?? false })
  await app.register(cors, {
    origin: d.clientOrigin,
    methods: ['GET', 'POST', 'DELETE'],
    allowedHeaders: ['authorization', 'content-type'],
  })

  const guestLimiter = new RateLimiter(20, 60_000, d.now)
  const reportLimiter = new RateLimiter(5, 60_000, d.now)
  const ipKey = (ip: string) => hashIp(ip, d.ipSecret, d.now())
  const makeSlug = d.makeSlug ?? newSlug
  const pub = (r: RoomRecord): PublicSettings => ({ ...r.settings, hasPassword: r.passwordHash !== null })
  const live = (slug: string) => d.manager.peek(slug)?.size ?? 0

  async function identify(req: FastifyRequest): Promise<AuthIdentity | null> {
    const h = req.headers.authorization
    return h?.startsWith('Bearer ') ? d.auth.verify(h.slice(7)) : null
  }
  async function requireHost(req: FastifyRequest, reply: FastifyReply): Promise<AuthIdentity | null> {
    const me = await identify(req)
    if (!me || me.isGuest) {
      void reply.code(401).send({ error: 'unauthorized' })
      return null
    }
    return me
  }

  app.get('/health', async () => ({ ok: true }))
  app.get('/stats', async () => d.manager.stats())

  app.post('/guest', async (req, reply) => {
    if (!guestLimiter.allow(ipKey(req.ip))) return reply.code(429).send({ error: 'rate_limited' })
    const nickname = sanitizeNickname((req.body as { nickname?: unknown } | null)?.nickname)
    if (!nickname) return reply.code(400).send({ error: 'bad_nickname' })
    const id = d.nextId()
    return { token: await d.auth.issueGuest(nickname, id), id, nickname }
  })

  app.get('/rooms/:slug', async (req, reply) => {
    const { slug } = req.params as { slug: string }
    const rec = await d.stores.rooms.getBySlug(slug)
    if (!rec || rec.closedAt !== null) return reply.code(404).send({ error: 'not_found' })
    return { slug: rec.slug, name: rec.name, ownerName: rec.ownerName, live: live(rec.slug), settings: pub(rec) }
  })

  app.post('/rooms', async (req, reply) => {
    const me = await requireHost(req, reply)
    if (!me) return
    const parsed = createBody.safeParse(req.body)
    const name = parsed.success ? sanitizeText(parsed.data.name, 60) : ''
    if (!parsed.success || !name) return reply.code(400).send({ error: 'bad_request' })
    if ((await d.stores.rooms.listOpenByOwner(me.id)).length >= MAX_OPEN_ROOMS) {
      return reply.code(429).send({ error: 'too_many_rooms' })
    }
    if ((await d.stores.rooms.countCreatedSince(me.id, d.now() - DAY_MS)) >= MAX_ROOMS_PER_DAY) {
      return reply.code(429).send({ error: 'daily_limit' })
    }
    let slug = ''
    for (let i = 0; i < 5 && !slug; i++) {
      const candidate = makeSlug()
      if (!(await d.stores.rooms.getBySlug(candidate))) slug = candidate
    }
    if (!slug) return reply.code(500).send({ error: 'slug_unavailable' })
    const rec: RoomRecord = {
      id: d.nextId(), slug, ownerId: me.id, ownerName: me.nickname, name,
      settings: { ...DEFAULT_SETTINGS, ...parsed.data.settings },
      passwordHash: parsed.data.password ? hashPassword(parsed.data.password) : null,
      createdAt: d.now(), closedAt: null,
    }
    await d.stores.rooms.create(rec)
    return reply.code(201).send({ id: rec.id, slug: rec.slug })
  })

  app.get('/rooms', async (req, reply) => {
    const me = await requireHost(req, reply)
    if (!me) return
    const rooms = await d.stores.rooms.listOpenByOwner(me.id)
    return rooms.map((r) => ({
      id: r.id, slug: r.slug, name: r.name, live: live(r.slug), settings: pub(r), createdAt: r.createdAt,
    }))
  })

  app.delete('/rooms/:id', async (req, reply) => {
    const me = await requireHost(req, reply)
    if (!me) return
    const rec = await d.stores.rooms.getById((req.params as { id: string }).id)
    if (!rec || rec.ownerId !== me.id) return reply.code(404).send({ error: 'not_found' })
    await d.stores.rooms.close(rec.id, d.now())
    d.manager.closeRoom(rec.id)
    return reply.code(204).send()
  })

  app.post('/rooms/:slug/report', async (req, reply) => {
    if (!reportLimiter.allow(ipKey(req.ip))) return reply.code(429).send({ error: 'rate_limited' })
    const parsed = reportBody.safeParse(req.body)
    const reason = parsed.success ? sanitizeText(parsed.data.reason, 500) : ''
    if (!reason) return reply.code(400).send({ error: 'bad_request' })
    const rec = await d.stores.rooms.getBySlug((req.params as { slug: string }).slug)
    if (!rec) return reply.code(404).send({ error: 'not_found' })
    const me = await identify(req)
    await d.stores.reports.add({ roomId: rec.id, reporterId: me && !me.isGuest ? me.id : null, reason, at: d.now() })
    return reply.code(202).send({ ok: true })
  })

  return app
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w server -- app`
Expected: PASS. Note: the guest-limiter test relies on `remoteAddress` being honored by `app.inject`; the same IP is used for all 21 calls.

- [ ] **Step 5: Commit**

```bash
git add server
git commit -m "feat(server): REST API for rooms, guests, reports"
```

---

### Task 12: WebSocket gateway, server assembly, entrypoint

**Files:**
- Create: `server/src/gateway.ts`, `server/src/server.ts`, `server/src/config.ts`, `server/src/index.ts`, `server/.env.example`
- Test: `server/test/gateway.test.ts`, `server/test/config.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `attachGateway(server: http.Server, d: GatewayDeps): { close(): void }` where `GatewayDeps = { auth: Auth; manager: RoomManager; ipSecret: string; now: () => number; nextId: () => string; maxSockets: number; maxPerIp: number; trustProxy: boolean; helloTimeoutMs?: number }`. Endpoint: `ws://host/ws?room=<slug>`; first message must be `hello`; payloads over 8 KB close with 1009.
  - `buildServer(o: ServerOptions): Promise<{ app: FastifyInstance; manager: RoomManager }>` with `ServerOptions = { auth: Auth; stores: Stores; clientOrigin: string | string[]; ipSecret: string; trustProxy: boolean; maxRooms: number; maxSockets: number; maxPerIp: number; helloTimeoutMs?: number; now?: () => number; nextId?: () => string }`.
  - `loadConfig(env?: NodeJS.ProcessEnv): Config`.
  - Close codes per plan clarification 7.

- [ ] **Step 1: Write the failing integration test** `server/test/gateway.test.ts`

```ts
import { describe, it, expect, afterEach } from 'vitest'
import WebSocket from 'ws'
import { SignJWT } from 'jose'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { createAuth } from '../src/auth'
import { createMemoryStores } from '../src/memoryStores'
import { buildServer } from '../src/server'
import type { Stores } from '../src/stores'
import { record, OWNER } from './storeContract'

const SB = 'sb-secret-1234567890'
const auth = createAuth({ guestSecret: 'guest-secret-1234567890', supabaseJwtSecret: SB })
const hostToken = () =>
  new SignJWT({ user_metadata: { full_name: 'Maya' } }).setProtectedHeader({ alg: 'HS256' }).setSubject(OWNER)
    .setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(SB))
const guestToken = (id: string, nick = 'Pat') => auth.issueGuest(nick, id)

type Msg = Record<string, any>
function connect(port: number, slug: string) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=${slug}`)
  const inbox: Msg[] = []
  const waiters: { pred: (m: Msg) => boolean; res: (m: Msg) => void }[] = []
  ws.on('message', (d) => {
    const m = JSON.parse(d.toString())
    inbox.push(m)
    for (const w of [...waiters]) if (w.pred(m)) { waiters.splice(waiters.indexOf(w), 1); w.res(m) }
  })
  const closed = new Promise<number>((res) => ws.on('close', (code) => res(code)))
  const opened = new Promise<void>((res) => ws.on('open', () => res()))
  return {
    ws, inbox, closed, opened,
    send: (m: unknown) => ws.send(typeof m === 'string' ? m : JSON.stringify(m)),
    waitFor: (pred: (m: Msg) => boolean, ms = 2000) =>
      new Promise<Msg>((res, rej) => {
        const hit = inbox.find(pred)
        if (hit) return res(hit)
        const t = setTimeout(() => rej(new Error('timeout waiting for message')), ms)
        waiters.push({ pred, res: (m) => { clearTimeout(t); res(m) } })
      }),
  }
}
const ofType = (type: string) => (m: Msg) => m.type === type

let app: FastifyInstance
let stores: Stores
let port: number
async function start(over: Partial<Parameters<typeof buildServer>[0]> = {}) {
  stores = createMemoryStores()
  let n = 0
  const built = await buildServer({
    auth, stores, clientOrigin: '*', ipSecret: 'ip-secret-1234567890123456', trustProxy: false,
    maxRooms: 100, maxSockets: 500, maxPerIp: 50, nextId: () => `id-${++n}`, ...over,
  })
  app = built.app
  await app.listen({ port: 0, host: '127.0.0.1' })
  port = (app.server.address() as AddressInfo).port
  const rec = record(); await stores.rooms.create(rec)
  return rec
}
afterEach(async () => { await app?.close() })

const media = { type: 'file', name: 'a.mp4', size: 1, duration: 600 }

describe('gateway', () => {
  it('runs a full host + guest session: sync state and chat', async () => {
    const rec = await start()
    const h = connect(port, rec.slug); await h.opened
    h.send({ type: 'hello', token: await hostToken() })
    expect((await h.waitFor(ofType('welcome'))).role).toBe('host')
    const g = connect(port, rec.slug); await g.opened
    g.send({ type: 'hello', token: await guestToken('g1') })
    expect((await g.waitFor(ofType('welcome'))).role).toBe('guest')

    h.send({ type: 'control', version: 0, action: 'setSource', source: media })
    h.send({ type: 'control', version: 1, action: 'play', position: 0 })
    const state = await g.waitFor((m) => m.type === 'state' && m.state.isPlaying)
    expect(state.state.source).toMatchObject({ type: 'file', name: 'a.mp4' })

    g.send({ type: 'chat', text: 'hello host' })
    expect((await h.waitFor(ofType('chat'))).message.text).toBe('hello host')
    h.ws.close(); g.ws.close()
  })

  it('survives junk input and keeps other clients unaffected (review focus 1)', async () => {
    const rec = await start()
    const good = connect(port, rec.slug); await good.opened
    good.send({ type: 'hello', token: await hostToken() })
    await good.waitFor(ofType('welcome'))

    const bad = connect(port, rec.slug); await bad.opened
    bad.send('{not json')
    expect((await bad.waitFor(ofType('error'))).code).toBe('bad_request')
    bad.send({ type: 'eval', code: 'process.exit(1)' })
    await bad.waitFor((m) => m.type === 'error' && bad.inbox.filter(ofType('error')).length === 2)
    bad.send({ type: 'chat', text: 'before hello' })
    await bad.waitFor((m) => m.code === 'unauthorized')
    bad.send({ type: 'hello', token: await guestToken('g1') }) // still usable after junk
    expect((await bad.waitFor(ofType('welcome'))).role).toBe('guest')

    const big = connect(port, rec.slug); await big.opened
    big.send(JSON.stringify({ type: 'hello', token: 'x'.repeat(20_000) }))
    expect(await big.closed).toBe(1009)

    good.send({ type: 'control', version: 0, action: 'setSource', source: media })
    await good.waitFor(ofType('state')) // server still healthy
    good.ws.close(); bad.ws.close()
  })

  it('closes with 4002 on a bad token and 4006 for an unknown room', async () => {
    const rec = await start()
    const a = connect(port, rec.slug); await a.opened
    a.send({ type: 'hello', token: 'garbage' })
    expect(await a.closed).toBe(4002)
    const b = connect(port, 'no-such-room'); await b.opened
    b.send({ type: 'hello', token: await guestToken('g1') })
    expect((await b.waitFor(ofType('error'))).code).toBe('not_found')
    expect(await b.closed).toBe(4006)
  })

  it('closes with 4000 when no hello arrives in time', async () => {
    const rec = await start({ helloTimeoutMs: 100 })
    const a = connect(port, rec.slug)
    expect(await a.closed).toBe(4000)
  })

  it('caps connections per IP with 1013', async () => {
    const rec = await start({ maxPerIp: 2 })
    const a = connect(port, rec.slug); const b = connect(port, rec.slug)
    await a.opened; await b.opened
    const c = connect(port, rec.slug)
    expect(await c.closed).toBe(1013)
    a.ws.close(); b.ws.close()
  })

  it('bans over the wire: banned guest is closed with 4004 and cannot come back', async () => {
    const rec = await start()
    const h = connect(port, rec.slug); await h.opened
    h.send({ type: 'hello', token: await hostToken() })
    await h.waitFor(ofType('welcome'))
    const token = await guestToken('g1')
    const g = connect(port, rec.slug); await g.opened
    g.send({ type: 'hello', token })
    await g.waitFor(ofType('welcome'))
    h.send({ type: 'mod', op: 'ban', target: 'g1' })
    expect(await g.closed).toBe(4004)
    const again = connect(port, rec.slug); await again.opened
    again.send({ type: 'hello', token })
    expect((await again.waitFor(ofType('error'))).code).toBe('banned')
    expect(await again.closed).toBe(4004)
    h.ws.close()
  })
})
```
`server/test/config.test.ts`:
```ts
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm test -w server -- gateway config`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement the gateway** `server/src/gateway.ts`

```ts
import type { IncomingMessage, Server } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import { clientMessageSchema, type ErrorCode, type ServerMessage } from '@unison/shared'
import type { Auth } from './auth'
import { hashIp } from './privacy'
import type { Conn, Room } from './room'
import type { RoomManager } from './roomManager'

export interface GatewayDeps {
  auth: Auth
  manager: RoomManager
  ipSecret: string
  now: () => number
  nextId: () => string
  maxSockets: number
  maxPerIp: number
  trustProxy: boolean
  helloTimeoutMs?: number
}

export function clientIp(req: IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fly = req.headers['fly-client-ip']
    if (typeof fly === 'string') return fly
    const xff = req.headers['x-forwarded-for']
    if (typeof xff === 'string') return xff.split(',')[0]!.trim()
  }
  return req.socket.remoteAddress ?? 'unknown'
}

const send = (ws: WebSocket, m: ServerMessage) => {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m))
}
const errorMsg = (code: ErrorCode, message = code): ServerMessage => ({ type: 'error', code, message })

export function attachGateway(server: Server, d: GatewayDeps): { close(): void } {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 8 * 1024 })
  const perIp = new Map<string, number>()
  let total = 0

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url ?? '/', 'http://localhost')
    if (url.pathname !== '/ws') return void socket.destroy()
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, url.searchParams.get('room') ?? ''))
  })

  wss.on('connection', (ws: WebSocket, req: IncomingMessage, slug: string) => {
    const ipHash = hashIp(clientIp(req, d.trustProxy), d.ipSecret, d.now())
    if (total >= d.maxSockets || (perIp.get(ipHash) ?? 0) >= d.maxPerIp) return void ws.close(1013, 'busy')
    total++
    perIp.set(ipHash, (perIp.get(ipHash) ?? 0) + 1)

    const conn: Conn = {
      id: d.nextId(),
      ipHash,
      send: (m) => send(ws, m),
      close: (code, reason) => ws.close(code, reason),
    }
    let room: Room | null = null
    let joining = false
    const helloTimer = setTimeout(() => {
      if (!room) ws.close(4000, 'hello timeout')
    }, d.helloTimeoutMs ?? 5000)

    ws.on('message', async (raw) => {
      let json: unknown
      try {
        json = JSON.parse(raw.toString())
      } catch {
        return send(ws, errorMsg('bad_request', 'invalid json'))
      }
      const parsed = clientMessageSchema.safeParse(json)
      if (!parsed.success) return send(ws, errorMsg('bad_request', 'invalid message'))
      const msg = parsed.data

      if (room) return room.handle(conn.id, msg)
      if (msg.type !== 'hello') return send(ws, errorMsg('unauthorized', 'send hello first'))
      if (joining) return
      joining = true
      try {
        const identity = await d.auth.verify(msg.token)
        if (!identity) {
          send(ws, errorMsg('unauthorized'))
          return void ws.close(4002, 'unauthorized')
        }
        const got = await d.manager.get(slug)
        if (!got.ok) {
          send(ws, errorMsg(got.code === 'busy' ? 'room_full' : 'not_found'))
          return void ws.close(4006, got.code)
        }
        const res = got.room.join(conn, identity, msg.password)
        if (!res.ok) {
          send(ws, errorMsg(res.code))
          return void ws.close(res.code === 'banned' ? 4004 : 4006, res.code)
        }
        if (ws.readyState !== ws.OPEN) return void got.room.leave(conn.id) // client left during the join
        room = got.room
      } finally {
        joining = false
      }
    })

    ws.on('close', () => {
      clearTimeout(helloTimer)
      room?.leave(conn.id)
      total--
      const left = (perIp.get(ipHash) ?? 1) - 1
      if (left <= 0) perIp.delete(ipHash)
      else perIp.set(ipHash, left)
    })
    ws.on('error', () => {})
  })

  return { close: () => wss.close() }
}
```

- [ ] **Step 4: Implement assembly, config, and entrypoint**

`server/src/server.ts`:
```ts
import { randomUUID } from 'node:crypto'
import { createApp } from './app'
import type { Auth } from './auth'
import { attachGateway } from './gateway'
import { RoomManager } from './roomManager'
import type { Stores } from './stores'

export interface ServerOptions {
  auth: Auth
  stores: Stores
  clientOrigin: string | string[]
  ipSecret: string
  trustProxy: boolean
  maxRooms: number
  maxSockets: number
  maxPerIp: number
  helloTimeoutMs?: number
  now?: () => number
  nextId?: () => string
}

export async function buildServer(o: ServerOptions) {
  const now = o.now ?? Date.now
  const nextId = o.nextId ?? (() => randomUUID())
  const manager = new RoomManager({ stores: o.stores, now, nextId, maxRooms: o.maxRooms, idleMs: 600_000 })
  const app = await createApp({
    auth: o.auth, stores: o.stores, manager, ipSecret: o.ipSecret, clientOrigin: o.clientOrigin, now, nextId,
    trustProxy: o.trustProxy,
  })
  const gateway = attachGateway(app.server, {
    auth: o.auth, manager, ipSecret: o.ipSecret, now, nextId, maxSockets: o.maxSockets, maxPerIp: o.maxPerIp,
    trustProxy: o.trustProxy, helloTimeoutMs: o.helloTimeoutMs,
  })
  const ticker = setInterval(() => manager.tickAll(), 1000)
  app.addHook('onClose', async () => {
    clearInterval(ticker)
    gateway.close()
  })
  return { app, manager }
}
```
`server/src/config.ts`:
```ts
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

export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const e = schema.parse(env)
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
```
Note: the config test `'splits CLIENT_ORIGIN on commas'` expects an array for two origins and a string for one; the code above does that.

`server/src/index.ts`:
```ts
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
```
`server/.env.example`:
```
PORT=8080
CLIENT_ORIGIN=http://localhost:5173
SUPABASE_URL=https://YOUR-PROJECT.supabase.co
SUPABASE_SERVICE_ROLE_KEY=
# Use one of the next two. Legacy projects: the JWT secret. Newer projects: the JWKS URL
# (https://YOUR-PROJECT.supabase.co/auth/v1/.well-known/jwks.json).
SUPABASE_JWT_SECRET=
SUPABASE_JWKS_URL=
# Generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
GUEST_TOKEN_SECRET=
IP_HASH_SECRET=
TRUST_PROXY=false
MAX_ROOMS=100
MAX_SOCKETS=500
MAX_PER_IP=10
```
- [ ] **Step 5: Run the whole server suite and typecheck**

Run: `npm test -w server && npm run typecheck -w server`
Expected: all tests PASS, no type errors. If the oversize-payload test reports a different close code, check that `maxPayload` is `8 * 1024` (ws closes with 1009 on overflow).

- [ ] **Step 6: Manual smoke test of the real entrypoint (optional until Supabase exists)**

Run: `cp server/.env.example server/.env`, fill values, then `npm run dev -w server` and `curl localhost:8080/health`.
Expected: `{"ok":true}`.

- [ ] **Step 7: Commit**

```bash
git add server package-lock.json
git commit -m "feat(server): WebSocket gateway, server assembly, config and entrypoint"
```

---

## Client

### Task 13: Client scaffold, styles, auth, and static pages

**Files:**
- Create: `client/package.json`, `client/tsconfig.json`, `client/vite.config.ts`, `client/index.html`, `client/.env.example`, `client/public/logo-mark.svg`, `client/src/{main.tsx,App.tsx,styles.css,vite-env.d.ts}`, `client/src/lib/{config.ts,api.ts,supabase.ts,auth.tsx,identity.ts}`, `client/src/components/Brand.tsx`, `client/src/pages/{Landing,SignIn,Dashboard,Join,Terms}.tsx`

**Interfaces:**
- Consumes: the REST contract from Task 11.
- Produces (used by Tasks 19 and 20):
  - `api` (see code), `ApiError`, `RoomInfo`, `MyRoom`
  - `useAuth(): { user: AuthUser | null; loading: boolean; signInWith(p: 'google' | 'discord'): Promise<void>; signInWithEmail(email: string): Promise<void>; signOut(): Promise<void> }`
  - `getAccessToken(): Promise<string | null>`; `getIdentity(): Promise<{token: string; isGuest: boolean} | null>`; `loadGuest()`, `saveGuest()`
  - `API_URL`, `WS_URL`
  - `<Brand />`
  - CSS classes from the prototype plus the additions below.

UI tasks are verified by typecheck, build, a manual look, and the Playwright suite in Task 21 (no component unit tests).

- [ ] **Step 1: Create the package files**

`client/package.json`:
```json
{
  "name": "@unison/client",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -p . && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "typecheck": "tsc -p ."
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.45.0",
    "@unison/shared": "*",
    "hls.js": "^1.5.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.26.0"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "typescript": "^5.6.0",
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```
`client/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["vite/client"] },
  "include": ["src", "test", "vite.config.ts"]
}
```
`client/vite.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```
`client/.env.example`:
```
VITE_API_URL=http://localhost:8080
VITE_WS_URL=ws://localhost:8080/ws
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=
```
`client/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />
```
`client/index.html`:
```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta name="theme-color" content="#0F0B1E">
  <title>Unison - Watch together</title>
  <link rel="icon" href="/logo-mark.svg">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="apple-touch-icon" href="/apple-touch-icon.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600&family=Sora:wght@600;700&display=swap" rel="stylesheet">
</head>
<body>
  <div id="root"></div>
  <script type="module" src="/src/main.tsx"></script>
</body>
</html>
```
Run: `npm install`

- [ ] **Step 2: Port the approved prototype styles and add app-specific CSS**

```bash
mkdir -p client/public client/src
cp docs/design/prototype/logo-mark.svg client/public/logo-mark.svg
cp docs/design/prototype/styles.css client/src/styles.css
```
Append this block to the end of `client/src/styles.css`:
```css
/* ---- React app additions (flat color only) ---- */
.sr-only{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
.err{color:var(--danger);font-size:14px;margin-top:10px}
.notice{background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:12px 14px;font-size:14px}
.toast{position:fixed;left:50%;bottom:max(20px,env(safe-area-inset-bottom));transform:translateX(-50%);background:var(--surface-2);
  border:1px solid var(--line);border-radius:12px;padding:10px 16px;z-index:30;max-width:calc(100vw - 32px)}
.overlay{position:absolute;inset:0;display:grid;place-items:center;background:rgba(15,11,30,.88);z-index:4;text-align:center;padding:16px}
.player video,.player .yt{position:absolute;inset:0;width:100%;height:100%;background:#000}
.player .controls{z-index:3}
.ctl-btn{min-width:44px;min-height:44px;display:inline-grid;place-items:center;border:0;background:transparent;color:#fff;cursor:pointer}
input[type=range]{width:100%;min-height:44px;padding:0;accent-color:var(--violet);background:transparent;border:0}
.link-like{background:none;border:0;color:var(--muted);text-decoration:underline;min-height:44px;cursor:pointer;font:inherit}
.stack{display:grid;gap:12px}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.file-btn{position:relative;overflow:hidden}
.file-btn input{position:absolute;inset:0;opacity:0;cursor:pointer;min-height:0}
.msg-del{margin-left:6px;min-height:44px;padding:0 12px}
.room{position:relative}
.show-landscape{display:none}
/* Phones in landscape and fullscreen: chat becomes a slide-over so the video keeps the screen. */
@media (orientation:landscape) and (max-height:520px) and (max-width:899px){
  .stage{flex-direction:row}
  .video-col{flex:1;min-width:0;display:flex;align-items:center;background:#05030d}
  .player{width:100%}
  .chat{position:absolute;right:0;top:0;bottom:0;width:min(340px,60vw);transform:translateX(105%);transition:transform .2s;z-index:5;border-left:1px solid var(--line)}
  .chat.open{transform:none}
  .show-landscape{display:inline-flex}
}
.stage:fullscreen{background:#000}
.stage:fullscreen .chat{position:absolute;right:0;top:0;bottom:0;width:min(340px,60vw);transform:translateX(105%);transition:transform .2s;z-index:5}
.stage:fullscreen .chat.open{transform:none}
.stage:fullscreen .show-landscape{display:inline-flex}
```

- [ ] **Step 3: Write the library files**

`client/src/lib/config.ts`:
```ts
export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8080'
export const WS_URL: string = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8080/ws'
```
`client/src/lib/supabase.ts`:
```ts
import { createClient } from '@supabase/supabase-js'

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL ?? 'http://localhost:54321',
  import.meta.env.VITE_SUPABASE_ANON_KEY ?? 'anon-key-not-set',
)
```
`client/src/lib/api.ts`:
```ts
import type { PublicSettings, RoomSettings } from '@unison/shared'
import { API_URL } from './config'

export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code)
  }
}

async function req<T>(path: string, o: { method?: string; token?: string | null; body?: unknown } = {}): Promise<T> {
  const res = await fetch(API_URL + path, {
    method: o.method ?? 'GET',
    headers: {
      ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
  })
  if (res.status === 204) return undefined as T
  const json = (await res.json().catch(() => ({}))) as { error?: string }
  if (!res.ok) throw new ApiError(res.status, json.error ?? 'error')
  return json as T
}

export interface RoomInfo { slug: string; name: string; ownerName: string; live: number; settings: PublicSettings }
export interface MyRoom { id: string; slug: string; name: string; live: number; settings: PublicSettings; createdAt: number }

export const api = {
  roomInfo: (slug: string) => req<RoomInfo>(`/rooms/${encodeURIComponent(slug)}`),
  createGuest: (nickname: string) => req<{ token: string; id: string; nickname: string }>('/guest', { method: 'POST', body: { nickname } }),
  createRoom: (token: string, body: { name: string; password?: string; settings?: Partial<RoomSettings> }) =>
    req<{ id: string; slug: string }>('/rooms', { method: 'POST', token, body }),
  listRooms: (token: string) => req<MyRoom[]>('/rooms', { token }),
  closeRoom: (token: string, id: string) => req<void>(`/rooms/${id}`, { method: 'DELETE', token }),
  report: (slug: string, reason: string, token?: string | null) =>
    req<{ ok: true }>(`/rooms/${encodeURIComponent(slug)}/report`, { method: 'POST', token, body: { reason } }),
}

export function messageFor(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'too_many_rooms') return 'You already have 3 open rooms. Close one first.'
    if (err.code === 'daily_limit') return 'Daily room limit reached. Try again tomorrow.'
    if (err.code === 'rate_limited') return 'Too many requests. Wait a minute and try again.'
    if (err.code === 'bad_nickname') return 'Pick a nickname.'
  }
  return 'Something went wrong. Please try again.'
}
```
`client/src/lib/identity.ts` (browser storage can throw in private windows, so every access is wrapped):
```ts
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
```
`client/src/lib/auth.tsx`:
```tsx
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { E2E } from './identity'
import { supabase } from './supabase'

export interface AuthUser { id: string; name: string }
interface Ctx {
  user: AuthUser | null
  loading: boolean
  signInWith(p: 'google' | 'discord'): Promise<void>
  signInWithEmail(email: string): Promise<void>
  signOut(): Promise<void>
}
const AuthContext = createContext<Ctx>(null as never)

function toUser(s: Session | null): AuthUser | null {
  if (!s) return null
  const m = (s.user.user_metadata ?? {}) as Record<string, string | undefined>
  return { id: s.user.id, name: m.full_name ?? m.name ?? s.user.email?.split('@')[0] ?? 'Host' }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(!E2E)

  useEffect(() => {
    if (E2E) return
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const redirectTo = `${window.location.origin}/dashboard`
  const user: AuthUser | null = E2E
    ? localStorage.getItem('e2e-token') ? { id: 'e2e-host', name: 'E2E Host' } : null
    : toUser(session)

  const value: Ctx = {
    user,
    loading,
    signInWith: async (provider) => {
      await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } })
    },
    signInWithEmail: async (email) => {
      const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } })
      if (error) throw error
    },
    signOut: async () => {
      await supabase.auth.signOut()
      if (E2E) localStorage.removeItem('e2e-token')
      window.location.assign('/')
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)
```

- [ ] **Step 4: Write the shell and pages**

`client/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```
`client/src/App.tsx`:
```tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth'
import Dashboard from './pages/Dashboard'
import Join from './pages/Join'
import Landing from './pages/Landing'
import SignIn from './pages/SignIn'
import Terms from './pages/Terms'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/signin" element={<SignIn />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/join/:slug" element={<Join />} />
          <Route path="/terms" element={<Terms />} />
          <Route path="*" element={<Landing />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
```
`client/src/components/Brand.tsx`:
```tsx
import { Link } from 'react-router-dom'

export function Brand() {
  return (
    <Link className="brand" to="/" aria-label="Unison home">
      <img src="/logo-mark.svg" alt="" />
      <span>unison</span>
    </Link>
  )
}
```
`client/src/pages/Landing.tsx`:
```tsx
import { Link } from 'react-router-dom'
import { Brand } from '../components/Brand'

export default function Landing() {
  return (
    <div className="wrap">
      <nav className="nav">
        <Brand />
        <Link className="btn" to="/signin">Sign in</Link>
      </nav>
      <header className="hero">
        <h1>Press play,<br /><span className="accent">together.</span></h1>
        <p>Free watch parties with live chat. Everyone plays their own copy, Unison keeps it in perfect sync. No downloads, no lag.</p>
        <div className="cta">
          <Link className="btn primary" to="/signin">Create a room</Link>
        </div>
        <div className="mock" aria-hidden="true">
          <div className="screen"><span><svg className="icon" viewBox="0 0 24 24" style={{ width: 28, height: 28 }}><path d="M8 5v14l11-7z" /></svg></span></div>
          <div className="chatline"><b style={{ color: 'var(--violet)' }}>Maya</b> ok wait for the good part</div>
          <div className="chatline"><b style={{ color: 'var(--coral)' }}>Leo</b> synced! 3 people in unison</div>
        </div>
      </header>
      <section className="features" id="how">
        <div className="card"><b>1. Make a room</b><span className="muted">Sign in and get a shareable link in one tap.</span></div>
        <div className="card"><b>2. Pick a video</b><span className="muted">A YouTube link or a file on your device. Nothing is uploaded.</span></div>
        <div className="card"><b>3. Watch and chat</b><span className="muted">Friends join with just a nickname. Play, pause and seek stay in sync.</span></div>
      </section>
      <footer>Unison is free. Only share content you have the rights to. &middot; <Link to="/terms">Terms</Link></footer>
    </div>
  )
}
```
`client/src/pages/SignIn.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { useAuth } from '../lib/auth'

export default function SignIn() {
  const { user, signInWith, signInWithEmail } = useAuth()
  const nav = useNavigate()
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { if (user) nav('/dashboard', { replace: true }) }, [user, nav])

  async function onEmail(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      await signInWithEmail(email.trim())
      setSent(true)
    } catch {
      setError('Could not send the link. Check the address and try again.')
    }
  }

  return (
    <div className="wrap">
      <nav className="nav"><Brand /></nav>
      <main className="center">
        <div className="card">
          <h2>Sign in to host</h2>
          <p className="muted" style={{ marginTop: 6 }}>You only need an account to create rooms. Friends can join without one.</p>
          <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
            <button className="btn block" onClick={() => void signInWith('google')}>Continue with Google</button>
            <button className="btn block" onClick={() => void signInWith('discord')}>Continue with Discord</button>
          </div>
          <div className="divider">or</div>
          {sent ? (
            <p className="notice">Check your inbox: we sent a sign-in link to {email}.</p>
          ) : (
            <form onSubmit={onEmail}>
              <label htmlFor="email" style={{ marginTop: 0 }}>Email</label>
              <input id="email" type="email" placeholder="you@example.com" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
              <button className="btn primary block" style={{ marginTop: 14 }}>Email me a magic link</button>
            </form>
          )}
          {error && <p className="err" role="alert">{error}</p>}
          <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>No passwords. By continuing you agree to the <a href="/terms">Terms</a>.</p>
        </div>
      </main>
    </div>
  )
}
```
`client/src/pages/Dashboard.tsx`:
```tsx
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { api, messageFor, type MyRoom } from '../lib/api'
import { useAuth } from '../lib/auth'
import { getAccessToken } from '../lib/identity'

export default function Dashboard() {
  const { user, loading, signOut } = useAuth()
  const nav = useNavigate()
  const [rooms, setRooms] = useState<MyRoom[]>([])
  const [name, setName] = useState('')
  const [password, setPassword] = useState('')
  const [allowGuests, setAllowGuests] = useState(true)
  const [everyone, setEveryone] = useState(false)
  const [cap, setCap] = useState(15)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const t = await getAccessToken()
    if (t) setRooms(await api.listRooms(t))
  }, [])

  useEffect(() => {
    if (loading) return
    if (!user) nav('/signin', { replace: true })
    else refresh().catch(() => setError('Could not load your rooms.'))
  }, [loading, user, nav, refresh])

  async function create(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const t = await getAccessToken()
      if (!t) throw new Error('not signed in')
      const r = await api.createRoom(t, {
        name: name.trim() || 'Movie night',
        password: password || undefined,
        settings: { allowGuests, controlMode: everyone ? 'everyone' : 'host', maxViewers: cap },
      })
      nav(`/r/${r.slug}`)
    } catch (err) {
      setError(messageFor(err))
    } finally {
      setBusy(false)
    }
  }
  async function close(id: string) {
    const t = await getAccessToken()
    if (!t) return
    await api.closeRoom(t, id)
    await refresh()
  }
  async function copy(slug: string) {
    await navigator.clipboard.writeText(`${window.location.origin}/r/${slug}`)
    setCopied(slug)
    setTimeout(() => setCopied(null), 1500)
  }

  return (
    <div className="wrap">
      <nav className="nav">
        <Brand />
        <button className="btn ghost" onClick={() => void signOut()}>Sign out</button>
      </nav>
      <main style={{ padding: '16px 0 40px' }}>
        <h2>My rooms</h2>
        <p className="muted">3 open rooms max. Empty rooms reset after 10 minutes; your link keeps working.</p>

        <form className="card" style={{ marginTop: 20 }} onSubmit={create}>
          <h3>New room</h3>
          <label htmlFor="rname">Room name</label>
          <input id="rname" placeholder="Friday movie night" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <label htmlFor="rpw">Password (optional)</label>
          <input id="rpw" type="password" maxLength={64} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <div className="toggle" style={{ marginTop: 8 }}><span>Allow guests</span><input type="checkbox" checked={allowGuests} onChange={(e) => setAllowGuests(e.target.checked)} aria-label="Allow guests" /></div>
          <div className="toggle"><span>Everyone can control playback</span><input type="checkbox" checked={everyone} onChange={(e) => setEveryone(e.target.checked)} aria-label="Everyone can control playback" /></div>
          <label htmlFor="cap">Max viewers</label>
          <select id="cap" value={cap} onChange={(e) => setCap(Number(e.target.value))}>
            <option value={5}>5</option><option value={15}>15</option><option value={30}>30</option>
          </select>
          <button className="btn primary block" style={{ marginTop: 16 }} disabled={busy}>Create room</button>
          {error && <p className="err" role="alert">{error}</p>}
        </form>

        <div className="rooms">
          {rooms.map((r) => (
            <div className="card" key={r.id}>
              <div className="room-row">
                <div className="meta">
                  <h3>{r.name}</h3>
                  <span className="muted" style={{ fontSize: 14 }}>{window.location.host}/r/{r.slug}</span>
                </div>
                <span className={r.live > 0 ? 'pill live' : 'pill'}>{r.live > 0 ? `${r.live} watching` : 'Empty'}</span>
              </div>
              <div className="row-actions">
                <Link className="btn primary" to={`/r/${r.slug}`}>Open</Link>
                <button className="btn" onClick={() => void copy(r.slug)}>{copied === r.slug ? 'Copied' : 'Copy link'}</button>
                <button className="btn danger" onClick={() => void close(r.id)}>Close</button>
              </div>
            </div>
          ))}
        </div>
      </main>
    </div>
  )
}
```
`client/src/pages/Join.tsx`:
```tsx
import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Brand } from '../components/Brand'
import { api, messageFor, type RoomInfo } from '../lib/api'
import { useAuth } from '../lib/auth'
import { loadGuest, saveGuest } from '../lib/identity'

export default function Join() {
  const { slug = '' } = useParams()
  const { user } = useAuth()
  const nav = useNavigate()
  const [info, setInfo] = useState<RoomInfo | null>(null)
  const [missing, setMissing] = useState(false)
  const [nick, setNick] = useState(loadGuest()?.nickname ?? '')
  const [pw, setPw] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    api.roomInfo(slug).then(setInfo).catch(() => setMissing(true))
  }, [slug])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(null)
    try {
      if (!user) {
        const name = nick.trim()
        const existing = loadGuest()
        const token = existing && existing.nickname === name ? existing.token : (await api.createGuest(name)).token
        saveGuest({ token, nickname: name })
      }
      try {
        if (pw) sessionStorage.setItem(`unison.pw.${slug}`, pw)
      } catch { /* private mode */ }
      nav(`/r/${slug}`)
    } catch (err) {
      setError(messageFor(err))
    }
  }

  return (
    <div className="wrap">
      <nav className="nav"><Brand /></nav>
      <main className="center">
        <div className="card">
          {missing ? (
            <>
              <h2>Room not found</h2>
              <p className="muted" style={{ marginTop: 6 }}>This room does not exist or was closed by its host.</p>
            </>
          ) : !info ? (
            <p className="muted">Loading room...</p>
          ) : (
            <>
              <span className={info.live > 0 ? 'pill live' : 'pill'}>{info.live > 0 ? `Live · ${info.live} watching` : 'Waiting for people'}</span>
              <h2 style={{ marginTop: 10 }}>{info.name}</h2>
              <p className="muted" style={{ marginTop: 4 }}>Hosted by {info.ownerName}</p>
              {!info.settings.allowGuests && !user ? (
                <p className="notice" style={{ marginTop: 16 }}>This room is for signed-in members only. <a href="/signin">Sign in</a> to join.</p>
              ) : (
                <form onSubmit={submit}>
                  {!user && (
                    <>
                      <label htmlFor="nick">Pick a nickname</label>
                      <input id="nick" maxLength={24} placeholder="e.g. PopcornPat" autoComplete="nickname" required value={nick} onChange={(e) => setNick(e.target.value)} />
                    </>
                  )}
                  {info.settings.hasPassword && (
                    <>
                      <label htmlFor="pw">Room password</label>
                      <input id="pw" type="password" required value={pw} onChange={(e) => setPw(e.target.value)} />
                    </>
                  )}
                  <button className="btn primary block" style={{ marginTop: 16 }}>Join room</button>
                  {error && <p className="err" role="alert">{error}</p>}
                </form>
              )}
              <p className="muted" style={{ fontSize: 13, marginTop: 14 }}>No account needed. <a href="/signin">Sign in</a> to host your own.</p>
            </>
          )}
        </div>
      </main>
    </div>
  )
}
```
`client/src/pages/Terms.tsx`:
```tsx
import { Brand } from '../components/Brand'

export default function Terms() {
  return (
    <div className="wrap">
      <nav className="nav"><Brand /></nav>
      <main style={{ maxWidth: 680, padding: '16px 0 60px' }} className="stack">
        <h1 style={{ fontSize: '2rem' }}>Terms of use</h1>
        <p className="muted">Unison is a free service provided as is. By using it you agree to the following.</p>
        <h3>Your content</h3>
        <p>Unison does not host or relay video. Each person plays their own copy. Only share links and files you have the right to watch together. Rooms that share content without permission may be removed.</p>
        <h3>Conduct</h3>
        <p>No harassment, hate, spam, or illegal content in rooms or chat. Hosts can remove and ban people from their rooms, and we may close rooms or block users that break these rules.</p>
        <h3>Privacy</h3>
        <p>We store your account profile, your rooms, bans and abuse reports. We do not store chat contents or raw IP addresses; IP addresses are hashed with a daily-rotating salt to limit abuse.</p>
        <h3>Takedown and contact</h3>
        <p>To report content or request a takedown, use the Report button in a room or email <a href="mailto:takedown@unison.example">takedown@unison.example</a>. Replace this address before launch.</p>
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Verify build, types, and look**

Run: `npm run typecheck -w client && npm run build -w client`
Expected: no errors; `client/dist` created.
Manual: `npm run dev -w client`, open `http://localhost:5173`, and compare landing, sign-in, and terms against `docs/design/prototype/`. Check at 360px width in the browser device toolbar: no horizontal scroll, nav logo readable, buttons at least 44px tall.

- [ ] **Step 6: Commit**

```bash
git add client package-lock.json
git commit -m "feat(client): scaffold, styles, auth, landing, sign-in, dashboard, join, terms"
```

---

### Task 14: Player interface and HtmlVideoAdapter (with the shared contract suite)

**Files:**
- Create: `client/src/player/Player.ts`, `client/src/player/HtmlVideoAdapter.ts`
- Test: `client/test/playerContract.ts` (shared suite), `client/test/htmlVideoAdapter.test.ts`

**Interfaces:**
- Produces:
  - `type PlayerEvent = 'play' | 'pause' | 'seek' | 'buffering' | 'ready' | 'blocked'`
  - `interface Player { play(): void; pause(): void; seek(seconds: number): void; getTime(): number; getDuration(): number; setRate(rate: number): void; isPlaying(): boolean; on(event: PlayerEvent, cb: (value?: boolean) => void): void; destroy(): void }` (the `'buffering'` callback receives `true`/`false`)
  - `interface VideoLike extends EventTarget { currentTime: number; duration: number; playbackRate: number; readonly paused: boolean; play(): Promise<void>; pause(): void }` (an `HTMLVideoElement` satisfies it)
  - `class HtmlVideoAdapter implements Player { constructor(video: VideoLike) }`
  - `runPlayerContract(name: string, make: () => { player: Player; sim: PlayerSim }): void` and `interface PlayerSim`, reused by Task 18.

- [ ] **Step 1: Write the shared contract suite** `client/test/playerContract.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import type { Player } from '../src/player/Player'

/** Simulates things the *platform* does (user taps native controls, network stalls, autoplay policy). */
export interface PlayerSim {
  userPlay(): void
  userPause(): void
  userSeek(to: number): void
  bufferStart(): void
  bufferEnd(): void
  ready(): void
  blockNextPlay(): void
  setDuration(n: number): void
}
const tick = () => new Promise<void>((r) => setTimeout(r, 0))

export function runPlayerContract(name: string, make: () => { player: Player; sim: PlayerSim }) {
  describe(`${name} satisfies the Player contract`, () => {
    it('emits play once when the platform starts playback, and isPlaying follows', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('play', cb)
      sim.userPlay(); await tick()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(player.isPlaying()).toBe(true)
    })
    it('emits pause and isPlaying follows', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('pause', cb)
      sim.userPlay(); sim.userPause(); await tick()
      expect(cb).toHaveBeenCalledTimes(1)
      expect(player.isPlaying()).toBe(false)
    })
    it('emits seek and reports the new time', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('seek', cb)
      sim.userSeek(30); await tick()
      expect(cb).toHaveBeenCalled()
      expect(player.getTime()).toBe(30)
    })
    it('emits buffering true then false', async () => {
      const { player, sim } = make()
      const seen: unknown[] = []; player.on('buffering', (v) => seen.push(v))
      sim.userPlay(); sim.bufferStart(); sim.bufferEnd(); await tick()
      expect(seen).toEqual([false, true, false]) // playback start reports not-buffering first
    })
    it('emits ready', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('ready', cb)
      sim.ready(); await tick()
      expect(cb).toHaveBeenCalled()
    })
    it('seek(), getTime(), getDuration() and setRate() work', () => {
      const { player, sim } = make()
      sim.setDuration(120)
      player.seek(42)
      expect(player.getTime()).toBe(42)
      expect(player.getDuration()).toBe(120)
      expect(() => player.setRate(1.05)).not.toThrow()
    })
    it('emits blocked when autoplay policy rejects play()', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('blocked', cb)
      sim.blockNextPlay(); player.play(); await tick()
      expect(cb).toHaveBeenCalledTimes(1)
    })
    it('stops emitting after destroy()', async () => {
      const { player, sim } = make()
      const cb = vi.fn(); player.on('play', cb); player.on('pause', cb)
      player.destroy()
      sim.userPlay(); sim.userPause(); await tick()
      expect(cb).not.toHaveBeenCalled()
    })
  })
}
```
The buffering expectation `[false, true, false]` assumes the sequence `userPlay` (adapter reports "not buffering" because playback started), `bufferStart`, `bufferEnd`. `HtmlVideoAdapter` emits `buffering:false` on the `playing` event, so the fake video's `play()` must also dispatch `playing` (see below); the YouTube adapter emits it on state 1 (Task 18).

- [ ] **Step 2: Write the failing adapter test** `client/test/htmlVideoAdapter.test.ts`

```ts
import { runPlayerContract } from './playerContract'
import { HtmlVideoAdapter, type VideoLike } from '../src/player/HtmlVideoAdapter'

class FakeVideo extends EventTarget implements VideoLike {
  paused = true
  playbackRate = 1
  duration = 100
  blockNext = false
  private t = 0
  get currentTime() { return this.t }
  set currentTime(v: number) {
    this.t = v
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')))
  }
  play(): Promise<void> {
    if (this.blockNext) {
      this.blockNext = false
      return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }))
    }
    this.paused = false
    this.dispatchEvent(new Event('play'))
    this.dispatchEvent(new Event('playing'))
    return Promise.resolve()
  }
  pause() {
    this.paused = true
    this.dispatchEvent(new Event('pause'))
  }
}

runPlayerContract('HtmlVideoAdapter', () => {
  const video = new FakeVideo()
  const player = new HtmlVideoAdapter(video)
  return {
    player,
    sim: {
      userPlay: () => void video.play(),
      userPause: () => video.pause(),
      userSeek: (to) => { video.currentTime = to },
      bufferStart: () => void video.dispatchEvent(new Event('waiting')),
      bufferEnd: () => void video.dispatchEvent(new Event('playing')),
      ready: () => void video.dispatchEvent(new Event('canplay')),
      blockNextPlay: () => { video.blockNext = true },
      setDuration: (n) => { video.duration = n },
    },
  }
})
```

- [ ] **Step 3: Run to verify it fails**

Run: `npm test -w client -- htmlVideoAdapter`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

`client/src/player/Player.ts`:
```ts
export type PlayerEvent = 'play' | 'pause' | 'seek' | 'buffering' | 'ready' | 'blocked'

export interface Player {
  play(): void
  pause(): void
  seek(seconds: number): void
  getTime(): number
  getDuration(): number
  setRate(rate: number): void
  isPlaying(): boolean
  on(event: PlayerEvent, cb: (value?: boolean) => void): void
  destroy(): void
}
```
`client/src/player/HtmlVideoAdapter.ts`:
```ts
import type { Player, PlayerEvent } from './Player'

export interface VideoLike extends EventTarget {
  currentTime: number
  duration: number
  playbackRate: number
  readonly paused: boolean
  play(): Promise<void>
  pause(): void
}
type Handler = (v?: boolean) => void

export class HtmlVideoAdapter implements Player {
  private handlers: Partial<Record<PlayerEvent, Handler[]>> = {}
  private listeners: Array<[string, EventListener]> = []

  constructor(private video: VideoLike) {
    const on = (name: string, fn: () => void) => {
      const l: EventListener = () => fn()
      video.addEventListener(name, l)
      this.listeners.push([name, l])
    }
    on('play', () => this.emit('play'))
    on('pause', () => this.emit('pause'))
    on('seeked', () => this.emit('seek'))
    on('waiting', () => this.emit('buffering', true))
    on('playing', () => this.emit('buffering', false))
    on('canplay', () => this.emit('ready'))
    on('loadedmetadata', () => this.emit('ready'))
  }

  play(): void {
    void this.video.play().catch((e: { name?: string }) => {
      if (e?.name === 'NotAllowedError') this.emit('blocked')
    })
  }
  pause(): void { this.video.pause() }
  seek(seconds: number): void { this.video.currentTime = seconds }
  getTime(): number { return this.video.currentTime }
  getDuration(): number { return this.video.duration }
  setRate(rate: number): void { this.video.playbackRate = rate }
  isPlaying(): boolean { return !this.video.paused }
  on(event: PlayerEvent, cb: Handler): void { (this.handlers[event] ??= []).push(cb) }
  destroy(): void {
    for (const [name, l] of this.listeners) this.video.removeEventListener(name, l)
    this.listeners = []
    this.handlers = {}
  }
  private emit(event: PlayerEvent, value?: boolean): void {
    this.handlers[event]?.forEach((h) => h(value))
  }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `npm test -w client`
Expected: PASS (8 contract tests).

- [ ] **Step 6: Commit**

```bash
git add client
git commit -m "feat(client): Player interface, HtmlVideoAdapter, shared contract suite"
```

---

### Task 15: SyncClient

**Files:**
- Create: `client/src/sync/syncClient.ts`
- Test: `client/test/syncClient.test.ts`

**Interfaces:**
- Consumes: `Player` (T14), `decideDrift`, `derivePosition`, `pickClockOffset`, protocol types (shared).
- Produces:
  ```ts
  interface SyncDeps {
    send(m: ClientMessage): void
    now(): number                              // client epoch ms
    onSource(s: Source | null): void           // room source changed; page must build a new Player and attachPlayer()
    onBlocked(): void                          // autoplay was blocked
    onMismatch(i: { expected: number; actual: number }): void
    onState?(s: RoomState): void
  }
  class SyncClient {
    state: RoomState | null; offset: number; userOffset: number
    constructor(d: SyncDeps)
    handleServer(m: ServerMessage): void
    startClockSync(): void                     // sends 5 pings
    attachPlayer(p: Player): void
    setUserOffset(seconds: number): void
    reconcile(): void                          // public: also called from a tap to satisfy autoplay policy
  }
  ```

- [ ] **Step 1: Write the failing test** `client/test/syncClient.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import type { ClientMessage, RoomState, ServerMessage, Source } from '@unison/shared'
import { SyncClient } from '../src/sync/syncClient'
import type { Player, PlayerEvent } from '../src/player/Player'

class FakePlayer implements Player {
  time = 0
  playing = false
  duration = 100
  calls: string[] = []
  private handlers: Partial<Record<PlayerEvent, Array<(v?: boolean) => void>>> = {}
  play() { this.playing = true; this.calls.push('play') }
  pause() { this.playing = false; this.calls.push('pause') }
  seek(s: number) { this.time = s; this.calls.push(`seek:${s}`) }
  getTime() { return this.time }
  getDuration() { return this.duration }
  setRate(r: number) { this.calls.push(`rate:${r}`) }
  isPlaying() { return this.playing }
  on(e: PlayerEvent, cb: (v?: boolean) => void) { (this.handlers[e] ??= []).push(cb) }
  destroy() { this.handlers = {} }
  emit(e: PlayerEvent, v?: boolean) { this.handlers[e]?.forEach((h) => h(v)) }
}

const file: Source = { type: 'file', name: 'a.mp4', size: 1, duration: 100 }

function make() {
  const clock = { t: 100_000 }
  const sent: ClientMessage[] = []
  const sources: (Source | null)[] = []
  const mismatches: { expected: number; actual: number }[] = []
  let blocked = 0
  const sync = new SyncClient({
    send: (m) => sent.push(m), now: () => clock.t, onSource: (s) => sources.push(s),
    onBlocked: () => blocked++, onMismatch: (m) => mismatches.push(m),
  })
  const player = new FakePlayer()
  const state = (over: Partial<RoomState> = {}): RoomState => ({
    source: file, isPlaying: true, position: 10, rate: 1, updatedAt: clock.t, version: 1, ...over,
  })
  const welcome = (s: RoomState): ServerMessage => ({
    type: 'welcome', you: 'me', role: 'guest', state: s, members: [], chat: [], serverTime: clock.t,
    settings: { controlMode: 'host', allowGuests: true, maxViewers: 15, chatEnabled: true, pauseOnBuffering: true, hasPassword: false },
  })
  const heartbeat = (s: RoomState): ServerMessage => ({ type: 'heartbeat', state: s, serverTime: clock.t })
  return { clock, sent, sources, mismatches, blocked: () => blocked, sync, player, state, welcome, heartbeat }
}

describe('SyncClient reconcile', () => {
  it('on attach, seeks to the derived position and plays when the room is playing', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.clock.t += 2000
    t.sync.attachPlayer(t.player)
    expect(t.player.calls).toEqual(['seek:12', 'rate:1', 'play'])
  })

  it('pauses and seeks exactly when the room is paused', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ isPlaying: false, position: 20 })))
    t.player.playing = true; t.player.time = 5
    t.sync.attachPlayer(t.player)
    expect(t.player.calls).toEqual(['pause', 'rate:1', 'seek:20'])
  })

  it('corrects drift: nothing under 0.3s, rate nudge to 2s, seek beyond', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.player.calls.length = 0
    const beat = () => t.sync.handleServer(t.heartbeat(t.state()))
    t.player.time = 10.1; beat()
    expect(t.player.calls.splice(0)).toEqual(['rate:1'])
    t.player.time = 11; beat()
    expect(t.player.calls.splice(0)).toEqual(['rate:0.95'])
    t.player.time = 9.5; beat()
    expect(t.player.calls.splice(0)).toEqual(['rate:1.05'])
    t.player.time = 14; beat()
    expect(t.player.calls.splice(0)).toEqual(['seek:10', 'rate:1'])
  })

  it('applies a per-client offset (local file that starts later)', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.player.calls.length = 0
    t.sync.setUserOffset(3)
    expect(t.player.calls).toEqual(['seek:13', 'rate:1'])
  })

  it('snaps back when the server says a local action was forbidden or stale', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.player.playing = true; t.player.time = 10
    t.sync.attachPlayer(t.player)
    t.player.time = 50; t.player.calls.length = 0
    t.sync.handleServer({ type: 'error', code: 'forbidden', message: 'forbidden' })
    expect(t.player.calls).toEqual(['seek:10', 'rate:1'])
  })
})

describe('SyncClient clock offset', () => {
  it('estimates the server clock from the lowest-RTT pong', () => {
    const t = make()
    t.clock.t = 5000
    t.sync.startClockSync()
    const pings = t.sent.filter((m): m is Extract<ClientMessage, { type: 'ping' }> => m.type === 'ping')
    expect(pings).toHaveLength(5)
    for (const p of pings) {
      t.clock.t += 20
      t.sync.handleServer({ type: 'pong', t0: p.t0, serverTime: p.t0 + 1010 })
    }
    expect(t.sync.offset).toBe(1000)
  })
})

describe('SyncClient local events and ordering', () => {
  it('ignores echoes of its own actions, then reports real user actions with version and position', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.attachPlayer(t.player) // performs play() and opens the ignore window
    t.player.emit('play')
    expect(t.sent.filter((m) => m.type === 'control')).toHaveLength(0)
    t.clock.t += 500
    t.player.time = 33
    t.player.emit('pause')
    expect(t.sent.at(-1)).toEqual({ type: 'control', version: 1, action: 'pause', position: 33 })
  })

  it('subtracts the user offset from reported positions', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ isPlaying: false })))
    t.sync.attachPlayer(t.player)
    t.sync.setUserOffset(3)
    t.clock.t += 500
    t.player.time = 33
    t.player.emit('seek')
    expect(t.sent.at(-1)).toMatchObject({ action: 'seek', position: 30 })
  })

  it('ignores out-of-order state', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state({ version: 5 })))
    t.sync.handleServer({ type: 'state', state: t.state({ version: 3, position: 99 }) })
    expect(t.sync.state?.version).toBe(5)
    expect(t.sync.state?.position).toBe(10)
  })

  it('reports source changes once and drops the old player', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.handleServer(t.heartbeat(t.state()))
    expect(t.sources).toEqual([file])
    t.sync.attachPlayer(t.player)
    const yt: Source = { type: 'youtube', id: 'dQw4w9WgXcQ' }
    t.sync.handleServer({ type: 'state', state: t.state({ version: 2, source: yt }) })
    expect(t.sources).toEqual([file, yt])
    t.player.calls.length = 0
    t.sync.handleServer(t.heartbeat(t.state({ version: 2, source: yt })))
    expect(t.player.calls).toEqual([]) // old player is no longer driven
  })

  it('forwards buffering and blocked events', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.attachPlayer(t.player)
    t.player.emit('buffering', true)
    expect(t.sent.at(-1)).toEqual({ type: 'buffering', value: true })
    t.player.emit('blocked')
    expect(t.blocked()).toBe(1)
  })
})

describe('SyncClient file mismatch', () => {
  it('warns when a local file duration differs from the host by more than 1s', () => {
    const t = make()
    t.sync.handleServer(t.welcome(t.state()))
    t.sync.attachPlayer(t.player)
    t.player.duration = 100.5; t.player.emit('ready')
    expect(t.mismatches).toEqual([])
    t.player.duration = 140; t.player.emit('ready')
    expect(t.mismatches).toEqual([{ expected: 100, actual: 140 }])
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- syncClient`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement** `client/src/sync/syncClient.ts`

```ts
import {
  decideDrift,
  derivePosition,
  pickClockOffset,
  type ClientMessage,
  type ClockSample,
  type RoomState,
  type ServerMessage,
  type Source,
} from '@unison/shared'
import type { Player } from '../player/Player'

/** Player events fired within this window after we drive the player ourselves are echoes, not user actions. */
const IGNORE_MS = 400

export interface SyncDeps {
  send(m: ClientMessage): void
  now(): number
  onSource(s: Source | null): void
  onBlocked(): void
  onMismatch(i: { expected: number; actual: number }): void
  onState?(s: RoomState): void
}

export class SyncClient {
  state: RoomState | null = null
  offset = 0 // serverNow = clientNow + offset
  userOffset = 0 // seconds, per-client correction for a different local file
  private player: Player | null = null
  private ignoreUntil = 0
  private samples: ClockSample[] = []
  private sourceKey = 'null'

  constructor(private d: SyncDeps) {}

  handleServer(m: ServerMessage): void {
    switch (m.type) {
      case 'welcome':
        this.offset = m.serverTime - this.d.now()
        this.setState(m.state)
        break
      case 'pong':
        this.samples = [...this.samples, { t0: m.t0, t1: this.d.now(), serverTime: m.serverTime }].slice(-5)
        this.offset = pickClockOffset(this.samples)
        this.reconcile()
        break
      case 'state':
      case 'heartbeat':
        this.setState(m.state)
        break
      case 'error':
        if (m.code === 'forbidden' || m.code === 'stale') this.reconcile()
        break
    }
  }

  startClockSync(): void {
    this.samples = []
    for (let i = 0; i < 5; i++) this.d.send({ type: 'ping', t0: this.d.now() })
  }

  attachPlayer(p: Player): void {
    this.player = p
    const live = () => this.player === p
    p.on('ready', () => {
      if (!live()) return
      this.checkDuration()
      this.reconcile()
    })
    p.on('play', () => live() && this.onLocal('play'))
    p.on('pause', () => live() && this.onLocal('pause'))
    p.on('seek', () => live() && this.onLocal('seek'))
    p.on('buffering', (v) => live() && this.d.send({ type: 'buffering', value: !!v }))
    p.on('blocked', () => live() && this.d.onBlocked())
    this.reconcile()
  }

  setUserOffset(seconds: number): void {
    this.userOffset = seconds
    this.reconcile()
  }

  reconcile(): void {
    const p = this.player
    const s = this.state
    if (!p || !s || !s.source) return
    const expected = this.expected(s)
    const act = decideDrift(p.getTime(), expected)
    if (s.isPlaying) {
      if (!p.isPlaying()) {
        this.quiet()
        p.seek(expected)
        p.setRate(1)
        p.play()
      } else if (act.kind === 'seek') {
        this.quiet()
        p.seek(act.to)
        p.setRate(1)
      } else {
        p.setRate(act.kind === 'rate' ? act.rate : 1)
      }
    } else {
      this.quiet()
      if (p.isPlaying()) p.pause()
      p.setRate(1)
      if (act.kind !== 'none') p.seek(expected)
    }
  }

  private expected(s: RoomState): number {
    return derivePosition(s, this.d.now() + this.offset) + this.userOffset
  }

  private quiet(): void {
    this.ignoreUntil = this.d.now() + IGNORE_MS
  }

  private setState(s: RoomState): void {
    if (this.state && s.version < this.state.version) return
    this.state = s
    this.d.onState?.(s)
    const key = JSON.stringify(s.source)
    if (key !== this.sourceKey) {
      this.sourceKey = key
      this.player = null // the page builds a new player for the new source
      this.d.onSource(s.source)
    }
    this.reconcile()
  }

  private onLocal(kind: 'play' | 'pause' | 'seek'): void {
    if (this.d.now() < this.ignoreUntil || !this.player) return
    this.d.send({
      type: 'control',
      version: this.state?.version ?? 0,
      action: kind,
      position: Math.max(0, this.player.getTime() - this.userOffset),
    })
  }

  private checkDuration(): void {
    const src = this.state?.source
    if (!this.player || src?.type !== 'file' || src.duration === undefined) return
    const actual = this.player.getDuration()
    if (Number.isFinite(actual) && Math.abs(actual - src.duration) > 1) {
      this.d.onMismatch({ expected: src.duration, actual })
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client`
Expected: PASS. If the "ignores echoes" test fails, check `attachPlayer` calls `reconcile()` last and that `quiet()` runs before `p.play()` in the not-playing branch.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): SyncClient with drift correction, clock offset and echo suppression"
```

---

### Task 16: RoomSocket (reconnecting WebSocket)

**Files:**
- Create: `client/src/net/roomSocket.ts`
- Test: `client/test/roomSocket.test.ts`

**Interfaces:**
- Produces:
  ```ts
  type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'
  interface RoomSocketOpts {
    url: string
    getHello(): Promise<ClientMessage | null>     // null means no identity: stop
    onMessage(m: ServerMessage): void
    onStatus(s: SocketStatus, info?: { code: number }): void
    create?(url: string): WSLike                  // injectable for tests
    setTimer?(fn: () => void, ms: number): unknown
    clearTimer?(h: unknown): void
    random?(): number
  }
  class RoomSocket { constructor(o: RoomSocketOpts); connect(): void; send(m: ClientMessage): void; close(): void }
  ```
  Backoff: `min(15000, 500 * 2^attempt) * (0.5 + random()*0.5)`. No reconnect on close codes 4002 to 4006 and 4008. Status `'open'` is reported when `welcome` arrives, and the attempt counter resets then.

- [ ] **Step 1: Write the failing test** `client/test/roomSocket.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { RoomSocket, type WSLike } from '../src/net/roomSocket'

class FakeWS implements WSLike {
  static all: FakeWS[] = []
  readyState = 1
  sent: string[] = []
  closedByUs = false
  onopen: (() => void | Promise<void>) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  onclose: ((e: { code: number }) => void) | null = null
  constructor(public url: string) { FakeWS.all.push(this) }
  send(d: string) { this.sent.push(d) }
  close() { this.closedByUs = true }
}

function make(getHello: () => Promise<any> = async () => ({ type: 'hello', token: 't' })) {
  FakeWS.all = []
  const timers: { fn: () => void; ms: number }[] = []
  const statuses: Array<[string, number | undefined]> = []
  const sock = new RoomSocket({
    url: 'ws://x/ws?room=r',
    getHello,
    onMessage: () => {},
    onStatus: (s, i) => statuses.push([s, i?.code]),
    create: (u) => new FakeWS(u),
    setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length },
    clearTimer: () => {},
    random: () => 1,
  })
  return { sock, timers, statuses }
}
const welcome = JSON.stringify({ type: 'welcome' })

describe('RoomSocket', () => {
  it('sends hello when the socket opens', async () => {
    const { sock } = make()
    sock.connect()
    const ws = FakeWS.all[0]!
    await ws.onopen!()
    expect(JSON.parse(ws.sent[0]!)).toEqual({ type: 'hello', token: 't' })
  })

  it('reconnects with exponential backoff, and a welcome resets the backoff', async () => {
    const { sock, timers, statuses } = make()
    sock.connect()
    FakeWS.all[0]!.onclose!({ code: 1006 })
    expect(timers[0]!.ms).toBe(500)
    timers[0]!.fn()
    FakeWS.all[1]!.onclose!({ code: 1006 })
    expect(timers[1]!.ms).toBe(1000)
    timers[1]!.fn()
    FakeWS.all[2]!.onmessage!({ data: welcome })
    expect(statuses.at(-1)![0]).toBe('open')
    FakeWS.all[2]!.onclose!({ code: 1006 })
    expect(timers[2]!.ms).toBe(500)
  })

  it('caps the backoff at 15 seconds', () => {
    const { sock, timers } = make()
    sock.connect()
    for (let i = 0; i < 8; i++) {
      FakeWS.all.at(-1)!.onclose!({ code: 1006 })
      timers.at(-1)!.fn()
    }
    FakeWS.all.at(-1)!.onclose!({ code: 1006 })
    expect(timers.at(-1)!.ms).toBe(15000)
  })

  it('does not reconnect after kicked, banned, closed, refused or rate-limit codes', () => {
    for (const code of [4002, 4003, 4004, 4005, 4006, 4008]) {
      const { sock, timers, statuses } = make()
      sock.connect()
      FakeWS.all[0]!.onclose!({ code })
      expect(timers).toHaveLength(0)
      expect(statuses.at(-1)).toEqual(['closed', code])
    }
  })

  it('stops when there is no identity to say hello with', async () => {
    const { sock, statuses } = make(async () => null)
    sock.connect()
    const ws = FakeWS.all[0]!
    await ws.onopen!()
    expect(ws.closedByUs).toBe(true)
    expect(statuses.at(-1)![0]).toBe('closed')
  })

  it('does not reconnect after close(), and only sends while open', () => {
    const { sock, timers } = make()
    sock.connect()
    const ws = FakeWS.all[0]!
    sock.send({ type: 'ping', t0: 1 })
    expect(ws.sent).toHaveLength(1)
    sock.close()
    ws.onclose!({ code: 1000 })
    expect(timers).toHaveLength(0)
    ws.readyState = 3
    sock.send({ type: 'ping', t0: 2 })
    expect(ws.sent).toHaveLength(1)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- roomSocket`
Expected: FAIL.

- [ ] **Step 3: Implement** `client/src/net/roomSocket.ts`

```ts
import type { ClientMessage, ServerMessage } from '@unison/shared'

export type SocketStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface WSLike {
  readyState: number
  send(d: string): void
  close(): void
  onopen: (() => void | Promise<void>) | null
  onmessage: ((e: { data: string }) => void) | null
  onclose: ((e: { code: number }) => void) | null
}

export interface RoomSocketOpts {
  url: string
  getHello(): Promise<ClientMessage | null>
  onMessage(m: ServerMessage): void
  onStatus(s: SocketStatus, info?: { code: number }): void
  create?(url: string): WSLike
  setTimer?(fn: () => void, ms: number): unknown
  clearTimer?(h: unknown): void
  random?(): number
}

/** Kicked, banned, room closed, join refused, unauthorized, rate limit: reconnecting would not help. */
const FATAL = new Set([4002, 4003, 4004, 4005, 4006, 4008])

export class RoomSocket {
  private ws: WSLike | null = null
  private attempt = 0
  private timer: unknown = null
  private stopped = false

  constructor(private o: RoomSocketOpts) {}

  connect(): void {
    this.stopped = false
    this.open()
  }

  send(m: ClientMessage): void {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m))
  }

  close(): void {
    this.stopped = true
    if (this.timer !== null) (this.o.clearTimer ?? ((h) => clearTimeout(h as number)))(this.timer)
    this.ws?.close()
  }

  private open(): void {
    this.o.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = (this.o.create ?? ((u) => new WebSocket(u) as unknown as WSLike))(this.o.url)
    this.ws = ws
    ws.onopen = async () => {
      const hello = await this.o.getHello()
      if (!hello) {
        this.stopped = true
        ws.close()
        this.o.onStatus('closed', { code: 4002 })
        return
      }
      ws.send(JSON.stringify(hello))
    }
    ws.onmessage = (e) => {
      let m: ServerMessage
      try {
        m = JSON.parse(e.data) as ServerMessage
      } catch {
        return
      }
      if (m.type === 'welcome') {
        this.attempt = 0
        this.o.onStatus('open')
      }
      this.o.onMessage(m)
    }
    ws.onclose = (e) => {
      this.ws = null
      if (this.stopped) return
      if (FATAL.has(e.code)) {
        this.stopped = true
        this.o.onStatus('closed', { code: e.code })
        return
      }
      const base = Math.min(15000, 500 * 2 ** this.attempt)
      const delay = base * (0.5 + (this.o.random ?? Math.random)() * 0.5)
      this.attempt++
      this.o.onStatus('reconnecting')
      this.timer = (this.o.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => this.open(), delay)
    }
  }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): reconnecting RoomSocket with backoff and fatal close codes"
```

---

### Task 17: Source input parsing

**Files:**
- Create: `client/src/lib/sourceInput.ts`
- Test: `client/test/sourceInput.test.ts`

**Interfaces:**
- Produces: `parseSourceInput(raw: string): {ok: true; source: Source} | {ok: false; reason: string}`. Returns a `Source` of type `youtube`, `hls`, or `url` (files come from the file picker, not text).

- [ ] **Step 1: Write the failing test** `client/test/sourceInput.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { parseSourceInput } from '../src/lib/sourceInput'

const yt = { ok: true, source: { type: 'youtube', id: 'dQw4w9WgXcQ' } }

describe('parseSourceInput', () => {
  it('parses the common YouTube URL shapes', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=30s',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?si=abc',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      '  https://youtu.be/dQw4w9WgXcQ  ',
    ]) expect(parseSourceInput(url)).toEqual(yt)
  })
  it('rejects a YouTube link with a bad id', () => {
    expect(parseSourceInput('https://youtu.be/short').ok).toBe(false)
    expect(parseSourceInput('https://www.youtube.com/watch').ok).toBe(false)
  })
  it('detects HLS playlists and plain video URLs', () => {
    expect(parseSourceInput('https://cdn.example.com/live/master.m3u8')).toEqual({
      ok: true, source: { type: 'hls', url: 'https://cdn.example.com/live/master.m3u8' },
    })
    expect(parseSourceInput('https://cdn.example.com/movie.mp4')).toEqual({
      ok: true, source: { type: 'url', url: 'https://cdn.example.com/movie.mp4' },
    })
  })
  it('rejects non-https, private hosts and non-URLs with a helpful reason', () => {
    expect(parseSourceInput('http://cdn.example.com/a.mp4')).toMatchObject({ ok: false })
    expect(parseSourceInput('https://192.168.1.5/a.mp4')).toMatchObject({ ok: false })
    expect(parseSourceInput('hello there')).toMatchObject({ ok: false, reason: expect.stringContaining('https://') })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- sourceInput`
Expected: FAIL.

- [ ] **Step 3: Implement** `client/src/lib/sourceInput.ts`

```ts
import { validateSourceUrl, type Source } from '@unison/shared'

export type ParsedInput = { ok: true; source: Source } | { ok: false; reason: string }

export function parseSourceInput(raw: string): ParsedInput {
  const text = raw.trim()
  let u: URL
  try {
    u = new URL(text)
  } catch {
    return { ok: false, reason: 'Paste a full link starting with https://' }
  }
  const host = u.hostname.toLowerCase().replace(/^(www|m)\./, '')
  let id: string | null | undefined
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0]
  } else if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') id = u.searchParams.get('v')
    else id = /^\/(?:embed|shorts|live)\/([^/]+)/.exec(u.pathname)?.[1] ?? null
  } else {
    id = undefined
  }
  if (id !== undefined) {
    return id && /^[A-Za-z0-9_-]{11}$/.test(id)
      ? { ok: true, source: { type: 'youtube', id } }
      : { ok: false, reason: 'That does not look like a valid YouTube link.' }
  }
  const check = validateSourceUrl(text)
  if (!check.ok) return { ok: false, reason: 'Only public https links are supported.' }
  return { ok: true, source: { type: /\.m3u8$/i.test(u.pathname) ? 'hls' : 'url', url: check.url } }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): parse YouTube, HLS and direct video links"
```

---

### Task 18: YouTubeAdapter

**Files:**
- Create: `client/src/player/YouTubeAdapter.ts`
- Test: `client/test/youtubeAdapter.test.ts`

**Interfaces:**
- Consumes: `Player` (T14), `runPlayerContract`/`PlayerSim` (T14).
- Produces: `interface YTPlayerLike`, `class YouTubeAdapter implements Player { constructor(yt: YTPlayerLike, now?: () => number, pollMs?: number); onReady(): void; onStateChange(state: number): void; onAutoplayBlocked(): void; pollForSeek(): void }`, and `createYouTubeAdapter(container: HTMLElement, videoId: string, controls: boolean): Promise<YouTubeAdapter>`.

- [ ] **Step 1: Write the failing test** `client/test/youtubeAdapter.test.ts`

```ts
import { describe, it, expect, vi } from 'vitest'
import { runPlayerContract, type PlayerSim } from './playerContract'
import { YouTubeAdapter, type YTPlayerLike } from '../src/player/YouTubeAdapter'

class FakeYT implements YTPlayerLike {
  time = 0
  dur = 100
  state = -1
  blockNext = false
  adapter!: YouTubeAdapter
  playVideo() {
    if (this.blockNext) { this.blockNext = false; this.adapter.onAutoplayBlocked(); return }
    this.state = 1; this.adapter.onStateChange(1)
  }
  pauseVideo() { this.state = 2; this.adapter.onStateChange(2) }
  seekTo(s: number) { this.time = s }
  getCurrentTime() { return this.time }
  getDuration() { return this.dur }
  setPlaybackRate() {}
  getPlayerState() { return this.state }
  destroy() {}
}

function build(now: () => number = Date.now) {
  const yt = new FakeYT()
  const player = new YouTubeAdapter(yt, now, 0) // pollMs 0: tests call pollForSeek() themselves
  yt.adapter = player
  const sim: PlayerSim = {
    userPlay: () => { yt.state = 1; player.onStateChange(1) },
    userPause: () => { yt.state = 2; player.onStateChange(2) },
    userSeek: (to) => { yt.time = to; player.pollForSeek() },
    bufferStart: () => { yt.state = 3; player.onStateChange(3) },
    bufferEnd: () => { yt.state = 1; player.onStateChange(1) },
    ready: () => player.onReady(),
    blockNextPlay: () => { yt.blockNext = true },
    setDuration: (n) => { yt.dur = n },
  }
  return { yt, player, sim }
}

runPlayerContract('YouTubeAdapter', () => build())

describe('YouTubeAdapter specifics', () => {
  it('does not re-emit play when buffering ends during playback', () => {
    const { player, sim } = build()
    const play = vi.fn(); player.on('play', play)
    sim.userPlay(); sim.bufferStart(); sim.bufferEnd()
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('treats the end of the video as a pause', () => {
    const { player } = build()
    const pause = vi.fn(); player.on('pause', pause)
    player.onStateChange(1); player.onStateChange(0)
    expect(pause).toHaveBeenCalledTimes(1)
  })

  it('does not report a seek for normal playback progress but does for a jump', () => {
    let t = 0
    const { yt, player, sim } = build(() => t)
    const seek = vi.fn(); player.on('seek', seek)
    sim.userPlay(); player.pollForSeek() // baseline while playing
    t += 10_000; yt.time = 10; player.pollForSeek()
    expect(seek).not.toHaveBeenCalled()
    t += 500; yt.time = 60; player.pollForSeek()
    expect(seek).toHaveBeenCalledTimes(1)
  })

  it('programmatic seek does not look like a user seek on the next poll', () => {
    const { player, sim } = build()
    const seek = vi.fn(); player.on('seek', seek)
    sim.userPlay(); player.pollForSeek()
    player.seek(45); player.pollForSeek()
    expect(seek).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- youtubeAdapter`
Expected: FAIL.

- [ ] **Step 3: Implement** `client/src/player/YouTubeAdapter.ts`

```ts
import type { Player, PlayerEvent } from './Player'

export interface YTPlayerLike {
  playVideo(): void
  pauseVideo(): void
  seekTo(seconds: number, allowSeekAhead: boolean): void
  getCurrentTime(): number
  getDuration(): number
  setPlaybackRate(rate: number): void
  getPlayerState(): number
  destroy(): void
}
type Handler = (v?: boolean) => void

// YouTube player states: -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued.
const PLAYING = 1

export class YouTubeAdapter implements Player {
  private handlers: Partial<Record<PlayerEvent, Handler[]>> = {}
  private wasPlaying = false
  private lastTime = 0
  private lastAt: number
  private lastPlaying = false
  private timer: ReturnType<typeof setInterval> | null = null

  constructor(
    private yt: YTPlayerLike,
    private now: () => number = Date.now,
    pollMs = 500,
  ) {
    this.lastAt = now()
    if (pollMs > 0) this.timer = setInterval(() => this.pollForSeek(), pollMs)
  }

  onReady(): void { this.emit('ready') }
  onAutoplayBlocked(): void { this.emit('blocked') }

  onStateChange(state: number): void {
    if (state === PLAYING) {
      this.emit('buffering', false)
      if (!this.wasPlaying) {
        this.wasPlaying = true
        this.emit('play')
      }
    } else if (state === 2 || state === 0) {
      this.wasPlaying = false
      this.emit('pause')
    } else if (state === 3) {
      this.emit('buffering', true)
    }
  }

  /** The IFrame API has no seek event, so detect jumps that playback progress cannot explain. */
  pollForSeek(): void {
    const t = this.yt.getCurrentTime()
    const at = this.now()
    const playing = this.yt.getPlayerState() === PLAYING
    const expected = playing && this.lastPlaying ? this.lastTime + (at - this.lastAt) / 1000 : this.lastTime
    if (Math.abs(t - expected) > 1.5) this.emit('seek')
    this.lastTime = t
    this.lastAt = at
    this.lastPlaying = playing
  }

  play(): void { this.yt.playVideo() }
  pause(): void { this.yt.pauseVideo() }
  seek(seconds: number): void {
    this.yt.seekTo(seconds, true)
    this.lastTime = seconds
    this.lastAt = this.now()
  }
  getTime(): number { return this.yt.getCurrentTime() }
  getDuration(): number { return this.yt.getDuration() }
  setRate(rate: number): void { this.yt.setPlaybackRate(rate) }
  isPlaying(): boolean { return this.yt.getPlayerState() === PLAYING }
  on(event: PlayerEvent, cb: Handler): void { (this.handlers[event] ??= []).push(cb) }
  destroy(): void {
    if (this.timer) clearInterval(this.timer)
    this.handlers = {}
    this.yt.destroy()
  }
  private emit(event: PlayerEvent, value?: boolean): void {
    this.handlers[event]?.forEach((h) => h(value))
  }
}

declare global {
  interface Window {
    YT?: { Player: new (el: HTMLElement, opts: unknown) => YTPlayerLike }
    onYouTubeIframeAPIReady?: () => void
  }
}

let apiPromise: Promise<NonNullable<Window['YT']>> | null = null
function loadApi(): Promise<NonNullable<Window['YT']>> {
  apiPromise ??= new Promise((resolve) => {
    if (window.YT?.Player) return resolve(window.YT)
    window.onYouTubeIframeAPIReady = () => resolve(window.YT!)
    const s = document.createElement('script')
    s.src = 'https://www.youtube.com/iframe_api'
    document.head.appendChild(s)
  })
  return apiPromise
}

export async function createYouTubeAdapter(container: HTMLElement, videoId: string, controls: boolean): Promise<YouTubeAdapter> {
  const YT = await loadApi()
  return new Promise((resolve) => {
    let adapter!: YouTubeAdapter
    const yt = new YT.Player(container, {
      videoId,
      playerVars: { controls: controls ? 1 : 0, disablekb: controls ? 0 : 1, playsinline: 1, rel: 0, modestbranding: 1 },
      events: {
        onReady: () => { adapter.onReady(); resolve(adapter) },
        onStateChange: (e: { data: number }) => adapter.onStateChange(e.data),
        onAutoplayBlocked: () => adapter.onAutoplayBlocked(),
      },
    })
    adapter = new YouTubeAdapter(yt)
  })
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client && npm run typecheck -w client`
Expected: all PASS (contract tests run for both adapters), no type errors.

- [ ] **Step 5: Commit**

```bash
git add client
git commit -m "feat(client): YouTubeAdapter with seek detection, passes the Player contract"
```

### Task 19: The room (useRoom, player stage, chat, members, source picker)

**Files:**
- Create: `e2e/package.json` (replaces the placeholder), `e2e/harness.ts`, `client/src/lib/{colors,format}.ts`, `client/src/room/useRoom.ts`, `client/src/components/{PlayerStage,SourcePicker,Chat,Members}.tsx`, `client/src/pages/Room.tsx`
- Modify: `client/src/App.tsx` (add the `/r/:slug` route), `client/src/styles.css` (append)

**Interfaces:**
- Consumes: `SyncClient` (T15), `RoomSocket` (T16), adapters (T14, T18), `parseSourceInput` (T17), `api`/identity (T13).
- Produces (used by Task 20):
  - `useRoom(slug: string): RoomView` with `RoomView = { status: SocketStatus; closeCode: number | null; me: {id: string; role: Role} | null; state: RoomState | null; settings: PublicSettings | null; members: Member[]; chat: ChatMessage[]; source: Source | null; blocked: boolean; mismatch: {expected: number; actual: number} | null; toast: string | null; sync: SyncClient; send(m: ClientMessage): void; clearBlocked(): void; dismissToast(): void }`
  - `<Members members meId actions? />`, `<Chat ... />`, `colorFor(id: string): string`, `fmt(seconds: number): string`, `formatSize(bytes: number): string`.
  - `e2e/harness.ts`: an in-memory server for local development and Playwright; it is never used in production.

- [ ] **Step 1: Create the local harness (also used by Task 21)**

`e2e/package.json`:
```json
{
  "name": "@unison/e2e",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "harness": "tsx harness.ts",
    "test:e2e": "playwright test"
  },
  "devDependencies": {
    "@playwright/test": "^1.47.0",
    "jose": "^5.9.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```
`e2e/harness.ts`:
```ts
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
```
Run: `npm install`

- [ ] **Step 2: Add helpers**

`client/src/lib/colors.ts`:
```ts
const COLORS = ['var(--violet)', 'var(--coral)', 'var(--amber)', 'var(--ok)']

/** Stable per-person color from an id. */
export function colorFor(id: string): string {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return COLORS[h % COLORS.length]!
}
```
`client/src/lib/format.ts`:
```ts
export function fmt(seconds: number): string {
  const s = Number.isFinite(seconds) && seconds > 0 ? seconds : 0
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(Math.floor(s % 60)).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

export function formatSize(bytes: number | undefined): string {
  if (!bytes) return ''
  const mb = bytes / 1_048_576
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${Math.round(mb)} MB`
}
```

- [ ] **Step 3: Write `useRoom`** `client/src/room/useRoom.ts`

```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMessage, ClientMessage, ErrorCode, Member, PublicSettings, Role, RoomState, Source } from '@unison/shared'
import { WS_URL } from '../lib/config'
import { getIdentity } from '../lib/identity'
import { RoomSocket, type SocketStatus } from '../net/roomSocket'
import { SyncClient } from '../sync/syncClient'

export interface RoomView {
  status: SocketStatus
  closeCode: number | null
  me: { id: string; role: Role } | null
  state: RoomState | null
  settings: PublicSettings | null
  members: Member[]
  chat: ChatMessage[]
  source: Source | null
  blocked: boolean
  mismatch: { expected: number; actual: number } | null
  toast: string | null
  sync: SyncClient
  send(m: ClientMessage): void
  clearBlocked(): void
  dismissToast(): void
}

function errorText(code: ErrorCode): string | null {
  switch (code) {
    case 'forbidden': return 'You do not have permission to do that.'
    case 'rate_limited': return 'Slow down a little.'
    case 'bad_request': return 'That did not work.'
    case 'stale': return null // the SyncClient silently snaps back
    default: return null
  }
}

export function useRoom(slug: string): RoomView {
  const [status, setStatus] = useState<SocketStatus>('connecting')
  const [closeCode, setCloseCode] = useState<number | null>(null)
  const [me, setMe] = useState<{ id: string; role: Role } | null>(null)
  const [state, setState] = useState<RoomState | null>(null)
  const [settings, setSettings] = useState<PublicSettings | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [chat, setChat] = useState<ChatMessage[]>([])
  const [source, setSource] = useState<Source | null>(null)
  const [blocked, setBlocked] = useState(false)
  const [mismatch, setMismatch] = useState<{ expected: number; actual: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const socketRef = useRef<RoomSocket | null>(null)
  const syncRef = useRef<SyncClient | null>(null)

  if (!syncRef.current) {
    syncRef.current = new SyncClient({
      send: (m) => socketRef.current?.send(m),
      now: Date.now,
      onSource: setSource,
      onBlocked: () => setBlocked(true),
      onMismatch: setMismatch,
      onState: setState,
    })
  }
  const sync = syncRef.current

  useEffect(() => {
    let clockTimer: ReturnType<typeof setInterval> | undefined
    const sock = new RoomSocket({
      url: `${WS_URL}?room=${encodeURIComponent(slug)}`,
      getHello: async () => {
        const id = await getIdentity()
        if (!id) return null
        let password: string | undefined
        try {
          password = sessionStorage.getItem(`unison.pw.${slug}`) ?? undefined
        } catch { /* private mode */ }
        return { type: 'hello', token: id.token, password }
      },
      onStatus: (s, info) => {
        setStatus(s)
        if (info) setCloseCode(info.code)
      },
      onMessage: (m) => {
        sync.handleServer(m)
        switch (m.type) {
          case 'welcome':
            setMe({ id: m.you, role: m.role })
            setSettings(m.settings)
            setMembers(m.members)
            setChat(m.chat)
            sync.startClockSync()
            clearInterval(clockTimer)
            clockTimer = setInterval(() => sync.startClockSync(), 60_000)
            break
          case 'chat':
            setChat((c) => [...c, m.message].slice(-200))
            break
          case 'chatRemoved':
            setChat((c) => c.filter((x) => x.id !== m.id))
            break
          case 'members':
            setMembers(m.members)
            setMe((prev) => {
              const mine = prev && m.members.find((x) => x.id === prev.id)
              return prev && mine && mine.role !== prev.role ? { ...prev, role: mine.role } : prev
            })
            break
          case 'settings':
            setSettings(m.settings)
            break
          case 'error': {
            const text = errorText(m.code)
            if (text) setToast(text)
            break
          }
        }
      },
    })
    socketRef.current = sock
    sock.connect()
    return () => {
      clearInterval(clockTimer)
      sock.close()
    }
  }, [slug, sync])

  const send = useCallback((m: ClientMessage) => socketRef.current?.send(m), [])
  const clearBlocked = useCallback(() => setBlocked(false), [])
  const dismissToast = useCallback(() => setToast(null), [])

  return { status, closeCode, me, state, settings, members, chat, source, blocked, mismatch, toast, sync, send, clearBlocked, dismissToast }
}
```

- [ ] **Step 4: Write the components**

`client/src/components/PlayerStage.tsx`:
```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { Source } from '@unison/shared'
import { fmt, formatSize } from '../lib/format'
import { HtmlVideoAdapter } from '../player/HtmlVideoAdapter'
import type { Player } from '../player/Player'
import { createYouTubeAdapter } from '../player/YouTubeAdapter'
import type { SyncClient } from '../sync/syncClient'

const PLAY = 'M8 5v14l11-7z'
const PAUSE = 'M6 5h4v14H6zM14 5h4v14h-4z'
const FULL = 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z'
const Icon = ({ d }: { d: string }) => (
  <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>
)

interface Props {
  sync: SyncClient
  source: Source | null
  canControl: boolean
  localFile: File | null
  onPickFile(f: File): void
  blocked: boolean
  onUnblock(): void
  onFullscreen(): void
  overlay?: ReactNode
  extraControls?: ReactNode
}

export function PlayerStage(p: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ytRef = useRef<HTMLDivElement>(null)
  const [active, setActive] = useState<Player | null>(null)
  const [time, setTime] = useState(0)
  const [dur, setDur] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [scrub, setScrub] = useState<number | null>(null)
  const { sync, source, localFile } = p
  const sourceKey = JSON.stringify(source)

  // Build the right Player for the room's source, and hand it to the SyncClient.
  useEffect(() => {
    if (!source) return
    let cancelled = false
    let player: Player | null = null
    let objectUrl: string | null = null
    let hls: { destroy(): void } | null = null
    const video = videoRef.current
    const attach = (pl: Player) => {
      if (cancelled) return pl.destroy()
      player = pl
      setActive(pl)
      sync.attachPlayer(pl)
    }
    void (async () => {
      if (source.type === 'youtube') {
        const host = ytRef.current
        if (!host) return
        host.innerHTML = ''
        const el = document.createElement('div')
        host.appendChild(el)
        attach(await createYouTubeAdapter(el, source.id!, p.canControl))
      } else if (source.type === 'file') {
        if (!localFile || !video) return
        objectUrl = URL.createObjectURL(localFile)
        video.src = objectUrl
        attach(new HtmlVideoAdapter(video))
      } else if (source.type === 'url') {
        if (!video) return
        video.src = source.url!
        attach(new HtmlVideoAdapter(video))
      } else if (source.type === 'hls') {
        if (!video) return
        const { default: Hls } = await import('hls.js')
        if (cancelled) return
        if (Hls.isSupported()) {
          const h = new Hls()
          h.loadSource(source.url!)
          h.attachMedia(video)
          hls = h
        } else {
          video.src = source.url! // Safari plays HLS natively
        }
        attach(new HtmlVideoAdapter(video))
      }
    })()
    return () => {
      cancelled = true
      player?.destroy()
      setActive(null)
      hls?.destroy()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
      if (video) {
        video.removeAttribute('src')
        video.load()
      }
    }
    // canControl only affects YouTube's native controls at creation time.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, localFile, sync])

  useEffect(() => {
    if (!active) return
    const id = setInterval(() => {
      setTime(active.getTime())
      const d = active.getDuration()
      setDur(Number.isFinite(d) ? d : 0)
      setPlaying(active.isPlaying())
    }, 250)
    return () => clearInterval(id)
  }, [active])

  function commitScrub() {
    if (scrub !== null && active) {
      active.seek(scrub)
      setScrub(null)
    }
  }

  const isYt = source?.type === 'youtube'
  const needsFile = source?.type === 'file' && !localFile

  return (
    <div className="player">
      {isYt ? <div className="yt" ref={ytRef} /> : <video ref={videoRef} playsInline preload="auto" tabIndex={-1} />}

      {needsFile && source && (
        <div className="overlay">
          <div className="stack" style={{ maxWidth: 360 }}>
            <b>Pick the same file</b>
            <p className="muted">
              The host is playing "{source.name}" ({formatSize(source.size)}). Choose that file from your device. Nothing is uploaded.
            </p>
            <label className="btn primary file-btn">
              Choose file
              <input type="file" accept="video/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) p.onPickFile(f) }} />
            </label>
          </div>
        </div>
      )}

      {p.overlay}

      {p.blocked && !p.overlay && !needsFile && (
        <div className="overlay">
          <button className="btn primary" onClick={p.onUnblock}>Tap to join playback</button>
        </div>
      )}

      {source && active && (
        <div className="controls">
          {p.canControl ? (
            <input
              type="range" min={0} max={dur || 1} step={1} value={scrub ?? time} aria-label="Seek"
              onChange={(e) => setScrub(Number(e.target.value))}
              onPointerUp={commitScrub} onKeyUp={commitScrub} onTouchEnd={commitScrub}
            />
          ) : (
            <div className="bar"><i style={{ width: dur ? `${Math.min(100, (time / dur) * 100)}%` : '0%' }} /></div>
          )}
          <div className="ctl-row">
            {p.canControl && (
              <button className="ctl-btn" aria-label={playing ? 'Pause' : 'Play'} onClick={() => (playing ? active.pause() : active.play())}>
                <Icon d={playing ? PAUSE : PLAY} />
              </button>
            )}
            <span>{fmt(time)} / {fmt(dur)}</span>
            <span style={{ flex: 1 }} />
            {p.extraControls}
            <button className="ctl-btn" aria-label="Fullscreen" onClick={p.onFullscreen}><Icon d={FULL} /></button>
          </div>
        </div>
      )}
    </div>
  )
}
```
`client/src/components/SourcePicker.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import type { Source } from '@unison/shared'
import { parseSourceInput } from '../lib/sourceInput'

function readDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video')
    const url = URL.createObjectURL(file)
    v.preload = 'metadata'
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration) }
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('unreadable')) }
    v.src = url
  })
}

export function SourcePicker({ onSource, onFile }: { onSource(s: Source): void; onFile(f: File): void }) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function submit(e: FormEvent) {
    e.preventDefault()
    const r = parseSourceInput(text)
    if (!r.ok) return setError(r.reason)
    setError(null)
    onSource(r.source)
    setText('')
  }
  async function pick(f: File | undefined) {
    if (!f) return
    setBusy(true)
    setError(null)
    try {
      const duration = await readDuration(f)
      if (!Number.isFinite(duration) || duration <= 0) throw new Error('no duration')
      onFile(f)
      onSource({ type: 'file', name: f.name, size: f.size, duration })
    } catch {
      setError('Could not read that video file.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="stack" style={{ width: '100%' }}>
      <form onSubmit={submit} className="row" style={{ flexWrap: 'nowrap' }}>
        <label htmlFor="src" className="sr-only">Video link</label>
        <input id="src" placeholder="Paste a YouTube or video link" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 0 }} />
        <button className="btn primary">Load</button>
      </form>
      <div className="divider">or</div>
      <label className="btn block file-btn">
        {busy ? 'Reading file...' : 'Choose a video file'}
        <input type="file" accept="video/*" onChange={(e) => void pick(e.target.files?.[0])} />
      </label>
      {error && <p className="err" role="alert">{error}</p>}
    </div>
  )
}
```
`client/src/components/Chat.tsx`:
```tsx
import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChatMessage } from '@unison/shared'
import { colorFor } from '../lib/colors'

interface Props {
  messages: ChatMessage[]
  enabled: boolean
  canModerate: boolean
  open: boolean
  onSend(text: string): void
  onDelete(id: string): void
}

export function Chat({ messages, enabled, canModerate, open, onSend, onDelete }: Props) {
  const [text, setText] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  function submit(e: FormEvent) {
    e.preventDefault()
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  return (
    <section className={open ? 'chat open' : 'chat'} aria-label="Chat">
      <div className="msgs" aria-live="polite">
        {messages.map((m) => (
          <div className="msg" key={m.id}>
            {/* React escapes text; never use dangerouslySetInnerHTML for chat. */}
            <b style={{ color: colorFor(m.from) }}>{m.nickname}</b>
            {m.text}
            {canModerate && (
              <button className="btn ghost msg-del" aria-label={`Delete message from ${m.nickname}`} onClick={() => onDelete(m.id)}>Delete</button>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
      <form className="composer" onSubmit={submit}>
        <input
          aria-label="Message" placeholder={enabled ? 'Say something' : 'Chat is off'} maxLength={500}
          autoComplete="off" enterKeyHint="send" disabled={!enabled} value={text} onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" disabled={!enabled}>Send</button>
      </form>
    </section>
  )
}
```
`client/src/components/Members.tsx`:
```tsx
import type { ReactNode } from 'react'
import type { Member } from '@unison/shared'
import { colorFor } from '../lib/colors'

interface Props {
  members: Member[]
  meId: string | undefined
  actions?: (m: Member) => ReactNode
}

export function Members({ members, meId, actions }: Props) {
  return (
    <>
      {members.map((m) => (
        <div className="member" key={m.id}>
          <span className="who">
            <span className="avatar" style={{ background: colorFor(m.id) }} aria-hidden="true">
              {(Array.from(m.nickname)[0] ?? '?').toUpperCase()}
            </span>
            {m.nickname}{m.id === meId ? ' (you)' : ''}
            {m.role === 'host' && <span className="pill host" style={{ marginLeft: 8 }}>Host</span>}
            {m.role === 'moderator' && <span className="pill host" style={{ marginLeft: 8 }}>Mod</span>}
            {m.role === 'guest' && <span className="pill" style={{ marginLeft: 8 }}>Guest</span>}
            {m.muted && <span className="pill" style={{ marginLeft: 8 }}>Muted</span>}
          </span>
          <span className="row">{m.id !== meId && actions?.(m)}</span>
        </div>
      ))}
    </>
  )
}
```

- [ ] **Step 5: Write the Room page** `client/src/pages/Room.tsx`

```tsx
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import type { Source } from '@unison/shared'
import { Chat } from '../components/Chat'
import { Members } from '../components/Members'
import { PlayerStage } from '../components/PlayerStage'
import { SourcePicker } from '../components/SourcePicker'
import { api } from '../lib/api'
import { fmt } from '../lib/format'
import { getIdentity } from '../lib/identity'
import { useRoom } from '../room/useRoom'

const CLOSED_TEXT: Record<number, string> = {
  4002: 'Your session expired. Join again to continue.',
  4003: 'You were removed from this room.',
  4004: 'You are banned from this room.',
  4005: 'This room was closed.',
  4006: 'Could not join: the room is full, guests are off, the password was wrong, or it no longer exists.',
  4008: 'You were disconnected for sending too many messages.',
}

export default function Room() {
  const { slug = '' } = useParams()
  const [hasIdentity, setHasIdentity] = useState<boolean | null>(null)
  useEffect(() => { void getIdentity().then((i) => setHasIdentity(!!i)) }, [])
  if (hasIdentity === null) return null
  if (!hasIdentity) return <Navigate to={`/join/${slug}`} replace />
  return <RoomView slug={slug} />
}

function RoomView({ slug }: { slug: string }) {
  const room = useRoom(slug)
  const [name, setName] = useState('Room')
  const [sheet, setSheet] = useState(false)
  const [chatOpen, setChatOpen] = useState(false)
  const [picking, setPicking] = useState(false)
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [offset, setOffset] = useState(0)
  const [copied, setCopied] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)

  useEffect(() => { api.roomInfo(slug).then((i) => setName(i.name)).catch(() => {}) }, [slug])
  useEffect(() => {
    if (!room.toast) return
    const t = setTimeout(room.dismissToast, 3500)
    return () => clearTimeout(t)
  }, [room.toast, room.dismissToast])

  if (room.status === 'closed') {
    return (
      <div className="wrap">
        <main className="center">
          <div className="card">
            <h2>Left the room</h2>
            <p className="muted" style={{ marginTop: 6 }}>{CLOSED_TEXT[room.closeCode ?? 0] ?? 'The connection was closed.'}</p>
            <Link className="btn primary block" style={{ marginTop: 16 }} to="/">Back to Unison</Link>
          </div>
        </main>
      </div>
    )
  }

  const role = room.me?.role
  const canControl = role === 'host' || room.settings?.controlMode === 'everyone'
  const chatEnabled = room.settings?.chatEnabled !== false || role === 'host'

  function setSource(source: Source) {
    room.send({ type: 'control', version: room.state?.version ?? 0, action: 'setSource', source })
    setPicking(false)
  }
  async function invite() {
    await navigator.clipboard.writeText(`${window.location.origin}/r/${slug}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  let overlay: ReactNode
  if (!room.me) {
    overlay = <div className="overlay"><p className="muted">Connecting...</p></div>
  } else if (!room.source || picking) {
    overlay = canControl ? (
      <div className="overlay">
        <div className="stack" style={{ width: '100%', maxWidth: 420 }}>
          <h3>Pick something to watch</h3>
          <SourcePicker onSource={setSource} onFile={setLocalFile} />
          {room.source && <button className="link-like" onClick={() => setPicking(false)}>Cancel</button>}
        </div>
      </div>
    ) : (
      <div className="overlay"><p className="muted">Waiting for the host to pick a video...</p></div>
    )
  }

  return (
    <div className="room">
      <header className="room-top">
        <Link to="/" aria-label="Unison home"><img src="/logo-mark.svg" alt="" style={{ height: 38, display: 'block' }} /></Link>
        <strong style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</strong>
        <button className="btn hide-desktop" aria-controls="sheet" onClick={() => setSheet(true)}>
          <svg className="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M16 11a3 3 0 100-6 3 3 0 000 6zM8 11a3 3 0 100-6 3 3 0 000 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-.9.1 1.2.8 1.9 1.9 1.9 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z" /></svg>
          {room.members.length}
        </button>
        {canControl && room.source && <button className="btn" onClick={() => setPicking(true)}>Change video</button>}
        <button className="btn" onClick={() => void invite()}>{copied ? 'Copied' : 'Invite'}</button>
      </header>

      <div className="stage" ref={stageRef}>
        <div className="video-col">
          <PlayerStage
            sync={room.sync}
            source={room.source}
            canControl={canControl}
            localFile={localFile}
            onPickFile={setLocalFile}
            blocked={room.blocked}
            onUnblock={() => { room.clearBlocked(); room.sync.reconcile() }}
            onFullscreen={() => void stageRef.current?.requestFullscreen?.().catch(() => {})}
            overlay={overlay}
            extraControls={
              <button className="ctl-btn show-landscape" aria-label="Toggle chat" onClick={() => setChatOpen((o) => !o)}>Chat</button>
            }
          />

          {room.mismatch && (
            <div className="notice" style={{ margin: 12 }}>
              <b>Your file may be a different version.</b> Host: {fmt(room.mismatch.expected)}, yours: {fmt(room.mismatch.actual)}.
              If the picture is offset, nudge it until it lines up.
              <label htmlFor="offset">Offset: {offset.toFixed(1)}s</label>
              <input
                id="offset" type="range" min={-30} max={30} step={0.5} value={offset}
                onChange={(e) => { const v = Number(e.target.value); setOffset(v); room.sync.setUserOffset(v) }}
              />
            </div>
          )}

          <aside className={sheet ? 'sheet open' : 'sheet'} id="sheet" aria-label="Members">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3>In this room</h3>
              <button className="btn ghost hide-desktop" onClick={() => setSheet(false)}>Done</button>
            </div>
            <Members members={room.members} meId={room.me?.id} />
          </aside>
        </div>

        <Chat
          messages={room.chat}
          enabled={chatEnabled}
          canModerate={false}
          open={chatOpen}
          onSend={(text) => room.send({ type: 'chat', text })}
          onDelete={() => {}}
        />
      </div>

      {room.status === 'reconnecting' && <div className="toast" role="status">Reconnecting...</div>}
      {room.toast && <div className="toast" role="status">{room.toast}</div>}
    </div>
  )
}
```
`canModerate={false}` and `onDelete={() => {}}` are wired for real in Task 20.

Modify `client/src/App.tsx`: add `import Room from './pages/Room'` and, inside `<Routes>`, `<Route path="/r/:slug" element={<Room />} />` (before the `*` route).

Append to `client/src/styles.css` (the global `label` rule from the prototype would otherwise add margin and a muted color to file-picker buttons):
```css
.btn.file-btn{margin:0;color:var(--text);font-size:15px}
```

- [ ] **Step 6: Verify types, build, and click through locally**

Run: `npm run typecheck -w client && npm run build -w client`
Expected: no errors.

Manual check (two terminals):
1. `npm run harness -w e2e` (prints a dev host token).
2. `VITE_E2E=1 VITE_API_URL=http://127.0.0.1:8080 VITE_WS_URL=ws://127.0.0.1:8080/ws npm run dev -w client`, open `http://localhost:5173`, paste the printed `localStorage.setItem(...)` line in the console, open `/dashboard`, create a room, pick a local video file.
3. Open the room link in a second (private) window, join as a guest, pick the same file. Press play on the host: the guest follows. Chat both ways. In the browser device toolbar at 360px: player on top, chat below, Members opens as a bottom sheet.

- [ ] **Step 7: Commit**

```bash
git add client e2e package-lock.json
git commit -m "feat(client): room UI with player stage, chat, members and source picker; local e2e harness"
```

---

### Task 20: Moderation UI, room settings, report

**Files:**
- Create: `client/src/room/permissions.ts`, `client/src/components/{SettingsPanel,ReportDialog}.tsx`
- Modify: `client/src/pages/Room.tsx`, `client/src/styles.css` (append)
- Test: `client/test/permissions.test.ts`

**Interfaces:**
- Consumes: `RoomView` (T19), `api.report` (T13).
- Produces: `availableOps(actor: Role, target: {role: Role; muted: boolean}): ModOp[]`; `canModerateChat(role: Role | undefined): boolean`; `type ModOp = 'kick'|'mute'|'unmute'|'ban'|'promote'|'demote'`. These mirror the server rules only to decide which buttons to show; the server remains the enforcer.

- [ ] **Step 1: Write the failing test** `client/test/permissions.test.ts`

```ts
import { describe, it, expect } from 'vitest'
import { availableOps, canModerateChat } from '../src/room/permissions'

describe('availableOps', () => {
  it('lets the host mute, kick and ban guests but not promote them', () => {
    expect(availableOps('host', { role: 'guest', muted: false })).toEqual(['mute', 'kick', 'ban'])
  })
  it('lets the host promote members and demote moderators', () => {
    expect(availableOps('host', { role: 'member', muted: false })).toEqual(['mute', 'kick', 'ban', 'promote'])
    expect(availableOps('host', { role: 'moderator', muted: false })).toEqual(['mute', 'kick', 'ban', 'demote'])
  })
  it('offers unmute for muted people', () => {
    expect(availableOps('host', { role: 'guest', muted: true })).toEqual(['unmute', 'kick', 'ban'])
  })
  it('lets moderators mute and kick lower roles only', () => {
    expect(availableOps('moderator', { role: 'guest', muted: false })).toEqual(['mute', 'kick'])
    expect(availableOps('moderator', { role: 'member', muted: false })).toEqual(['mute', 'kick'])
    expect(availableOps('moderator', { role: 'moderator', muted: false })).toEqual([])
    expect(availableOps('moderator', { role: 'host', muted: false })).toEqual([])
  })
  it('gives members and guests nothing', () => {
    expect(availableOps('member', { role: 'guest', muted: false })).toEqual([])
    expect(availableOps('guest', { role: 'guest', muted: false })).toEqual([])
  })
})

describe('canModerateChat', () => {
  it('is true for host and moderator only', () => {
    expect(canModerateChat('host')).toBe(true)
    expect(canModerateChat('moderator')).toBe(true)
    expect(canModerateChat('member')).toBe(false)
    expect(canModerateChat(undefined)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -w client -- permissions`
Expected: FAIL.

- [ ] **Step 3: Implement** `client/src/room/permissions.ts`

```ts
import type { Role } from '@unison/shared'

export type ModOp = 'kick' | 'mute' | 'unmute' | 'ban' | 'promote' | 'demote'
const RANK: Record<Role, number> = { guest: 0, member: 0, moderator: 1, host: 2 }

export function availableOps(actor: Role, target: { role: Role; muted: boolean }): ModOp[] {
  if (RANK[actor] <= RANK[target.role]) return []
  const ops: ModOp[] = [target.muted ? 'unmute' : 'mute', 'kick']
  if (actor === 'host') {
    ops.push('ban')
    if (target.role === 'member') ops.push('promote')
    if (target.role === 'moderator') ops.push('demote')
  }
  return ops
}

export function canModerateChat(role: Role | undefined): boolean {
  return role === 'host' || role === 'moderator'
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -w client -- permissions`
Expected: PASS.

- [ ] **Step 5: Add the settings panel and report dialog**

`client/src/components/SettingsPanel.tsx`:
```tsx
import type { PublicSettings, RoomSettings } from '@unison/shared'

interface Props {
  settings: PublicSettings
  onChange(patch: Partial<RoomSettings>): void
  onClose(): void
}

export function SettingsPanel({ settings, onChange, onClose }: Props) {
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Room settings">
      <div className="card">
        <h3>Room settings</h3>
        <div className="toggle" style={{ marginTop: 8 }}>
          <span>Allow guests</span>
          <input type="checkbox" checked={settings.allowGuests} aria-label="Allow guests" onChange={(e) => onChange({ allowGuests: e.target.checked })} />
        </div>
        <div className="toggle">
          <span>Everyone can control playback</span>
          <input type="checkbox" checked={settings.controlMode === 'everyone'} aria-label="Everyone can control playback" onChange={(e) => onChange({ controlMode: e.target.checked ? 'everyone' : 'host' })} />
        </div>
        <div className="toggle">
          <span>Chat on</span>
          <input type="checkbox" checked={settings.chatEnabled} aria-label="Chat on" onChange={(e) => onChange({ chatEnabled: e.target.checked })} />
        </div>
        <div className="toggle">
          <span>Pause for everyone when someone buffers</span>
          <input type="checkbox" checked={settings.pauseOnBuffering} aria-label="Pause when someone buffers" onChange={(e) => onChange({ pauseOnBuffering: e.target.checked })} />
        </div>
        <label htmlFor="cap">Max viewers</label>
        <select id="cap" value={settings.maxViewers} onChange={(e) => onChange({ maxViewers: Number(e.target.value) })}>
          {[5, 10, 15, 20, 30].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <button className="btn primary block" style={{ marginTop: 16 }} onClick={onClose}>Done</button>
      </div>
    </div>
  )
}
```
`client/src/components/ReportDialog.tsx`:
```tsx
import { useState, type FormEvent } from 'react'
import { api } from '../lib/api'
import { getAccessToken } from '../lib/identity'

export function ReportDialog({ slug, onClose }: { slug: string; onClose(): void }) {
  const [reason, setReason] = useState('')
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')

  async function submit(e: FormEvent) {
    e.preventDefault()
    setState('sending')
    try {
      await api.report(slug, reason.trim(), await getAccessToken())
      setState('sent')
    } catch {
      setState('error')
    }
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Report this room">
      <form className="card" onSubmit={submit}>
        <h3>Report this room</h3>
        {state === 'sent' ? (
          <>
            <p className="notice" style={{ marginTop: 12 }}>Thanks. We will review it.</p>
            <button type="button" className="btn primary block" style={{ marginTop: 16 }} onClick={onClose}>Close</button>
          </>
        ) : (
          <>
            <label htmlFor="reason">What is wrong?</label>
            <input id="reason" maxLength={500} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Copyright, harassment, spam..." />
            {state === 'error' && <p className="err" role="alert">Could not send. Try again in a minute.</p>}
            <div className="row" style={{ marginTop: 16 }}>
              <button className="btn primary" disabled={state === 'sending'}>Send report</button>
              <button type="button" className="btn ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </form>
    </div>
  )
}
```
Append to `client/src/styles.css`:
```css
.modal{position:fixed;inset:0;background:rgba(15,11,30,.85);display:grid;place-items:center;z-index:20;padding:16px}
.modal .card{width:100%;max-width:420px;max-height:90dvh;overflow:auto}
```

- [ ] **Step 6: Wire moderation into the room page**

In `client/src/pages/Room.tsx`:

1. Add imports:
```tsx
import { ReportDialog } from '../components/ReportDialog'
import { SettingsPanel } from '../components/SettingsPanel'
import { availableOps, canModerateChat, type ModOp } from '../room/permissions'
```
2. Add state next to the other `useState` calls:
```tsx
const [settingsOpen, setSettingsOpen] = useState(false)
const [reportOpen, setReportOpen] = useState(false)
```
3. Add the op labels and handler inside `RoomView` (after `canControl` is computed):
```tsx
const OP_LABEL: Record<ModOp, string> = { kick: 'Kick', mute: 'Mute', unmute: 'Unmute', ban: 'Ban', promote: 'Make mod', demote: 'Remove mod' }
function runOp(op: ModOp, target: { id: string; nickname: string }) {
  if (op === 'ban' && !window.confirm(`Ban ${target.nickname} from this room?`)) return
  room.send({ type: 'mod', op, target: target.id })
}
```
4. Replace `<Members members={room.members} meId={room.me?.id} />` with:
```tsx
<Members
  members={room.members}
  meId={room.me?.id}
  actions={(m) =>
    role
      ? availableOps(role, m).map((op) => (
          <button key={op} className={op === 'kick' || op === 'ban' ? 'btn danger' : 'btn'} onClick={() => runOp(op, m)}>
            {OP_LABEL[op]}
          </button>
        ))
      : null
  }
/>
<div className="row" style={{ marginTop: 8 }}>
  {role === 'host' && <button className="btn" onClick={() => setSettingsOpen(true)}>Room settings</button>}
  <button className="link-like" onClick={() => setReportOpen(true)}>Report this room</button>
</div>
```
5. In `<Chat ... />` replace `canModerate={false}` with `canModerate={canModerateChat(role)}` and `onDelete={() => {}}` with `onDelete={(id) => room.send({ type: 'mod', op: 'deleteMessage', target: id })}`.
6. Before the closing `</div>` of `.room`, add:
```tsx
{settingsOpen && room.settings && (
  <SettingsPanel settings={room.settings} onChange={(patch) => room.send({ type: 'settings', patch })} onClose={() => setSettingsOpen(false)} />
)}
{reportOpen && <ReportDialog slug={slug} onClose={() => setReportOpen(false)} />}
```

- [ ] **Step 7: Verify**

Run: `npm test -w client && npm run typecheck -w client && npm run build -w client`
Expected: PASS and no errors.
Manual (harness from Task 19): as host, mute, unmute, kick, ban a guest (the guest's screen shows the removal message with the right text and cannot rejoin); promote a signed-in second user (use a second `e2e-token` for a different user in another profile) and confirm they can delete chat lines but cannot ban; toggle "Allow guests" and confirm a new guest is refused; send a report and confirm a `202`.

- [ ] **Step 8: Commit**

```bash
git add client
git commit -m "feat(client): moderation controls, room settings, report dialog"
```

---

### Task 21: PWA, end-to-end tests, and load check

**Files:**
- Create: `client/public/{manifest.webmanifest,icon.svg,_redirects}` (+ generated `icon-192.png`, `icon-512.png`, `apple-touch-icon.png`), `e2e/{playwright.config.ts,tsconfig.json}`, `e2e/scripts/make-icons.mjs`, `e2e/tests/watch-together.spec.ts`, `e2e/fixtures/clip.webm`, `server/scripts/load.ts`

**Interfaces:**
- Consumes: the harness (T19), all UI (T13, T19, T20), `buildServer` (T12).

- [ ] **Step 1: PWA files**

`client/public/manifest.webmanifest`:
```json
{
  "name": "Unison",
  "short_name": "Unison",
  "description": "Watch videos together, in sync.",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "background_color": "#0F0B1E",
  "theme_color": "#0F0B1E",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```
`client/public/icon.svg` (flat, full-bleed background, mark inside the maskable safe zone):
```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#0F0B1E"/>
  <g transform="translate(96 96) scale(5)">
    <defs><clipPath id="a"><circle cx="24" cy="32" r="18"/></clipPath></defs>
    <circle cx="24" cy="32" r="18" fill="#7C6CFF"/>
    <circle cx="40" cy="32" r="18" fill="#FF7A59"/>
    <circle cx="40" cy="32" r="18" fill="#FFC857" clip-path="url(#a)"/>
    <path d="M29 24.5v15l11-7.5z" fill="#1B1533" stroke="#1B1533" stroke-width="2" stroke-linejoin="round"/>
  </g>
</svg>
```
`client/public/_redirects` (Cloudflare Pages SPA fallback):
```
/*    /index.html   200
```
No service worker is needed: the spec requires installability, not offline support.

- [ ] **Step 2: E2E scaffolding**

`e2e/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "types": ["node"] }, "include": ["*.ts", "tests", "scripts"] }
```
`e2e/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './tests',
  timeout: 60_000,
  workers: 1,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure' },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
  webServer: [
    { command: 'npx tsx harness.ts', cwd: '.', port: 8080, reuseExistingServer: !process.env.CI, env: { PORT: '8080' } },
    {
      command: 'npm run build -w client && npm run preview -w client -- --port 4173 --host 127.0.0.1',
      cwd: '..',
      port: 4173,
      timeout: 180_000,
      reuseExistingServer: !process.env.CI,
      env: { VITE_E2E: '1', VITE_API_URL: 'http://127.0.0.1:8080', VITE_WS_URL: 'ws://127.0.0.1:8080/ws' },
    },
  ],
})
```
`e2e/scripts/make-icons.mjs` (renders the SVG to PNGs with Chromium, so no extra image tooling is needed):
```js
import { chromium } from '@playwright/test'
import { readFileSync, writeFileSync } from 'node:fs'

const svg = readFileSync('../client/public/icon.svg', 'utf8')
const browser = await chromium.launch()
for (const [name, size] of [['icon-192', 192], ['icon-512', 512], ['apple-touch-icon', 180]]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } })
  await page.setContent(`<style>html,body{margin:0}svg{width:${size}px;height:${size}px;display:block}</style>${svg}`)
  writeFileSync(`../client/public/${name}.png`, await page.screenshot())
  await page.close()
}
await browser.close()
```
Run:
```bash
cd e2e && npx playwright install chromium && node scripts/make-icons.mjs && cd ..
mkdir -p e2e/fixtures
curl -L -o e2e/fixtures/clip.webm https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.webm
ls -l client/public/*.png e2e/fixtures/clip.webm
```
Expected: three PNGs and a non-empty `clip.webm` (CC0 sample clip). WebM is used because Playwright's bundled Chromium has no H.264. Open `client/public/icon-512.png` and check the mark is centered on the dark background.

- [ ] **Step 3: Write the E2E test** `e2e/tests/watch-together.spec.ts`

```ts
import { test, expect, type Page } from '@playwright/test'
import { SignJWT } from 'jose'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const JWT_SECRET = 'e2e-jwt-secret-0123456789abcdef'
const OWNER = '00000000-0000-4000-8000-0000000000aa'
const clip = path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/clip.webm')
const hostToken = () =>
  new SignJWT({ user_metadata: { full_name: 'Maya' } }).setProtectedHeader({ alg: 'HS256' }).setSubject(OWNER)
    .setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(JWT_SECRET))

const videoTime = (p: Page) => p.evaluate(() => document.querySelector('video')!.currentTime)
const videoPlaying = (p: Page) => p.evaluate(() => !document.querySelector('video')!.paused)

/** Autoplay policy may ask for one tap; do it if the overlay shows. */
async function tapIfBlocked(p: Page) {
  const tap = p.getByRole('button', { name: 'Tap to join playback' })
  if (await tap.isVisible().catch(() => false)) await tap.click()
}

// The host always uses a desktop context; the `page` fixture (guest) takes the project's device, so the
// mobile project puts the guest on a phone.
async function startRoom(browser: import('@playwright/test').Browser) {
  const hostCtx = await browser.newContext()
  const host = await hostCtx.newPage()
  const token = await hostToken()
  await host.addInitScript((t) => localStorage.setItem('e2e-token', t), token)
  await host.goto('/dashboard')
  await host.getByLabel('Room name').fill('E2E night')
  await host.getByRole('button', { name: 'Create room' }).click()
  await host.waitForURL(/\/r\/.+/)
  const slug = new URL(host.url()).pathname.split('/').pop()!
  await host.locator('input[type=file]').setInputFiles(clip)
  await expect(host.getByRole('button', { name: 'Play' })).toBeVisible()
  return { host, slug, hostCtx }
}

async function joinAsGuest(guest: Page, slug: string, nickname: string) {
  await guest.goto(`/join/${slug}`)
  await guest.getByLabel('Pick a nickname').fill(nickname)
  await guest.getByRole('button', { name: 'Join room' }).click()
  await guest.waitForURL(/\/r\/.+/)
  await guest.locator('input[type=file]').setInputFiles(clip)
  await expect(guest.locator('video')).toBeVisible()
}

test('host and guest stay in sync, and chat works both ways', async ({ browser, page: guest }) => {
  const { host, slug, hostCtx } = await startRoom(browser)
  await joinAsGuest(guest, slug, 'PopcornPat')

  await host.getByRole('button', { name: 'Play' }).click()
  await guest.waitForTimeout(800)
  await tapIfBlocked(guest)
  await expect.poll(() => videoPlaying(guest), { timeout: 8000 }).toBe(true)

  await guest.waitForTimeout(1500)
  expect(Math.abs((await videoTime(host)) - (await videoTime(guest)))).toBeLessThan(0.8)

  // host seeks with the keyboard (three steps forward); guest follows
  const seek = host.getByLabel('Seek')
  await seek.focus()
  for (let i = 0; i < 3; i++) await host.keyboard.press('ArrowRight')
  await guest.waitForTimeout(1500)
  expect(Math.abs((await videoTime(host)) - (await videoTime(guest)))).toBeLessThan(0.8)

  await host.getByLabel('Message').fill('hello from host')
  await host.keyboard.press('Enter')
  await expect(guest.getByText('hello from host')).toBeVisible()
  await guest.getByLabel('Message').fill('hi host')
  await guest.keyboard.press('Enter')
  await expect(host.getByText('hi host')).toBeVisible()

  await hostCtx.close()
})

test('a guest cannot control playback in host-only mode, and a banned guest is removed', async ({ browser, page: guest }) => {
  const { host, slug, hostCtx } = await startRoom(browser)
  await joinAsGuest(guest, slug, 'Sam')
  await expect(guest.getByRole('button', { name: 'Play' })).toHaveCount(0) // no play control for guests

  host.once('dialog', (d) => void d.accept()) // the Ban button asks for confirmation
  await host.getByRole('button', { name: 'Ban' }).click() // desktop: the members list is a side panel, Sam is the only other member
  await expect(guest.getByText('You are banned from this room.')).toBeVisible()
  await hostCtx.close()
})

test('mobile layout: player above chat, no horizontal scroll, 44px touch targets', async ({ browser, page: guest }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone-only assertions')
  const { slug, hostCtx } = await startRoom(browser)
  await joinAsGuest(guest, slug, 'Phone')

  const boxes = await guest.evaluate(() => {
    const r = (s: string) => document.querySelector(s)!.getBoundingClientRect()
    return { player: r('.player'), chat: r('.chat'), vw: window.innerWidth, scrollW: document.documentElement.scrollWidth }
  })
  expect(boxes.player.top).toBeLessThan(boxes.chat.top)
  expect(Math.round(boxes.player.width)).toBe(boxes.vw)
  expect(boxes.scrollW).toBeLessThanOrEqual(boxes.vw)

  const tooSmall = await guest.evaluate(() =>
    [...document.querySelectorAll('.btn, .ctl-btn')]
      .filter((el) => (el as HTMLElement).offsetParent !== null)
      .map((el) => ({ text: el.textContent?.trim() ?? el.getAttribute('aria-label'), h: el.getBoundingClientRect().height }))
      .filter((b) => b.h < 43.5),
  )
  expect(tooSmall).toEqual([])
  await hostCtx.close()
})
```
- [ ] **Step 4: Run the E2E suite**

Run: `npm run test:e2e -w e2e`
Expected: PASS on `desktop` and `mobile` (the phone-only test is skipped on desktop). On failure, run `npx playwright show-trace` from `e2e/test-results`. Likely causes: autoplay blocked (the `tapIfBlocked` helper covers one prompt), or the fixture download failed (check `ls -l e2e/fixtures/clip.webm`).

- [ ] **Step 5: Write the load check** `server/scripts/load.ts`

```ts
// ~300 sockets over 20 rooms against an in-memory server. Run: npx tsx server/scripts/load.ts
import { randomUUID } from 'node:crypto'
import type { AddressInfo } from 'node:net'
import WebSocket from 'ws'
import { createAuth } from '../src/auth'
import { createMemoryStores } from '../src/memoryStores'
import { buildServer } from '../src/server'

const ROOMS = 20
const PER_ROOM = 15
const auth = createAuth({ guestSecret: 'load-guest-secret-0123456789abcdef', supabaseJwtSecret: 'load-jwt-secret-0123456789abcdef' })
const stores = createMemoryStores()
const { app, manager } = await buildServer({
  auth, stores, clientOrigin: '*', ipSecret: 'load-ip-secret-0123456789abcdef', trustProxy: false,
  maxRooms: 100, maxSockets: 1000, maxPerIp: 10_000,
})
await app.listen({ port: 0, host: '127.0.0.1' })
const port = (app.server.address() as AddressInfo).port

for (let r = 0; r < ROOMS; r++) {
  await stores.rooms.create({
    id: randomUUID(), slug: `load-${r}`, ownerId: randomUUID(), ownerName: 'Load', name: `Load ${r}`,
    settings: { controlMode: 'everyone', allowGuests: true, maxViewers: PER_ROOM, chatEnabled: true, pauseOnBuffering: true },
    passwordHash: null, createdAt: Date.now(), closedAt: null,
  })
}

interface Client { ws: WebSocket; room: number; playedAt?: number }
const now = () => performance.now()

function connect(room: number): Promise<Client> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?room=load-${room}`)
    const c: Client = { ws, room }
    const timer = setTimeout(() => reject(new Error(`join timeout in room ${room}`)), 15_000)
    ws.on('open', async () => ws.send(JSON.stringify({ type: 'hello', token: await auth.issueGuest('g', randomUUID()) })))
    ws.on('message', (d) => {
      const m = JSON.parse(d.toString())
      if (m.type === 'welcome') { clearTimeout(timer); resolve(c) }
      if (m.type === 'state' && m.state.isPlaying && c.playedAt === undefined) c.playedAt = now()
    })
    ws.on('error', reject)
  })
}
const p95 = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)] ?? 0

const joinStart = now()
const clients = await Promise.all(Array.from({ length: ROOMS * PER_ROOM }, (_, n) => connect(Math.floor(n / PER_ROOM))))
const joinMs = now() - joinStart

const sentAt: number[] = []
for (let r = 0; r < ROOMS; r++) {
  const controller = clients.find((c) => c.room === r)!
  sentAt[r] = now()
  controller.ws.send(JSON.stringify({ type: 'control', version: 0, action: 'setSource', source: { type: 'file', name: 'a.mp4', size: 1, duration: 600 } }))
  controller.ws.send(JSON.stringify({ type: 'control', version: 1, action: 'play', position: 0 }))
}
await new Promise((r) => setTimeout(r, 3000))

const latencies = clients.filter((c) => c.playedAt !== undefined).map((c) => c.playedAt! - sentAt[c.room]!)
const stats = manager.stats()
console.log({ sockets: clients.length, joinMsTotal: Math.round(joinMs), fanOutReceived: latencies.length, fanOutP95Ms: Math.round(p95(latencies)), stats, rssMB: Math.round(process.memoryUsage().rss / 1e6) })

clients.forEach((c) => c.ws.close())
await app.close()
const ok = clients.length === ROOMS * PER_ROOM && latencies.length === clients.length && stats.sockets === clients.length
console.log(ok ? 'LOAD CHECK PASSED' : 'LOAD CHECK FAILED')
process.exit(ok ? 0 : 1)
```

- [ ] **Step 6: Run the load check**

Run: `npx tsx server/scripts/load.ts`
Expected: `LOAD CHECK PASSED`, 300 sockets, every client received the play state, fan-out p95 well under 500 ms, RSS under a few hundred MB.

- [ ] **Step 7: Commit**

```bash
git add client e2e server package-lock.json
git commit -m "feat: PWA manifest and icons, Playwright e2e (desktop and mobile), load check"
```

---

### Task 22: Deployment config and launch docs

**Files:**
- Create: `Dockerfile`, `.dockerignore`, `fly.toml`, `README.md`

- [ ] **Step 1: Write the server container files**

`.dockerignore` (the Dockerfile needs the client and e2e `package.json` files so npm can resolve all workspaces, but nothing else from them):
```
node_modules
**/node_modules
client/*
!client/package.json
e2e/*
!e2e/package.json
docs
.git
**/.env
```
`Dockerfile`:
```dockerfile
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json tsconfig.base.json ./
COPY shared/package.json shared/
COPY server/package.json server/
# npm resolves every workspace listed in the root package.json, so the client and e2e manifests must exist.
COPY client/package.json client/
COPY e2e/package.json e2e/
RUN npm ci --workspace=server --workspace=shared --include-workspace-root

COPY shared shared
COPY server/src server/src
COPY server/tsconfig.json server/

EXPOSE 8080
CMD ["npx", "tsx", "server/src/index.ts"]
```
`fly.toml`:
```toml
app = "unison-server"
primary_region = "iad"

[build]

[env]
  PORT = "8080"
  TRUST_PROXY = "true"
  CLIENT_ORIGIN = "https://YOUR-CLIENT-DOMAIN"

# Rooms live in memory: run exactly ONE machine. Scaling out needs the Redis work listed out of scope in the spec.
[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = "off"
  auto_start_machines = false
  min_machines_running = 1

  [[http_service.checks]]
    grace_period = "10s"
    interval = "15s"
    method = "GET"
    path = "/health"
    timeout = "3s"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

- [ ] **Step 2: Verify the image builds and runs**

Run (needs Docker; skip and note it if Docker is unavailable):
```bash
docker build -t unison-server .
docker run --rm -p 8080:8080 --env-file server/.env unison-server
```
Expected: `unison server listening on :8080`, and `curl localhost:8080/health` returns `{"ok":true}`. `server/.env` must hold real (or throwaway) Supabase values.

- [ ] **Step 3: Write `README.md`**

````markdown
# Unison

Free, mobile-first watch parties. Everyone plays their own copy of the video; Unison keeps it in sync and gives you a live chat. No video is relayed through the server, so it costs almost nothing to run.

- Spec: `docs/superpowers/specs/2026-09-29-unison-design.md`
- Plan: `docs/superpowers/plans/2026-09-29-unison-implementation.md`
- Design prototype: `docs/design/prototype/`

## Layout

| Folder | What |
|---|---|
| `shared/` | Protocol types and zod schemas, sync math, input validation |
| `server/` | Fastify REST API and WebSocket gateway; rooms live in memory |
| `client/` | React + Vite app (mobile-first) |
| `e2e/` | Playwright tests and an in-memory dev harness |

## Develop

Requires Node 20 or newer.

```bash
npm install
npm test                # shared, server and client unit tests
npm run typecheck
```

### Quick local run (no Supabase needed)

```bash
npm run harness -w e2e                      # terminal 1: in-memory server on :8080, prints a dev host token
VITE_E2E=1 VITE_API_URL=http://127.0.0.1:8080 VITE_WS_URL=ws://127.0.0.1:8080/ws npm run dev -w client   # terminal 2
```
Open http://localhost:5173 and paste the printed `localStorage.setItem('e2e-token', ...)` line into the browser console.

### Real run (Supabase)

1. Create a Supabase project. In the SQL editor run `server/supabase/migrations/0001_init.sql`.
2. Auth > Providers: enable Google and Discord (add the OAuth client IDs). Auth > URL configuration: add your client URL and `http://localhost:5173` as redirect URLs. Email magic links work out of the box.
3. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`, then fill them in. `SUPABASE_JWT_SECRET` (legacy projects) or `SUPABASE_JWKS_URL` (newer projects) is how the server verifies sign-ins. Never put the service role key in the client.
4. `npm run dev -w server` and `npm run dev -w client`.
5. Optional database check: `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test -w server -- supabaseStores` against a throwaway project.

## Test

```bash
npm test                                   # unit and integration
npm run test:e2e -w e2e                    # Playwright: desktop and mobile (Pixel 7)
npx tsx server/scripts/load.ts             # ~300 sockets over 20 rooms
```

## Deploy

**Server (Fly.io):** rooms are in memory, so run exactly one machine.
```bash
fly launch --no-deploy --copy-config
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... SUPABASE_JWT_SECRET=... \
  GUEST_TOKEN_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  IP_HASH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly deploy
fly scale count 1
```
Set `CLIENT_ORIGIN` in `fly.toml` to your client URL.

**Client (Cloudflare Pages or Vercel):** build command `npm ci && npm run build -w client`, output `client/dist`, env `VITE_API_URL`, `VITE_WS_URL` (`wss://...`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `client/public/_redirects` handles SPA routing on Cloudflare Pages. Do **not** set `VITE_E2E`.

## Launch checklist

Before inviting anyone:
- [ ] Replace `takedown@unison.example` in `client/src/pages/Terms.tsx` with a real, monitored address.
- [ ] `curl https://YOUR-SERVER/health` returns `{"ok":true}`; `/stats` shows `{rooms, sockets}`.
- [ ] Manual pass: YouTube in Chrome, Firefox and Safari; iOS Safari autoplay ("Tap to join playback"); a local-file duration mismatch shows the warning and offset slider; Wi-Fi off and on reconnects; the host closing the tab keeps chat working; phone layouts in portrait, landscape and fullscreen.
- [ ] Ban, kick, mute, guests-off, viewer cap and password each verified once against production.
- [ ] Spending cap set on every paid tier (Fly, Supabase). Alert when `/stats` sockets pass 70% of `MAX_SOCKETS` (default 500).

Soft launch: invite-only for about a week. Watch for sync complaints, the reconnect rate, rate-limit hits, and `reports` rows in Supabase. Rollback is `fly deploy` of the previous image; live rooms drop and clients reconnect on their own.

## Not built yet (see the spec's out-of-scope list)

Screen share (LiveKit), voice chat, permanent chat history, friend lists, playlists, reactions, native apps, multi-server scaling, and a streaming-service browser extension.
````

- [ ] **Step 4: Full verification**

Run: `npm test && npm run typecheck && npm run build -w client`
Expected: everything passes.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore fly.toml README.md
git commit -m "chore: Dockerfile, Fly config, README and launch checklist"
```

---

## Spec coverage

| Spec section | Task(s) |
|---|---|
| 3.1 Mobile-first (360px, 44px targets, `100dvh`, safe areas, PWA, tap-to-join, landscape chat overlay) | 13 (CSS), 19 (layout, overlay), 21 (manifest, icons, mobile E2E assertions) |
| 3.2 Host sign-in, rooms, guests, sync, chat, roles, moderation, settings, YouTube and file sources | 7, 8, 9, 11, 12, 13, 19, 20 |
| 4 Architecture (RoomManager, SyncEngine, ChatService, ModerationService, adapters, SyncClient) | 5, 6, 9, 10, 14, 15, 18 (moderation is inside `Room`) |
| 5 Player interface and adapters | 14, 18 (superset noted in clarification 1) |
| 6 Sync protocol (state, messages, host-only control, ordering, clock offset, drift, loop prevention, buffering, mismatch, reconnect) | 1, 2, 5, 9, 15, 16 |
| 7 Moderation and limits (roles, settings, kick/mute/ban/report, all rate limits, content safety, privacy) | 3, 4, 6, 7, 9, 11, 12 |
| 8 Testing (unit, integration, sync simulation, contract, E2E incl. mobile, manual checklist, load) | every task's tests; 14 and 18 (contract); 21 (E2E, load); 22 (manual checklist in README) |
| 9 Build order | Tasks follow it: skeleton, room and sync, drift and clocks, chat, adapters, moderation, hardening |
| 10 Launch (metrics, alerts, rollback) | 12 (`/health`, `/stats`), 22 |
| 11 Brand and UI (flat color, palette, fonts, icons) | 13, 19, 20 |
| 12 Open questions | Domain name is left to the launch checklist; Fly.io is used as the default host |
