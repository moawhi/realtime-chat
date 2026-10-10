# ChatHouse app (preview)

Mobile-first preview of "host a room + play the daily", served at `/app/`. The main site at `/` is unchanged.

Modules (`js/`):

| File | Role | Swap for a backend later |
|---|---|---|
| `profile.js` | Local profile `{ id, name, createdAt, premium: false }` | Accounts + reserved usernames |
| `storage.js` | `kv` (get/set/del) and `history` (load/append/clear, last 300 msgs per room) | Synced profile + persistent message store |
| `transport.js` | `publish / poll / subscribe` over ntfy.sh (HTTPS + SSE, ~12h retention) | WebSocket / realtime service |
| `crypto.js` | Room code → topic + AES-GCM key (PBKDF2) | Keep (E2E), or server-side keys for premium history |
| `rooms.js` | Host / find / open rooms, my rooms, public directory | Server room registry |
| `flappy.js` + `flappy.html` | Flappy v2 (the app's own copy of the main site's game) with a per-device daily best | Server-checked scores |
| `wordle.js` | Daily puzzle (Sydney date), stats, result card, board UI | Daily puzzle server, server-checked stats |
| `app.js` | Routing + UI only | — |

No ads are served: the 320×50 box is a placeholder with no ad code.
