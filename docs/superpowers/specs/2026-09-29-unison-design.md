# Unison — Design Spec

Date: 2026-09-29
Status: Draft for review

## 1. Summary

Unison is a free web app for watching video together in a room with live chat. Target scale: under 1,000 users at launch. Each viewer plays their own copy of the video; the server relays only small control messages (play, pause, seek), so there is no video bandwidth cost.

## 2. Decisions

| Area | Decision |
|---|---|
| Core mode | Synced playback (no video relayed through the server) |
| Sources | Common `Player` interface. Order: YouTube + local file, then direct URL + HLS, then screen share (LiveKit) as a separate later mode. A streaming-service extension is out of scope |
| Accounts | Required only to host a room. Guests join with a nickname |
| Auth | Supabase Auth: Google, Discord, email magic link. No passwords |
| Realtime | Small Node WebSocket server with authoritative room state |
| Data | Supabase Postgres: profiles, rooms, bans, reports |
| Hosting | Client on Cloudflare Pages or Vercel; server on a small Fly.io/VPS instance; Supabase free tier |
| Platform | Responsive web, **mobile-first** (see 3.1). No native apps |
| Name | Unison |

## 3. Requirements

### 3.1 Mobile-first responsive web

There is no native app, but the site must work well on phones from day one.

- Design and build layouts for a ~360px viewport first, then scale up to tablet and desktop.
- Touch targets at least 44x44 px. No hover-only interactions.
- Room screen on phones: player on top (16:9, pinned), chat below, members and host controls in a bottom sheet. In landscape or fullscreen, chat becomes a slide-over overlay.
- Mobile autoplay: a blocked client shows a "Tap to join playback" overlay, then syncs.
- Respect safe-area insets (notches, home indicator) and use `100dvh`, not `100vh`.
- Local-file source works on mobile through the file picker.
- Installable as a PWA (manifest and icons) so it can sit on a home screen. Offline support is not needed.
- Test targets: iOS Safari, Chrome on Android, plus desktop Chrome, Firefox, and Safari.

### 3.2 Functional scope (in)

Host sign-in; room creation with a shareable link; guest join by nickname; synced play, pause, and seek; live chat; roles (host, moderator, member, guest); kick, mute, ban, report; room settings; YouTube and local-file sources.

### 3.3 Out of scope (YAGNI)

Screen share, voice chat, permanent chat history, friend lists, playlists and queues, reactions and emotes, native mobile apps, multi-server scaling (Redis), and the streaming-service browser extension.

## 4. Architecture

```
Browser (React + Vite)              Node server (ws/Socket.IO)         Supabase
+---------------------+   HTTPS    +------------------------+        +--------------+
| UI: room, chat, lib |----------->| REST: create room      |--JWT-->| Auth         |
| SyncClient          |            | RoomManager (in-memory)|        | Postgres:    |
| Player + adapters   |<--WS------>| SyncEngine, ChatService|------->| profiles,    |
+---------------------+            | ModerationService      |        | rooms, bans, |
                                   +------------------------+        | reports      |
                                                                     +--------------+
```

Units:

- **Player adapters (client):** wrap YouTube and `<video>` (and later sources) behind the `Player` interface. They know nothing about the network.
- **SyncClient (client):** turns player events into messages and applies server state to the player. Handles drift correction, loop prevention, clock offset.
- **RoomManager (server):** live rooms in memory (state, members, roles). Creates on first connect, drops when empty.
- **SyncEngine (server):** authoritative playback state. Accepts control events only from allowed roles and broadcasts the new state.
- **ChatService (server):** validates, rate-limits, broadcasts. Keeps the last ~100 messages for late joiners.
- **ModerationService (server):** kick, ban, mute, guest toggle, viewer cap. Bans persist in Postgres.

Connect flow: host signs in via Supabase and calls `POST /rooms`, which inserts a row and returns a slug. Anyone opens `/r/<slug>`. Signed-in users send their JWT; guests send a nickname and get a signed guest token. The WebSocket handshake verifies the token, checks bans and the room cap, then sends current state and recent chat.

Persisted: profiles, rooms, bans, reports. Not persisted: playback state and chat (a server restart drops live rooms; clients reconnect and the host reloads the source).

## 5. Player interface

```ts
interface Player {
  play(): void
  pause(): void
  seek(seconds: number): void
  getTime(): number
  setRate(rate: number): void
  on(event: 'play' | 'pause' | 'seek' | 'buffering' | 'ready', cb): void
}
```

Adapters: `YouTubeAdapter` (IFrame Player API), `HtmlVideoAdapter` (mp4/webm URL, HLS via `hls.js`, local file via `URL.createObjectURL`). Every adapter must pass one shared contract test suite.

## 6. Sync protocol

Room state (server-authoritative):

```ts
{
  source: { type: 'youtube'|'file'|'url'|'hls', id?, url?, name?, size?, duration? } | null,
  isPlaying: boolean,
  position: number,   // seconds, as of updatedAt
  rate: 1,
  updatedAt: number,  // server time, ms
  version: number     // increments on every change
}
```

Current position is derived: `isPlaying ? position + (serverNow - updatedAt)/1000 : position`.

Client to server: `hello`, `ping`, `control` (`play|pause|seek|setSource`, with position and seen version), `chat`, `buffering`, `mod`.
Server to client: `welcome`, `pong`, `state` (full state on every change), `heartbeat` (every 5s), `chat`, `members`, `error` (`forbidden`, `rate_limited`, `banned`).

Rules:

- Control: host only by default; room setting `controlMode: 'host' | 'everyone'`. Others get `forbidden`.
- Ordering: server processes events in arrival order and increments `version`. In `everyone` mode, last write wins.
- Clock offset: 5 pings at join, keep the offset from the lowest-RTT sample, refresh every 60s.
- Drift correction on every `state`/`heartbeat`: under 0.3s do nothing; 0.3-2s nudge `playbackRate` to 0.95/1.05; over 2s hard seek.
- Loop prevention: calls made by SyncClient are tagged; the resulting player event is ignored.
- Buffering: if a member buffers, the server pauses the room; it resumes when all are ready or after 10s. Host can disable.
- Local-file mismatch: if a client's file duration differs from `source.duration` by more than 1s, warn and offer a per-client offset slider.
- Reconnect: exponential backoff, re-run `hello`, `welcome` carries current state.

## 7. Moderation and limits (server-enforced)

Roles: **Host** (everything, promote moderators, delete room), **Moderator** (kick, mute, remove chat messages), **Member** (chat; control only in `everyone` mode), **Guest** (as member, stricter limits).

Room settings: `controlMode`, `allowGuests`, `maxViewers` (default 15, hard cap 30), `chatEnabled`, `pauseOnBuffering`, optional `password`.

Actions: kick; mute; ban (persisted; guest bans use guest token ID plus a salted IP hash and are a soft measure); report (row in `reports`, reviewed manually).

| Limit | Value |
|---|---|
| Chat rate | 5 msgs/10s members, 3/10s guests |
| Message length | 500 chars, control chars stripped |
| Control events | 10/10s per client |
| Rooms per host | 3 active, 20 created per day |
| Connections per IP | 10 |
| Empty-room timeout | 10 min |
| Global | Cap on total live rooms and sockets |

Repeated rate-limit breaches escalate: 60s mute, then disconnect.

Content safety: chat and nicknames render as text only (no HTML). Source URLs must be `https`, private IP ranges rejected, and the server never fetches user URLs (no SSRF).

Legal minimum: short terms of service, a "don't share content you lack rights to" notice at room creation, and a takedown contact address.

Privacy: store only profile, rooms, bans, reports. Do not log chat contents or raw IPs; hash IPs with a rotating salt.

## 8. Testing

- Unit: position derivation, drift decisions, clock offset, rate limiters, permission matrix, input validation.
- Server integration: real server with 3-5 fake WebSocket clients (join, forbidden control, kick/ban/mute, buffering, reconnect with stale version, viewer cap, guest toggle).
- Sync simulation: fake players with injected 50-500ms jitter; clients converge within 0.5s after a seek and stay in tolerance over 10 simulated minutes.
- Adapter contract tests shared by all adapters.
- E2E (Playwright): two browser contexts in one room using a local mp4; include a mobile viewport project.
- Manual pre-launch checklist: YouTube on Chrome/Firefox/Safari, iOS Safari autoplay, file duration mismatch, Wi-Fi reconnect, host closes tab, phone layouts (portrait, landscape, fullscreen).
- Load check: about 300 sockets across 20 rooms on one small instance.

## 9. Build order

1. Skeleton: monorepo (client, server), Supabase project, host login.
2. One room, one source: room creation, guest join, HTML5 adapter, basic sync loop.
3. Drift and clocks.
4. Chat.
5. YouTube and local-file adapters, mismatch warning.
6. Moderation.
7. Hardening: global caps, reconnect polish, terms page, error states, PWA manifest.
8. Later (separate specs): direct URL/HLS polish, screen share, streaming extension.

## 10. Launch

Invite-only soft launch for about a week. Metrics: concurrent rooms and sockets, median client-reported drift, reconnect rate, rate-limit hits, reports per day, via `/health` and `/stats`. Alert at 70% of the connection cap; spending cap on any paid tier. Rollback is a redeploy of the previous build.

## 11. Brand and UI prototype

A static design prototype (logo, brand, main pages) lives in `docs/design/prototype/`. It is a design reference, not product code. See its `README.md`. The visual direction is **approved** (2026-09-29):

- Logo: two overlapping circles (violet, coral) with an amber overlap holding a play mark. Wordmark is lowercase "unison" in Sora Bold, set as live text in the UI.
- Palette: Night `#0F0B1E`, Surface `#1A1530`, Violet `#7C6CFF` (single action color), Coral `#FF7A59`, Amber `#FFC857` (emphasis, host, focus), Green `#4ADE99` (live), Rose `#FF5C7A` (danger), Text `#F4F1FF`. Dark theme only.
- Type: Sora (headings, wordmark) and Inter (body), 16px minimum for inputs.
- **Flat color only.** No gradients, glows, or glass effects, to keep the look professional. Icons are simple solid SVGs; no emoji in the UI.
- Pages: landing, sign-in, host dashboard, guest join, room.

## 12. Open questions

- Domain name and final brand palette sign-off (prototype proposes one).
- Fly.io vs. a VPS for the Node server.
