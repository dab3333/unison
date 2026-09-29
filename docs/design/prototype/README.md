# Unison design prototype

Static HTML/CSS mockup of the logo, brand, and main pages. It is a **design reference, not product code**: no build step, no backend, and the room's playback and chat are faked in the page.

Open `index.html` in a browser. Use your browser's device toolbar (or a real phone) to check the mobile layout. The design is mobile-first.

| File | What it shows |
|---|---|
| `brand.html` | Logo, colors, type, voice |
| `index.html` | Landing page |
| `signin.html` | Host sign-in (Google, Discord, magic link) |
| `dashboard.html` | Host's rooms and create-room form |
| `join.html` | Guest join with a nickname |
| `room.html` | Room: player, chat, members. Members are a bottom sheet on phones and a side panel on desktop |
| `logo.svg`, `logo-mark.svg` | Logo assets |
| `styles.css` | Shared tokens and components |

Fonts (Sora, Inter) load from Google Fonts, so a network connection is needed to see them. Otherwise it falls back to system fonts.
