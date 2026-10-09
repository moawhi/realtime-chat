# Realtime chat
Single static page (`index.html`, no build). Realtime relay: ntfy.sh public pub/sub over HTTPS (SSE to receive, POST to send), no account.
Rooms via URL hash: `#room=lobby` (the room code is never put in the link). Joining needs name + room + room code.
Topic = `offsuit-rtchat-7f3k9q-` + first 32 hex of SHA-256("room/<room>"). Payloads are AES-GCM encrypted with a key from PBKDF2(code, salt=room, 200k). A code is accepted if it decrypts the room's recent history; an empty room (no messages in ~12h) takes the first joiner's code. ntfy.sh keeps messages ~12h.
Deploy: `./deploy-github-pages.sh` after `gh auth login`.
Notifications: desktop Notification + soft WebAudio sound for others' live messages when the tab is hidden/unfocused (bell toggle, saved in localStorage as chat-notify), unread count in tab title. Only while the page is open (no Web Push).
