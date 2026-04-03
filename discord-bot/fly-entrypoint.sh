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
  git pull --rebase origin main 2>/dev/null || true
fi
# 映像內可能帶入本機 .git 的超大 http.postBuffer（例如 1GB），push 會一次 malloc 同尺寸 → 512MB VM OOM
git config http.postBuffer 52428800 2>/dev/null || true
exec node discord-bot/index.mjs
