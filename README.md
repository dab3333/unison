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
