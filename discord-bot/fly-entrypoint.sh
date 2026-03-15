#!/bin/sh
set -e
cd /app
if [ -n "$GITHUB_TOKEN" ]; then
  REMOTE=$(git config --get remote.origin.url 2>/dev/null) || true
  if [ -n "$REMOTE" ]; then
    REPO=$(echo "$REMOTE" | sed -n 's|.*github\.com[:/]\([^/]*/[^/]*\)\.git.*|\1|p' | head -1)
    if [ -n "$REPO" ]; then
      git remote set-url origin "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO}.git"
    fi
  fi
  git pull origin main 2>/dev/null || true
fi
exec node discord-bot/index.mjs
