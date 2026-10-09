# Realtime chat
Single static page (`index.html`, no build). Realtime relay: ntfy.sh public pub/sub over HTTPS (SSE to receive, POST to send), no account.

Rooms via URL hash: `#room=lobby` (the room code is never put in the link). Joining needs name + room + room code.

Topic = `offsuit-rtchat-7f3k9q-` + first 32 hex of SHA-256("room/<room>"). Payloads are AES-GCM encrypted with a key from PBKDF2(code, salt=room, 200k). A code is accepted if it decrypts the room's recent history; an empty room (no messages in ~12h) takes the first joiner's code. ntfy.sh keeps messages ~12h.

Deploy: `./deploy-github-pages.sh` after `gh auth login`.

Notifications: desktop Notification + soft WebAudio sound for others' live messages when the tab is hidden/unfocused (bell toggle, saved in localStorage as chat-notify), unread count in tab title. Only while the page is open (no Web Push).

Identity: stable per-browser id in localStorage (chat-client-id, shared by tabs). A message is "mine" if its sender id matches, or (fallback) its name matches my current name case-insensitively.

## Home page (Offsuit House + chat)
- `index.html`: home page. Game (`game.html`, the Offsuit House canvas game, unchanged; font in `fonts/`) in an iframe on the left; chat panel (360px) on the right, collapsible; on screens <=860px the chat is a drawer over the game.
- Room list: "My rooms" (localStorage `chat-rooms`, with activity hints from polling each room's encrypted topic) and "Public rooms" (ntfy topic `offsuit-rtchat-7f3k9q-directory-v1`; rooms announce `{room,id,ts}` on join and every 10 min; `unlist` hides a room). Codes are never published. Private rooms (checkbox off) never announce; every encrypted message carries `pub` so joiners respect a room's private setting.
