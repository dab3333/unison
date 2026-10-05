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

Requires Node 22 or newer (the Supabase client needs a native WebSocket).

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
3. Copy `server/.env.example` to `server/.env` and `client/.env.example` to `client/.env`, then fill them in. `SUPABASE_JWT_SECRET` (legacy projects) or `SUPABASE_JWKS_URL` (newer projects) is how the server verifies sign-ins; leave the other one empty (empty values count as unset). Never put the service role key in the client.
4. `npm run dev -w server` and `npm run dev -w client`. The server loads `server/.env` itself when the file exists; variables already set in the environment win.
5. **Launch-blocking database check (not optional):** against a real, throwaway Supabase project, run the migration, then `SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm test -w server -- supabaseStores`. The suite is skipped without those variables, so a green `npm test` proves nothing about Postgres. On the real project also verify that Google, Discord and magic-link redirects land back on the client, that the sign-up trigger creates a `profiles` row, and that sign-ins verify with the method you configured (`SUPABASE_JWKS_URL` for asymmetric keys, `SUPABASE_JWT_SECRET` for legacy HS256). Do all of this before inviting anyone.

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
# Now, before the first deploy: set CLIENT_ORIGIN in fly.toml to your client URL (CORS refuses every other origin).
# Set SUPABASE_JWKS_URL (newer projects) or SUPABASE_JWT_SECRET (legacy HS256 projects); drop the one you do not use.
fly secrets set SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
  SUPABASE_JWKS_URL=https://YOUR-PROJECT.supabase.co/auth/v1/.well-known/jwks.json SUPABASE_JWT_SECRET=... \
  GUEST_TOKEN_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  IP_HASH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
fly deploy
fly scale count 1
```

**Client (Cloudflare Pages or Vercel):** build command `npm ci && npm run build -w client`, output `client/dist`, env `VITE_API_URL`, `VITE_WS_URL` (`wss://...`), `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`. `client/public/_redirects` handles SPA routing on Cloudflare Pages. Do **not** set `VITE_E2E`. The `client/dist` left behind by `npm run test:e2e` is built with `VITE_E2E=1` (dev-token sign-in) and must never be deployed; always build for production from a clean environment.

## Launch checklist

Before inviting anyone:
- [x] Takedown contact: `client/src/pages/Terms.tsx` points at the repo's GitHub Issues page (public). Watch it, and switch to a dedicated mailbox if takedown volume or privacy needs grow.
- [ ] Launch-blocking: the live-database check from "Real run" step 5 passed against a real Supabase project (migration, `supabaseStores` suite, OAuth redirects, sign-up trigger, JWKS or HS256 verification).
- [ ] `curl https://YOUR-SERVER/health` returns `{"ok":true}`; `/stats` shows `rooms`, `sockets` and the counters `joins`, `rateLimited`, `reports`, `kicks`, `bans`, `reconnectsReplaced` (monotonic since the last restart).
- [ ] Manual pass: YouTube in Chrome, Firefox and Safari; iOS Safari autoplay ("Tap to join playback"); a local-file duration mismatch shows the warning and offset slider; Wi-Fi off and on reconnects; the host closing the tab keeps chat working; phone layouts in portrait, landscape and fullscreen.
- [ ] Ban, kick, mute, guests-off, viewer cap and password each verified once against production.
- [ ] Spending cap set on every paid tier (Fly, Supabase). Alert when `/stats` sockets pass 70% of `MAX_SOCKETS` (default 500).

Soft launch: invite-only for about a week. Watch for sync complaints, the reconnect rate, rate-limit hits, and `reports` rows in Supabase. Rollback is `fly deploy` of the previous image; live rooms drop and clients reconnect on their own.

## Not built yet (see the spec's out-of-scope list)

Screen share (LiveKit), voice chat, permanent chat history, friend lists, playlists, reactions, native apps, multi-server scaling, and a streaming-service browser extension.
