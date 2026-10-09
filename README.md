# Realtime chat
Single static page (`index.html`, no build). Realtime relay: ntfy.sh public pub/sub over HTTPS (SSE to receive, POST to send), no account.
Rooms via URL hash: `#room=lobby`. Topic = `offsuit-rtchat-7f3k9q-<room>`.
Messages are cached by ntfy.sh for ~12h, then gone. Public relay: anyone who guesses the topic can read — don't share secrets.
Deploy: `./deploy-github-pages.sh` after `gh auth login`.
