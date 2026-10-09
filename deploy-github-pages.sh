#!/usr/bin/env bash
# Run after `gh auth login` (GitHub device flow). Creates public repo moawhi/realtime-chat and enables GitHub Pages.
set -euo pipefail
cd "$(dirname "$0")"
REPO=${REPO:-realtime-chat}
OWNER=$(gh api user -q .login)
gh repo view "$OWNER/$REPO" >/dev/null 2>&1 || gh repo create "$OWNER/$REPO" --public --description "Minimal real-time chat (static page + ntfy.sh relay)"
git remote get-url origin >/dev/null 2>&1 || git remote add origin "https://github.com/$OWNER/$REPO.git"
gh auth setup-git
git push -u origin main
gh api -X POST "repos/$OWNER/$REPO/pages" -f 'source[branch]=main' -f 'source[path]=/' >/dev/null 2>&1 || true
echo "Pages URL: https://$OWNER.github.io/$REPO/  (first build takes ~1 min)"
